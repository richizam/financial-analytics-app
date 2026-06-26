from __future__ import annotations

import json
import re
import unicodedata
from datetime import date
from typing import Any

from backend.app.core.config import Settings
from backend.app.domain.financial import FinancialService

from .csv_profile import TARGET_SCHEMA, build_csv_profile, heuristic_mapping, safe_json_dumps
from .prompts import CSV_MAPPING_PROMPT, SYSTEM_PROMPT
from .tools import AiContext, AiToolExecutor, AiToolValidationError
from .xai_client import XaiClient, XaiClientError, XaiConfigurationError


MONTH_ALIASES = {
    "ene": "01",
    "enero": "01",
    "jan": "01",
    "january": "01",
    "feb": "02",
    "febrero": "02",
    "february": "02",
    "mar": "03",
    "marzo": "03",
    "march": "03",
    "abr": "04",
    "abril": "04",
    "apr": "04",
    "april": "04",
    "may": "05",
    "mayo": "05",
    "jun": "06",
    "junio": "06",
    "june": "06",
    "jul": "07",
    "julio": "07",
    "july": "07",
    "ago": "08",
    "agosto": "08",
    "aug": "08",
    "august": "08",
    "sep": "09",
    "sept": "09",
    "septiembre": "09",
    "setiembre": "09",
    "september": "09",
    "oct": "10",
    "octubre": "10",
    "october": "10",
    "nov": "11",
    "noviembre": "11",
    "november": "11",
    "dic": "12",
    "diciembre": "12",
    "dec": "12",
    "december": "12",
}
MONTH_PATTERN = "|".join(sorted((re.escape(month) for month in MONTH_ALIASES), key=len, reverse=True))
YEAR_PATTERN = r"\d{4}"
YEAR_TOKEN_PATTERN = r"(?:\d{4}|\d{2})"
PERIOD_LABEL_MONTHS = ("Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic")
DEFAULT_COMPARISON_METRICS = [
    "revenue",
    "costs",
    "gross_profit",
    "gross_margin",
    "operating_profit",
    "net_profit",
    "ebitda",
]
CONVERSATION_CONTEXT_LIMIT = 10
CONVERSATION_SUMMARY_MAX_CHARS = 2400


class AiAssistantService:
    def __init__(
        self,
        financial_service: FinancialService,
        settings: Settings,
        xai_client: XaiClient | None = None,
        orchestrator: Any | None = None,
    ) -> None:
        self.financial_service = financial_service
        self.settings = settings
        self.xai_client = xai_client or XaiClient(settings)
        self.tools = AiToolExecutor(financial_service)
        # LangGraph orchestrator (shared across workspaces so the checkpointer is
        # reused). Built lazily only when ai_orchestrator == "langgraph".
        self._orchestrator = orchestrator

    def with_financial_service(self, financial_service: FinancialService) -> "AiAssistantService":
        return AiAssistantService(
            financial_service, self.settings, self.xai_client, self._orchestrator
        )

    def _get_orchestrator(self) -> Any:
        if self._orchestrator is None:
            from .orchestrator import LangGraphOrchestrator

            self._orchestrator = LangGraphOrchestrator(self.settings)
        return self._orchestrator

    def chat(
        self,
        message: str,
        ruc: str,
        periodos: list[str],
        conversation: list[dict[str, Any]],
        conversation_summary: str | None = None,
        thread_id: str | None = None,
        resume: str | None = None,
        workspace_id: str | None = None,
    ) -> dict[str, Any]:
        clean_message = message.strip()
        if not clean_message:
            raise AiToolValidationError("message is required")

        context = self._context(ruc, periodos)
        if resume is None:
            local_response = self._local_intent_response(clean_message, context)
            if local_response:
                return local_response

        if self.settings.ai_orchestrator == "langgraph":
            return self._chat_langgraph(
                clean_message, context, conversation, conversation_summary, thread_id, resume, workspace_id
            )

        executed_results: list[dict[str, Any]] = []
        try:
            messages = self._initial_input(clean_message, context, conversation, conversation_summary)
            response = self.xai_client.create_chat_completion(
                messages,
                tools=self.tools.definitions(context),
            )

            for _ in range(3):
                calls = self._chat_function_calls(response)
                if not calls:
                    break
                assistant_message = self._chat_message(response)
                if assistant_message:
                    messages.append(assistant_message)
                tool_outputs: list[dict[str, Any]] = []
                for call in calls:
                    result = self.tools.execute(call["name"], call["arguments"], context)
                    executed_results.append(result)
                    tool_outputs.append(
                        {
                            "role": "tool",
                            "tool_call_id": call["call_id"],
                            "content": json.dumps(result, ensure_ascii=False),
                        }
                    )
                messages.extend(tool_outputs)
                response = self.xai_client.create_chat_completion(
                    messages,
                    tools=self.tools.definitions(context),
                )
        except (XaiClientError, XaiConfigurationError) as exc:
            return {
                "message": (
                    "No pude contactar al proveedor de AI en este momento. "
                    "Prueba otra vez en unos segundos."
                ),
                "ui_action": None,
                "citations": [],
                "executed_tools": [],
                "provider": "local-fallback",
                "model": self.xai_client.model,
                "error": str(exc),
            }

        message_text = self._chat_text(response)
        if not message_text:
            message_text = "No pude generar una explicacion, pero el backend si proceso la solicitud."

        # Navigation only when the model explicitly used renderDashboard
        # (source="frontend_instruction"). Data/analysis tools ground the answer
        # but must not move the dashboard when the user merely asked a question.
        ui_action = self._first_ui_action(
            [result for result in executed_results if result.get("source") == "frontend_instruction"]
        )
        citations = [
            {
                "type": "metric_result" if result.get("source") == "calculated_by_backend" else "tool_result",
                "source": result.get("tool_name"),
                "result_id": result.get("result_id"),
            }
            for result in executed_results
            if result.get("result_id")
        ]

        return {
            "message": message_text,
            "ui_action": ui_action,
            "citations": citations,
            "executed_tools": [str(result.get("tool_name")) for result in executed_results],
            "provider": "xai",
            "model": self.xai_client.model,
        }

    def _chat_langgraph(
        self,
        message: str,
        context: AiContext,
        conversation: list[dict[str, Any]],
        conversation_summary: str | None,
        thread_id: str | None,
        resume: str | None = None,
        workspace_id: str | None = None,
    ) -> dict[str, Any]:
        import uuid

        input_items = self._initial_input(message, context, conversation, conversation_summary)
        resolved_thread = thread_id or f"mem-{uuid.uuid4().hex}"
        return self._get_orchestrator().chat(
            input_items=input_items,
            context=context,
            executor=self.tools,
            thread_id=resolved_thread,
            new_message=message,
            resume=resume,
            workspace_id=workspace_id,
        )

    def _local_intent_response(self, message: str, context: AiContext) -> dict[str, Any] | None:
        normalized = self._normalize_text(message)
        # Conceptual/explanatory questions ("what does X mean?", "why did Y change?",
        # "is this good?") are answered conversationally by the model — never short-
        # circuited into a templated navigation reply. Checked before every area
        # (anomalies, comparison, ledger, notes, dashboard) because each one is matched
        # by a keyword that also appears in genuine questions (e.g. "riesgo").
        if self._is_explanatory_question(normalized):
            return None
        periodos = self._periods_for_message(normalized, context)
        if self._asks_for_anomalies(normalized):
            result = self._execute_for_periods("getAnomalies", context, periodos)
            return self._local_tool_response(
                result,
                self._anomaly_message(result),
                "local-intent",
            )
        if self._asks_for_notes(normalized):
            result = self._execute_for_periods(
                "renderDashboard",
                context,
                periodos,
                {"dashboardType": "notes"},
            )
            return self._local_tool_response(
                result,
                self._dashboard_message("Notas NIIF", result),
                "local-intent",
            )
        if self._asks_for_general_ledger(normalized):
            result = self._execute_for_periods(
                "renderDashboard",
                context,
                periodos,
                {"dashboardType": "general_ledger"},
            )
            return self._local_tool_response(
                result,
                self._dashboard_message("Libro Mayor", result),
                "local-intent",
            )
        if self._asks_for_comparison(normalized):
            comparison_periods = self._comparison_period_sets(normalized, context)
            if comparison_periods:
                periodos_a, periodos_b = comparison_periods
                result = self._execute_comparison(context, periodos_a, periodos_b)
                return self._local_tool_response(
                    result,
                    self._comparison_message(result),
                    "local-intent",
                )
        if self._asks_for_data_dashboard(normalized):
            result = self._execute_for_periods(
                "renderDashboard",
                context,
                periodos,
                {"dashboardType": "financial_summary"},
            )
            return self._local_tool_response(
                result,
                self._dashboard_message("el dashboard principal", result),
                "local-intent",
            )
        if self._asks_for_main_dashboard(normalized):
            result = self._execute_for_periods(
                "renderDashboard",
                context,
                periodos,
                {"dashboardType": "financial_summary"},
            )
            return self._local_tool_response(
                result,
                self._dashboard_message("el dashboard principal", result),
                "local-intent",
            )
        return None

    def _execute_for_periods(
        self,
        tool_name: str,
        context: AiContext,
        periodos: list[str],
        extra_args: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        filters = self._period_filters(periodos)
        args: dict[str, Any] = {
            "clientId": context.selected_ruc,
            "startDate": filters["startDate"],
            "endDate": filters["endDate"],
        }
        if tool_name == "renderDashboard":
            args = {
                "clientId": context.selected_ruc,
                "filters": filters,
                **(extra_args or {}),
            }
        elif extra_args:
            args.update(extra_args)
        return self.tools.execute(tool_name, args, context)

    def _execute_comparison(self, context: AiContext, periodos_a: list[str], periodos_b: list[str]) -> dict[str, Any]:
        return self.tools.execute(
            "comparePeriods",
            {
                "clientId": context.selected_ruc,
                "periodA": self._period_filters(periodos_a),
                "periodB": self._period_filters(periodos_b),
                "metrics": DEFAULT_COMPARISON_METRICS,
            },
            context,
        )

    def _local_tool_response(self, result: dict[str, Any], message: str, provider: str) -> dict[str, Any]:
        citation_type = "metric_result" if result.get("source") == "calculated_by_backend" else "tool_result"
        citations = []
        if result.get("result_id"):
            citations.append(
                {
                    "type": citation_type,
                    "source": result.get("tool_name"),
                    "result_id": result.get("result_id"),
                }
            )
        return {
            "message": message,
            "ui_action": result.get("ui_action") if isinstance(result.get("ui_action"), dict) else None,
            "citations": citations,
            "executed_tools": [str(result.get("tool_name"))] if result.get("tool_name") else [],
            "provider": provider,
            "model": None,
        }

    def _anomaly_message(self, result: dict[str, Any]) -> str:
        if result.get("status") != "success":
            return "Te llevo a Anomalias, pero no encontre datos para el periodo seleccionado."
        period_label = self._periodos_label(result.get("periodos", []))
        score = result.get("riskScore", {}).get("score")
        nivel = result.get("riskScore", {}).get("nivel")
        total = result.get("totalEntries")
        duplicates = result.get("duplicateGroups")
        outliers = result.get("outliers")
        return (
            f"Listo. Te muestro la pantalla de Anomalias para {period_label}. "
            f"Riesgo {nivel}, score {score}/100, "
            f"{duplicates} grupos duplicados y {outliers} outliers sobre {total} asientos."
        )

    def _dashboard_message(self, view_name: str, result: dict[str, Any]) -> str:
        action = result.get("ui_action") if isinstance(result.get("ui_action"), dict) else {}
        periodos = action.get("periodos", []) if isinstance(action, dict) else []
        if not periodos:
            return f"No encontre datos para abrir {view_name} con el periodo solicitado."
        return f"Listo. Abro {view_name} para {self._periodos_label(periodos)}."

    def _comparison_message(self, result: dict[str, Any]) -> str:
        action = result.get("ui_action") if isinstance(result.get("ui_action"), dict) else {}
        periodos_a = action.get("periodosA", []) if isinstance(action, dict) else []
        periodos_b = action.get("periodosB", []) if isinstance(action, dict) else []
        if not periodos_a or not periodos_b:
            return "No encontre dos periodos con datos para abrir el comparativo solicitado."
        return (
            "Listo. Abro Comparativo para "
            f"{self._periodos_label(periodos_a)} vs {self._periodos_label(periodos_b)}."
        )

    def _active_periods(self, context: AiContext) -> list[str]:
        available = context.available_periods_by_ruc.get(context.selected_ruc, [])
        selected = [period for period in context.selected_periodos if period in available]
        if selected:
            return sorted(selected)
        years = sorted({period[:4] for period in available})
        last_year = years[-1] if years else ""
        return [period for period in available if period.startswith(last_year)]

    def _periods_for_message(self, normalized: str, context: AiContext) -> list[str]:
        available = sorted(context.available_periods_by_ruc.get(context.selected_ruc, []))
        month_range_periods = self._periods_for_explicit_month_range(normalized, available)
        if month_range_periods is not None:
            return month_range_periods
        year_range_periods = self._periods_for_explicit_year_range(normalized, available)
        if year_range_periods is not None:
            return year_range_periods
        years = self._years_in_message(normalized)
        if years:
            periodos = [period for period in available if period[:4] in years]
            quarter = self._quarter_in_message(normalized)
            if quarter is not None:
                months = {
                    1: {"01", "02", "03"},
                    2: {"04", "05", "06"},
                    3: {"07", "08", "09"},
                    4: {"10", "11", "12"},
                }[quarter]
                periodos = [period for period in periodos if period[4:6] in months]
            return periodos
        return self._active_periods(context)

    def _comparison_period_sets(self, normalized: str, context: AiContext) -> tuple[list[str], list[str]] | None:
        for left, right in self._comparison_fragment_candidates(normalized):
            periodos_a = self._periods_for_comparison_fragment(left, normalized, context)
            periodos_b = self._periods_for_comparison_fragment(right, normalized, context)
            if periodos_a and periodos_b:
                return periodos_a, periodos_b
        return None

    def _comparison_fragment_candidates(self, normalized: str) -> list[tuple[str, str]]:
        candidates: list[tuple[str, str]] = []
        separator_pattern = (
            r"\b(?:vs\.?|versus|contra|frente\s+a|comparad[oa]s?\s+con|respecto\s+a|con)\b"
        )
        for match in re.finditer(separator_pattern, normalized):
            left = normalized[: match.start()].strip()
            right = normalized[match.end() :].strip()
            if left and right:
                candidates.append((left, right))

        between_match = re.search(r"\bentre\b(?P<left>.+?)\by\b(?P<right>.+)", normalized)
        if between_match:
            candidates.append((between_match.group("left").strip(), between_match.group("right").strip()))

        for match in re.finditer(r"\by\b", normalized):
            left = normalized[: match.start()].strip()
            right = normalized[match.end() :].strip()
            if left and right:
                candidates.append((left, right))
        return candidates

    def _periods_for_comparison_fragment(
        self,
        fragment: str,
        full_normalized: str,
        context: AiContext,
    ) -> list[str] | None:
        available = sorted(context.available_periods_by_ruc.get(context.selected_ruc, []))
        candidate = fragment.strip(" .,:;")
        full_years = self._years_in_message(full_normalized)
        if not self._years_in_message(candidate) and not self._has_period_token(candidate):
            return None
        if not self._years_in_message(candidate) and len(full_years) == 1:
            candidate = f"{candidate} {full_years[0]}"

        month_range_periods = self._periods_for_explicit_month_range(candidate, available)
        if month_range_periods is not None:
            return month_range_periods

        year_range_periods = self._periods_for_explicit_year_range(candidate, available)
        if year_range_periods is not None:
            return year_range_periods

        years = self._years_in_message(candidate)
        quarter = self._quarter_in_message(candidate)
        if years and quarter is not None:
            months = {
                1: {"01", "02", "03"},
                2: {"04", "05", "06"},
                3: {"07", "08", "09"},
                4: {"10", "11", "12"},
            }[quarter]
            return [period for period in available if period[:4] in years and period[4:6] in months]

        if years:
            return [period for period in available if period[:4] in years]
        return None

    def _has_period_token(self, normalized: str) -> bool:
        return bool(
            re.search(rf"\b{MONTH_PATTERN}\b", normalized)
            or self._quarter_in_message(normalized) is not None
            or re.search(r"(?<!\d)\d{4}(?:0[1-9]|1[0-2])(?!\d)", normalized)
            or re.search(r"(?<!\d)(?:0?[1-9]|1[0-2])[-/]\d{2,4}(?!\d)", normalized)
            or re.search(r"(?<!\d)\d{2,4}[-/](?:0?[1-9]|1[0-2])(?!\d)", normalized)
        )

    def _periods_for_explicit_month_range(self, normalized: str, available: list[str]) -> list[str] | None:
        references = self._month_period_references(normalized)
        if not references:
            return None
        start = references[0][1]
        end = references[1][1] if len(references) > 1 else start
        if end < start:
            start, end = end, start
        return [period for period in available if start <= period <= end]

    def _periods_for_explicit_year_range(self, normalized: str, available: list[str]) -> list[str] | None:
        references = self._year_references(normalized)
        if len(references) < 2 or not self._has_range_connector_between(normalized, references[0][0], references[1][0]):
            return None
        start_year = references[0][1]
        end_year = references[1][1]
        if end_year < start_year:
            start_year, end_year = end_year, start_year
        return [period for period in available if start_year <= period[:4] <= end_year]

    def _year_references(self, normalized: str) -> list[tuple[int, str]]:
        return [(match.start(), match.group(0)) for match in re.finditer(rf"\b{YEAR_PATTERN}\b", normalized)]

    def _has_range_connector_between(self, normalized: str, start_position: int, end_position: int) -> bool:
        between = normalized[start_position:end_position]
        return bool(
            re.search(
                r"\b(desde|hasta|entre|from|to|through|thru|until|al|a|y)\b|[-/]",
                between,
            )
        )

    def _month_period_references(self, normalized: str) -> list[tuple[int, str]]:
        references: list[tuple[int, str]] = []
        spans: set[tuple[int, int]] = set()

        references.extend(self._month_name_period_references(normalized))

        def add_reference(match: re.Match[str], year: str, month: str) -> None:
            span = match.span()
            if span in spans:
                return
            normalized_month = month.zfill(2)
            normalized_year = self._normalize_year_token(year)
            if normalized_month < "01" or normalized_month > "12":
                return
            spans.add(span)
            references.append((span[0], f"{normalized_year}{normalized_month}"))

        for match in re.finditer(
            rf"\b(?P<month>{MONTH_PATTERN})\b[\s/-]*(?:(?:de|del)\s+)?(?P<year>{YEAR_TOKEN_PATTERN})\b",
            normalized,
        ):
            add_reference(match, match.group("year"), MONTH_ALIASES[match.group("month")])

        for match in re.finditer(
            rf"(?<!\d)(?P<year>{YEAR_TOKEN_PATTERN})[-/](?P<month>0?[1-9]|1[0-2])(?!\d)",
            normalized,
        ):
            add_reference(match, match.group("year"), match.group("month"))

        for match in re.finditer(
            rf"(?<!\d)(?P<month>0?[1-9]|1[0-2])[-/](?P<year>{YEAR_TOKEN_PATTERN})(?!\d)",
            normalized,
        ):
            add_reference(match, match.group("year"), match.group("month"))

        for match in re.finditer(r"(?<!\d)(?P<period>\d{4}(?:0[1-9]|1[0-2]))(?!\d)", normalized):
            period = match.group("period")
            add_reference(match, period[:4], period[4:6])

        references.sort(key=lambda item: item[0])
        deduped: list[tuple[int, str]] = []
        seen_periods: set[str] = set()
        for position, period in references:
            if period in seen_periods:
                continue
            seen_periods.add(period)
            deduped.append((position, period))
        return deduped

    def _month_name_period_references(self, normalized: str) -> list[tuple[int, str]]:
        mentions: list[tuple[int, str, str | None]] = []
        for match in re.finditer(
            rf"\b(?P<month>{MONTH_PATTERN})\b(?:[\s/-]*(?:(?:de|del)\s+)?(?P<year>{YEAR_TOKEN_PATTERN})\b)?",
            normalized,
        ):
            year = match.group("year")
            mentions.append((match.start(), MONTH_ALIASES[match.group("month")], self._normalize_year_token(year) if year else None))

        if not mentions:
            return []

        explicit = [(position, f"{year}{month}") for position, month, year in mentions if year]
        if len(explicit) >= 2:
            return explicit
        if len(mentions) == 1:
            return explicit

        start_position, start_month, start_year = mentions[0]
        end_position, end_month, end_year = mentions[1]

        if start_year and not end_year:
            inferred_end_year = int(start_year) + (1 if end_month < start_month else 0)
            end_year = str(inferred_end_year)
        elif end_year and not start_year:
            inferred_start_year = int(end_year) - (1 if start_month > end_month else 0)
            start_year = str(inferred_start_year)
        elif not start_year and not end_year:
            years = self._years_in_message(normalized)
            if len(years) != 1:
                return explicit
            shared_year = years[0]
            start_year = shared_year
            inferred_end_year = int(shared_year) + (1 if end_month < start_month else 0)
            end_year = str(inferred_end_year)

        if not start_year or not end_year:
            return explicit

        return [
            (start_position, f"{start_year}{start_month}"),
            (end_position, f"{end_year}{end_month}"),
        ]

    def _years_in_message(self, normalized: str) -> list[str]:
        years: list[str] = []
        for match in re.findall(rf"\b{YEAR_PATTERN}\b", normalized):
            if match not in years:
                years.append(match)
        return years

    def _normalize_year_token(self, year: str) -> str:
        if len(year) == 4:
            return year
        value = int(year)
        return f"{2000 + value:04d}" if value < 80 else f"{1900 + value:04d}"

    def _quarter_in_message(self, normalized: str) -> int | None:
        ordinal_quarters = {
            "primer trimestre": 1,
            "primero trimestre": 1,
            "segundo trimestre": 2,
            "tercer trimestre": 3,
            "tercero trimestre": 3,
            "cuarto trimestre": 4,
        }
        for phrase, quarter in ordinal_quarters.items():
            if phrase in normalized:
                return quarter
        match = re.search(r"\bq([1-4])\b|\b(?:trimestre|trim)\s*([1-4])\b", normalized)
        if not match:
            return None
        value = match.group(1) or match.group(2)
        return int(value)

    def _periodos_label(self, periodos: list[str]) -> str:
        sorted_periodos = sorted(periodos)
        if not sorted_periodos:
            return "el periodo seleccionado"
        if len(sorted_periodos) == 1:
            return self._period_label(sorted_periodos[0])
        return f"{self._period_label(sorted_periodos[0])} - {self._period_label(sorted_periodos[-1])}"

    def _period_label(self, periodo: str) -> str:
        month = int(periodo[4:6])
        return f"{PERIOD_LABEL_MONTHS[month - 1]} {periodo[:4]}"

    def _period_filters(self, periodos: list[str]) -> dict[str, Any]:
        if not periodos:
            today = date.today().isoformat()
            return {"startDate": today, "endDate": today, "granularity": "monthly"}
        sorted_periods = sorted(periodos)
        start = sorted_periods[0]
        end = sorted_periods[-1]
        end_year = int(end[:4])
        end_month = int(end[4:6])
        if end_month == 12:
            end_date = date(end_year, 12, 31)
        else:
            end_date = date.fromordinal(date(end_year, end_month + 1, 1).toordinal() - 1)
        return {
            "startDate": f"{start[:4]}-{start[4:6]}-01",
            "endDate": end_date.isoformat(),
            "granularity": "monthly",
        }

    def _normalize_text(self, value: str) -> str:
        return (
            unicodedata.normalize("NFKD", value)
            .encode("ascii", "ignore")
            .decode("ascii")
            .lower()
        )

    def _is_explanatory_question(self, normalized: str) -> bool:
        # General markers of an explanation/interpretation request (ES/EN). Not tied
        # to any single area or exact phrasing: a navigation command never contains
        # these, while "que significa / por que / como se / es bueno / what does ..." do.
        return any(
            marker in normalized
            for marker in (
                "que significa",
                "que quiere decir",
                "que es ",
                "que son ",
                "que representa",
                "que indica",
                "que mide",
                "que implica",
                "que tan",
                "que diferencia hay",
                "por que",
                "porque",
                "a que se debe",
                "para que sirve",
                "para que se usa",
                "como se ",
                "como calcul",
                "como interpret",
                "como leo",
                "como funciona",
                "explica",
                "explicame",
                "explicacion",
                "interpreta",
                "interpretacion",
                "ayudame a entender",
                "no entiendo",
                "es bueno",
                "es malo",
                "es normal",
                "es alto",
                "es bajo",
                "es saludable",
                "es preocupante",
                "es positivo",
                "es negativo",
                "esta bien",
                "esta mal",
                "deberia preocuparme",
                "what does",
                "what is",
                "what are",
                "whats ",
                "why",
                "how do",
                "how is",
                "how does",
                "how should",
                "how can",
                "explain",
                "means",
                "meaning",
                "interpret",
                "should i",
                "is it good",
                "is it bad",
                "is it normal",
                "is this good",
                "is this bad",
            )
        )

    def _asks_for_anomalies(self, normalized: str) -> bool:
        return any(
            keyword in normalized
            for keyword in (
                "anomal",
                "anomalia",
                "anomalias",
                "anomaly",
                "anomalies",
                "riesgo",
                "sospechos",
                "fraud",
            )
        )

    def _asks_for_notes(self, normalized: str) -> bool:
        return "notas niif" in normalized or "notas" in normalized or "financial statement notes" in normalized

    def _asks_for_general_ledger(self, normalized: str) -> bool:
        return "libro mayor" in normalized or "mayor contable" in normalized or "general ledger" in normalized

    def _asks_for_comparison(self, normalized: str) -> bool:
        comparison_words = (
            "compara",
            "comparar",
            "comparame",
            "comparativo",
            "comparacion",
            "vs",
            "versus",
            "contra",
            "variacion",
            "varianza",
            "diferencia",
            "diferencias",
            "cambio",
            "cambios",
            "changed",
            "compare",
        )
        return any(word in normalized for word in comparison_words)

    def _asks_for_data_dashboard(self, normalized: str) -> bool:
        if not self._years_in_message(normalized) and not self._month_period_references(normalized):
            return False
        if not any(word in normalized for word in ("dato", "datos", "data", "informacion")):
            return False
        return any(
            phrase in normalized
            for phrase in (
                "muestrame",
                "mostrar",
                "muestre",
                "ver",
                "abre",
                "abrir",
                "carga",
                "cargar",
                "pon",
                "show",
                "open",
            )
        )

    def _asks_for_main_dashboard(self, normalized: str) -> bool:
        other_sections = (
            "comparativo",
            "comparar",
            "variance",
            "variacion",
            "varianza",
            "libro mayor",
            "mayor contable",
            "general ledger",
        )
        if any(section in normalized for section in other_sections):
            return False
        if "dashboard" in normalized or "tablero" in normalized:
            return True
        return any(
            phrase in normalized
            for phrase in (
                "dashboard principal",
                "main dashboard",
                "pagina principal",
                "pantalla principal",
                "volver al inicio",
                "volver al dashboard",
                "regresar al dashboard",
                "vuelve al dashboard",
                "ir al dashboard",
                "abre el dashboard",
            )
        )

    def suggest_csv_mapping(self, filename: str, content: str) -> dict[str, Any]:
        profile = build_csv_profile(filename, content)
        fallback = heuristic_mapping(profile)
        payload = {"file_profile": profile, "target_schema": TARGET_SCHEMA}

        if not self.xai_client.configured:
            return {
                "provider": "heuristic",
                "file_profile": profile,
                "proposal": fallback,
                "warnings": ["XAI_API_KEY is not configured; returned heuristic mapping only."],
            }

        try:
            response = self.xai_client.create_chat_completion(
                [
                    {"role": "system", "content": CSV_MAPPING_PROMPT},
                    {"role": "user", "content": safe_json_dumps(payload)},
                ]
            )
            text = self._chat_text(response)
            proposal = self._parse_mapping_json(text)
            proposal = self._sanitize_mapping(proposal, profile)
            return {
                "provider": "xai",
                "file_profile": profile,
                "proposal": proposal,
                "warnings": proposal.get("warnings", []),
                "model": self.xai_client.model,
            }
        except (XaiClientError, XaiConfigurationError, AiToolValidationError, json.JSONDecodeError) as exc:
            return {
                "provider": "heuristic",
                "file_profile": profile,
                "proposal": fallback,
                "warnings": [f"Grok mapping failed; returned heuristic mapping. Reason: {exc}"],
            }

    def _context(self, selected_ruc: str, selected_periodos: list[str]) -> AiContext:
        allowed_rucs = tuple(self.financial_service.get_available_rucs())
        if selected_ruc not in allowed_rucs:
            raise AiToolValidationError("Selected RUC is not available")
        periods_by_ruc = self.financial_service.get_all_periods(list(allowed_rucs))
        return AiContext(
            selected_ruc=selected_ruc,
            selected_periodos=tuple(selected_periodos),
            allowed_rucs=allowed_rucs,
            available_periods_by_ruc=periods_by_ruc,
        )

    def _initial_input(
        self,
        message: str,
        context: AiContext,
        conversation: list[dict[str, Any]],
        conversation_summary: str | None = None,
    ) -> list[dict[str, Any]]:
        context_payload = {
            "selected_client_id": context.selected_ruc,
            "selected_periods": list(context.selected_periodos),
            "available_clients": list(context.allowed_rucs),
            "available_periods_for_selected_client": context.available_periods_by_ruc.get(context.selected_ruc, []),
        }
        input_items: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "system",
                "content": (
                    "Internal app state for tool selection only. "
                    "Do not mention, quote, or explain this JSON to the user. "
                    "For pronouns like this/that/esto/eso, use the visible conversation, not this block.\n"
                    f"{json.dumps(context_payload, ensure_ascii=False)}"
                ),
            },
        ]
        summary = self._conversation_summary(conversation_summary)
        if summary:
            input_items.append(
                {
                    "role": "system",
                    "content": (
                        "Resumen visible de la conversacion anterior. "
                        "Usalo solo como memoria conversacional cuando ayude a entender referencias "
                        "como esto/eso/anterior; no digas que viene de memoria interna.\n"
                        f"{summary}"
                    ),
                }
            )

        for item in conversation[-CONVERSATION_CONTEXT_LIMIT:]:
            role = item.get("role")
            content = str(item.get("content") or "")[:2000]
            if role in {"user", "assistant"} and content:
                visible_context = self._visible_conversation_context(item)
                if visible_context:
                    content = f"{content}\n\n{visible_context}"
                input_items.append({"role": role, "content": content})
        input_items.append({"role": "user", "content": message})
        return input_items

    def _conversation_summary(self, conversation_summary: str | None) -> str:
        if not conversation_summary:
            return ""
        return re.sub(r"\s+", " ", conversation_summary).strip()[:CONVERSATION_SUMMARY_MAX_CHARS]

    def _visible_conversation_context(self, item: dict[str, Any]) -> str:
        action = item.get("ui_action") if isinstance(item.get("ui_action"), dict) else None
        if not action:
            return ""

        dashboard_id = str(action.get("dashboard_id") or "")
        view_name = {
            "financial_summary": "Dashboard principal",
            "profit_and_loss": "Estado de resultados",
            "balance_sheet": "Estado de situacion financiera",
            "revenue_breakdown": "Detalle de ingresos",
            "expense_breakdown": "Detalle de gastos",
            "variance_analysis": "Comparativo",
            "anomalies": "Anomalias",
            "general_ledger": "Libro Mayor",
            "notes": "Notas NIIF",
        }.get(dashboard_id, dashboard_id or "Vista")

        parts = [f"Contexto visible de la app: se abrio {view_name}."]
        ruc = action.get("ruc")
        if isinstance(ruc, str) and ruc:
            parts.append(f"RUC {ruc}.")

        periodos_a = action.get("periodosA") if isinstance(action.get("periodosA"), list) else []
        periodos_b = action.get("periodosB") if isinstance(action.get("periodosB"), list) else []
        periodos = action.get("periodos") if isinstance(action.get("periodos"), list) else []
        clean_a = [str(period) for period in periodos_a if re.fullmatch(r"\d{6}", str(period))]
        clean_b = [str(period) for period in periodos_b if re.fullmatch(r"\d{6}", str(period))]
        clean_periodos = [str(period) for period in periodos if re.fullmatch(r"\d{6}", str(period))]

        if clean_a or clean_b:
            if clean_a:
                parts.append(f"Periodo A: {self._periodos_label(clean_a)}.")
            if clean_b:
                parts.append(f"Periodo B: {self._periodos_label(clean_b)}.")
        elif clean_periodos:
            parts.append(f"Periodo visible: {self._periodos_label(clean_periodos)}.")

        tools = item.get("executed_tools") if isinstance(item.get("executed_tools"), list) else []
        clean_tools = [str(tool) for tool in tools if tool]
        if clean_tools:
            parts.append(f"Herramientas usadas: {', '.join(clean_tools)}.")
        return " ".join(parts)

    def _function_calls(self, response: dict[str, Any]) -> list[dict[str, Any]]:
        calls: list[dict[str, Any]] = []
        for item in response.get("output", []) or []:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "function_call":
                calls.append(
                    {
                        "call_id": str(item.get("call_id") or item.get("id") or ""),
                        "name": str(item.get("name") or ""),
                        "arguments": item.get("arguments") or "{}",
                    }
                )
        return [call for call in calls if call["call_id"] and call["name"]]

    def _chat_message(self, response: dict[str, Any]) -> dict[str, Any] | None:
        choices = response.get("choices") if isinstance(response.get("choices"), list) else []
        if not choices:
            return None
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        return message if isinstance(message, dict) else None

    def _chat_function_calls(self, response: dict[str, Any]) -> list[dict[str, Any]]:
        message = self._chat_message(response)
        if not message:
            return []
        calls: list[dict[str, Any]] = []
        for item in message.get("tool_calls", []) or []:
            if not isinstance(item, dict):
                continue
            function = item.get("function") if isinstance(item.get("function"), dict) else {}
            calls.append(
                {
                    "call_id": str(item.get("id") or ""),
                    "name": str(function.get("name") or ""),
                    "arguments": function.get("arguments") or "{}",
                }
            )
        return [call for call in calls if call["call_id"] and call["name"]]

    def _chat_text(self, response: dict[str, Any]) -> str:
        message = self._chat_message(response)
        if not message:
            return ""
        content = message.get("content")
        return content.strip() if isinstance(content, str) else ""

    def _response_text(self, response: dict[str, Any]) -> str:
        chunks: list[str] = []
        for item in response.get("output", []) or []:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "message":
                continue
            for content in item.get("content", []) or []:
                if isinstance(content, dict):
                    text = content.get("text") or content.get("output_text")
                    if isinstance(text, str):
                        chunks.append(text)
        if chunks:
            return "\n".join(chunks).strip()
        text = response.get("output_text")
        return text.strip() if isinstance(text, str) else ""

    def _first_ui_action(self, results: list[dict[str, Any]]) -> dict[str, Any] | None:
        for result in reversed(results):
            action = result.get("ui_action")
            if isinstance(action, dict):
                return action
        return None

    def _parse_mapping_json(self, text: str) -> dict[str, Any]:
        if not text:
            raise AiToolValidationError("Grok returned an empty mapping response")
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end < start:
            raise AiToolValidationError("Grok did not return a JSON object")
        parsed = json.loads(text[start : end + 1])
        if not isinstance(parsed, dict):
            raise AiToolValidationError("Mapping response must be a JSON object")
        return parsed

    def _sanitize_mapping(self, proposal: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
        valid_columns = {column["name"] for column in profile.get("columns", [])}
        mapping = proposal.get("mapping") if isinstance(proposal.get("mapping"), dict) else {}
        sanitized_mapping: dict[str, str | None] = {}
        all_fields = [*TARGET_SCHEMA["required_fields"], *TARGET_SCHEMA["optional_fields"]]
        warnings = [str(item) for item in proposal.get("warnings", []) if isinstance(item, str)]
        for field in all_fields:
            value = mapping.get(field)
            if value is None:
                sanitized_mapping[field] = None
            elif isinstance(value, str) and value in valid_columns:
                sanitized_mapping[field] = value
            else:
                sanitized_mapping[field] = None
                warnings.append(f"Ignored invalid source column for {field}.")

        confidence = proposal.get("confidence")
        if not isinstance(confidence, (int, float)):
            confidence = 0
        confidence = max(0, min(float(confidence), 1))

        detected_format = proposal.get("detected_format") if isinstance(proposal.get("detected_format"), dict) else {}
        return {
            "mapping": sanitized_mapping,
            "detected_format": detected_format,
            "confidence": round(confidence, 2),
            "warnings": warnings,
            "requires_user_confirmation": True,
        }
