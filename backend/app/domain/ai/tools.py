from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date
from typing import Any

from backend.app.domain.financial import FinancialService


SUPPORTED_METRICS = {
    "revenue",
    "costs",
    "gross_profit",
    "gross_margin",
    "operating_profit",
    "net_profit",
    "ebitda",
    "assets",
    "liabilities",
    "equity",
    "current_ratio",
    "cash_in",
    "cash_out",
}


class AiToolValidationError(ValueError):
    pass


@dataclass(frozen=True)
class AiContext:
    selected_ruc: str
    selected_periodos: tuple[str, ...]
    allowed_rucs: tuple[str, ...]
    available_periods_by_ruc: dict[str, list[str]]


def cents(value: int | float) -> float:
    return round(float(value) / 100, 2)


def ratio(value: int | float | None) -> float | None:
    return None if value is None else round(float(value), 4)


def _result_id(prefix: str, payload: dict[str, Any]) -> str:
    digest = hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


def _parse_date(value: Any, field: str) -> date:
    if not isinstance(value, str):
        raise AiToolValidationError(f"{field} must be a YYYY-MM-DD string")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise AiToolValidationError(f"{field} must be a valid YYYY-MM-DD date") from exc


def _period_month_index(periodo: str) -> int:
    return int(periodo[:4]) * 12 + int(periodo[4:6])


def _date_month_index(value: date) -> int:
    return value.year * 12 + value.month


def _periods_between(available: list[str], start: date, end: date) -> list[str]:
    start_index = _date_month_index(start)
    end_index = _date_month_index(end)
    return [
        periodo
        for periodo in sorted(available)
        if re.fullmatch(r"\d{6}", periodo)
        and start_index <= _period_month_index(periodo) <= end_index
    ]


def _periods_to_filters(periodos: list[str]) -> dict[str, Any]:
    if not periodos:
        return {"startDate": None, "endDate": None, "granularity": "monthly"}
    sorted_periods = sorted(periodos)
    start = sorted_periods[0]
    end = sorted_periods[-1]
    end_year = int(end[:4])
    end_month = int(end[4:6])
    if end_month == 12:
        end_date = date(end_year, 12, 31)
    else:
        end_date = date(end_year, end_month + 1, 1).replace(day=1)
        end_date = date.fromordinal(end_date.toordinal() - 1)
    return {
        "startDate": f"{start[:4]}-{start[4:6]}-01",
        "endDate": end_date.isoformat(),
        "granularity": "monthly",
    }


def _validate_date_range(start: date, end: date) -> None:
    if start > end:
        raise AiToolValidationError("startDate must be before or equal to endDate")
    if (end - start).days > 730:
        raise AiToolValidationError("Date range is too large; maximum is 730 days")


class AiToolExecutor:
    def __init__(self, financial_service: FinancialService) -> None:
        self.financial_service = financial_service

    def definitions(self, context: AiContext) -> list[dict[str, Any]]:
        clients = list(context.allowed_rucs) or [context.selected_ruc]
        client_schema = {
            "type": "string",
            "enum": clients,
            "description": "Client RUC from backend context. Use selected_client_id unless the user explicitly asks for another allowed client.",
        }

        date_range_schema = {
            "type": "object",
            "properties": {
                "startDate": {"type": "string", "format": "date"},
                "endDate": {"type": "string", "format": "date"},
            },
            "required": ["startDate", "endDate"],
            "additionalProperties": False,
        }

        metrics_schema = {
            "type": "array",
            "items": {"type": "string", "enum": sorted(SUPPORTED_METRICS)},
            "minItems": 1,
        }

        return [
            {
                "type": "function",
                "name": "getFinancialSummary",
                "description": "Returns validated financial metrics for a client and date range.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clientId": client_schema,
                        "startDate": {"type": "string", "format": "date"},
                        "endDate": {"type": "string", "format": "date"},
                        "metrics": metrics_schema,
                        "granularity": {
                            "type": "string",
                            "enum": ["monthly", "quarterly", "yearly"],
                            "default": "monthly",
                        },
                    },
                    "required": ["clientId", "startDate", "endDate", "metrics"],
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "comparePeriods",
                "description": "Compares financial metrics between two date ranges.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clientId": client_schema,
                        "periodA": date_range_schema,
                        "periodB": date_range_schema,
                        "metrics": metrics_schema,
                    },
                    "required": ["clientId", "periodA", "periodB", "metrics"],
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "getRevenueBreakdown",
                "description": "Returns revenue accounts for a client and date range.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clientId": client_schema,
                        "startDate": {"type": "string", "format": "date"},
                        "endDate": {"type": "string", "format": "date"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
                    },
                    "required": ["clientId", "startDate", "endDate"],
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "getExpenseBreakdown",
                "description": "Returns cost and expense accounts for a client and date range.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clientId": client_schema,
                        "startDate": {"type": "string", "format": "date"},
                        "endDate": {"type": "string", "format": "date"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
                    },
                    "required": ["clientId", "startDate", "endDate"],
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "getVarianceDrivers",
                "description": "Returns deterministic drivers that changed most between two date ranges.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clientId": client_schema,
                        "periodA": date_range_schema,
                        "periodB": date_range_schema,
                        "limit": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5},
                    },
                    "required": ["clientId", "periodA", "periodB"],
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "getAnomalies",
                "description": "Returns a summarized anomaly risk result for a client and date range.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clientId": client_schema,
                        "startDate": {"type": "string", "format": "date"},
                        "endDate": {"type": "string", "format": "date"},
                    },
                    "required": ["clientId", "startDate", "endDate"],
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "renderDashboard",
                "description": "Returns frontend instructions for rendering an existing dashboard view.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "dashboardType": {
                            "type": "string",
                            "enum": [
                                "financial_summary",
                                "profit_and_loss",
                                "balance_sheet",
                                "revenue_breakdown",
                                "expense_breakdown",
                                "variance_analysis",
                                "anomalies",
                                "general_ledger",
                                "notes",
                            ],
                        },
                        "clientId": client_schema,
                        "filters": {
                            "type": "object",
                            "properties": {
                                "startDate": {"type": "string", "format": "date"},
                                "endDate": {"type": "string", "format": "date"},
                                "granularity": {
                                    "type": "string",
                                    "enum": ["monthly", "quarterly", "yearly"],
                                    "default": "monthly",
                                },
                            },
                            "required": ["startDate", "endDate"],
                            "additionalProperties": False,
                        },
                    },
                    "required": ["dashboardType", "clientId", "filters"],
                    "additionalProperties": False,
                },
            },
        ]

    def execute(self, name: str, raw_args: Any, context: AiContext) -> dict[str, Any]:
        args = self._coerce_args(raw_args)
        if name == "getFinancialSummary":
            return self.get_financial_summary(args, context)
        if name == "comparePeriods":
            return self.compare_periods(args, context)
        if name == "getRevenueBreakdown":
            return self.get_breakdown(args, context, "revenue")
        if name == "getExpenseBreakdown":
            return self.get_breakdown(args, context, "expense")
        if name == "getVarianceDrivers":
            return self.get_variance_drivers(args, context)
        if name == "getAnomalies":
            return self.get_anomalies(args, context)
        if name == "renderDashboard":
            return self.render_dashboard(args, context)
        raise AiToolValidationError(f"Unsupported tool: {name}")

    def _coerce_args(self, raw_args: Any) -> dict[str, Any]:
        if isinstance(raw_args, dict):
            return raw_args
        if isinstance(raw_args, str):
            try:
                parsed = json.loads(raw_args)
            except json.JSONDecodeError as exc:
                raise AiToolValidationError("Tool arguments must be valid JSON") from exc
            if isinstance(parsed, dict):
                return parsed
        raise AiToolValidationError("Tool arguments must be a JSON object")

    def _client_id(self, args: dict[str, Any], context: AiContext) -> str:
        client_id = str(args.get("clientId") or context.selected_ruc)
        if client_id not in context.allowed_rucs:
            raise AiToolValidationError("Forbidden client access")
        return client_id

    def _periods_for_range(
        self,
        client_id: str,
        start_raw: Any,
        end_raw: Any,
        context: AiContext,
    ) -> tuple[date, date, list[str]]:
        start = _parse_date(start_raw, "startDate")
        end = _parse_date(end_raw, "endDate")
        _validate_date_range(start, end)
        periods = _periods_between(context.available_periods_by_ruc.get(client_id, []), start, end)
        return start, end, periods

    def _dashboard_for_periods(self, client_id: str, periodos: list[str]) -> dict[str, Any] | None:
        return self.financial_service.get_dashboard_data(client_id, periodos)

    def _metrics_from_dashboard(
        self,
        dashboard: dict[str, Any],
        periodos: list[str],
        requested_metrics: list[str],
        client_id: str,
    ) -> dict[str, Any]:
        eri = dashboard["eri"]
        esf = dashboard["esf"]
        ratios_by_key: dict[str, Any] = {}
        for group in dashboard["metricas"].values():
            for item in group:
                ratios_by_key[item["clave"]] = item

        cash_summary = None
        if "cash_in" in requested_metrics or "cash_out" in requested_metrics:
            cash_summary = self.financial_service.get_cash_flow_summary(client_id, periodos)

        values: dict[str, Any] = {
            "revenue": {"label": "Ingresos", "value": cents(eri["ingresos"]["total"]), "unit": "USD"},
            "costs": {
                "label": "Costos y gastos",
                "value": cents(
                    eri["costoVentas"]["total"]
                    + eri["gastosOperacion"]["total"]
                    + eri["otrosGastos"]["total"]
                ),
                "unit": "USD",
            },
            "gross_profit": {"label": "Utilidad bruta", "value": cents(eri["utilidadBruta"]), "unit": "USD"},
            "gross_margin": {"label": "Margen bruto", "value": ratio(eri["margenBruto"]), "unit": "ratio"},
            "operating_profit": {
                "label": "Utilidad operacional",
                "value": cents(eri["utilidadOperacional"]),
                "unit": "USD",
            },
            "net_profit": {"label": "Utilidad neta", "value": cents(eri["utilidadNeta"]), "unit": "USD"},
            "ebitda": {"label": "EBITDA", "value": cents(eri["ebitda"]), "unit": "USD"},
            "assets": {"label": "Total activos", "value": cents(esf["totalActivos"]), "unit": "USD"},
            "liabilities": {"label": "Total pasivos", "value": cents(esf["totalPasivos"]), "unit": "USD"},
            "equity": {"label": "Total patrimonio", "value": cents(esf["totalPatrimonio"]), "unit": "USD"},
            "current_ratio": {
                "label": "Razon corriente",
                "value": ratio(ratios_by_key.get("razonCorriente", {}).get("valor")),
                "unit": "times",
            },
        }

        if cash_summary:
            values["cash_in"] = {"label": "Entradas de efectivo", "value": cents(cash_summary["cashIn"]), "unit": "USD"}
            values["cash_out"] = {"label": "Salidas de efectivo", "value": cents(cash_summary["cashOut"]), "unit": "USD"}

        return {metric: values[metric] for metric in requested_metrics if metric in values}

    def _validate_metrics(self, raw_metrics: Any) -> list[str]:
        if not isinstance(raw_metrics, list) or not raw_metrics:
            raise AiToolValidationError("metrics must be a non-empty array")
        metrics = [str(metric) for metric in raw_metrics]
        unsupported = [metric for metric in metrics if metric not in SUPPORTED_METRICS]
        if unsupported:
            raise AiToolValidationError(f"Unsupported metrics: {', '.join(unsupported)}")
        return metrics

    def get_financial_summary(self, args: dict[str, Any], context: AiContext) -> dict[str, Any]:
        client_id = self._client_id(args, context)
        start, end, periodos = self._periods_for_range(client_id, args.get("startDate"), args.get("endDate"), context)
        metrics = self._validate_metrics(args.get("metrics"))
        granularity = str(args.get("granularity") or "monthly")
        payload = {"clientId": client_id, "startDate": start.isoformat(), "endDate": end.isoformat(), "metrics": metrics}

        if not periodos:
            return {
                "tool_name": "getFinancialSummary",
                "result_id": _result_id("summary", payload),
                "status": "empty",
                "message": "No available periods overlap the requested date range.",
                "available_periods": context.available_periods_by_ruc.get(client_id, []),
            }

        dashboard = self._dashboard_for_periods(client_id, periodos)
        if not dashboard:
            return {
                "tool_name": "getFinancialSummary",
                "result_id": _result_id("summary", payload),
                "status": "empty",
                "message": "The backend returned no dashboard data for the requested periods.",
            }

        result = {
            "tool_name": "getFinancialSummary",
            "result_id": _result_id("summary", payload),
            "status": "success",
            "source": "calculated_by_backend",
            "client_id": client_id,
            "date_range": {"startDate": start.isoformat(), "endDate": end.isoformat()},
            "periodos": periodos,
            "granularity": granularity,
            "metrics": self._metrics_from_dashboard(dashboard, periodos, metrics, client_id),
            "monthly": [
                {
                    "periodo": item["periodo"],
                    "label": item["label"],
                    "revenue": cents(item["ingresos"]),
                    "costs": cents(item["costoVentas"]),
                    "gross_profit": cents(item["utilidadBruta"]),
                    "net_profit": cents(item["utilidadNeta"]),
                }
                for item in dashboard["monthlyChart"]
            ],
        }
        result["ui_action"] = self._ui_action("financial_summary", client_id, periodos)
        return result

    def compare_periods(self, args: dict[str, Any], context: AiContext) -> dict[str, Any]:
        client_id = self._client_id(args, context)
        period_a = args.get("periodA") if isinstance(args.get("periodA"), dict) else {}
        period_b = args.get("periodB") if isinstance(args.get("periodB"), dict) else {}
        metrics = self._validate_metrics(args.get("metrics"))

        args_a = {
            "clientId": client_id,
            "startDate": period_a.get("startDate"),
            "endDate": period_a.get("endDate"),
            "metrics": metrics,
        }
        args_b = {
            "clientId": client_id,
            "startDate": period_b.get("startDate"),
            "endDate": period_b.get("endDate"),
            "metrics": metrics,
        }
        summary_a = self.get_financial_summary(args_a, context)
        summary_b = self.get_financial_summary(args_b, context)
        comparison: dict[str, Any] = {}
        if summary_a.get("status") == "success" and summary_b.get("status") == "success":
            for metric in metrics:
                a_value = summary_a["metrics"].get(metric, {}).get("value")
                b_value = summary_b["metrics"].get(metric, {}).get("value")
                if a_value is None or b_value is None:
                    continue
                delta = round(float(b_value) - float(a_value), 2)
                pct = None if float(a_value) == 0 else round(delta / abs(float(a_value)), 4)
                comparison[metric] = {
                    "periodA": a_value,
                    "periodB": b_value,
                    "delta": delta,
                    "delta_pct": pct,
                    "unit": summary_b["metrics"].get(metric, {}).get("unit"),
                }

        payload = {"clientId": client_id, "periodA": period_a, "periodB": period_b, "metrics": metrics}
        return {
            "tool_name": "comparePeriods",
            "result_id": _result_id("compare", payload),
            "status": "success" if comparison else "empty",
            "source": "calculated_by_backend",
            "client_id": client_id,
            "summaryA": summary_a,
            "summaryB": summary_b,
            "comparison": comparison,
            "ui_action": summary_b.get("ui_action"),
        }

    def get_breakdown(self, args: dict[str, Any], context: AiContext, kind: str) -> dict[str, Any]:
        client_id = self._client_id(args, context)
        start, end, periodos = self._periods_for_range(client_id, args.get("startDate"), args.get("endDate"), context)
        limit = max(1, min(int(args.get("limit") or 8), 20))
        dashboard = self._dashboard_for_periods(client_id, periodos) if periodos else None
        payload = {"clientId": client_id, "startDate": start.isoformat(), "endDate": end.isoformat(), "kind": kind}
        if not dashboard:
            return {
                "tool_name": "getRevenueBreakdown" if kind == "revenue" else "getExpenseBreakdown",
                "result_id": _result_id("breakdown", payload),
                "status": "empty",
                "message": "No data is available for the requested range.",
            }

        eri = dashboard["eri"]
        if kind == "revenue":
            sections = [("ingresos", eri["ingresos"])]
            tool_name = "getRevenueBreakdown"
            dashboard_type = "revenue_breakdown"
        else:
            sections = [
                ("costoVentas", eri["costoVentas"]),
                ("gastosOperacion", eri["gastosOperacion"]),
                ("otrosGastos", eri["otrosGastos"]),
            ]
            tool_name = "getExpenseBreakdown"
            dashboard_type = "expense_breakdown"

        items: list[dict[str, Any]] = []
        for section_key, section in sections:
            for item in section["items"]:
                items.append(
                    {
                        "section": section_key,
                        "codCuenta": item["codCuenta"],
                        "nombreCuenta": item["nombreCuenta"],
                        "amount": cents(item["monto"]),
                    }
                )
        items.sort(key=lambda item: abs(float(item["amount"])), reverse=True)

        return {
            "tool_name": tool_name,
            "result_id": _result_id("breakdown", payload),
            "status": "success",
            "source": "calculated_by_backend",
            "client_id": client_id,
            "periodos": periodos,
            "items": items[:limit],
            "ui_action": self._ui_action(dashboard_type, client_id, periodos),
        }

    def get_variance_drivers(self, args: dict[str, Any], context: AiContext) -> dict[str, Any]:
        client_id = self._client_id(args, context)
        limit = max(1, min(int(args.get("limit") or 5), 10))
        period_a = args.get("periodA") if isinstance(args.get("periodA"), dict) else {}
        period_b = args.get("periodB") if isinstance(args.get("periodB"), dict) else {}
        metrics = ["revenue", "costs", "gross_profit", "operating_profit", "net_profit", "ebitda"]
        comparison = self.compare_periods(
            {"clientId": client_id, "periodA": period_a, "periodB": period_b, "metrics": metrics},
            context,
        )
        drivers = [
            {"metric": metric, **values}
            for metric, values in comparison.get("comparison", {}).items()
        ]
        drivers.sort(key=lambda item: abs(float(item.get("delta") or 0)), reverse=True)
        payload = {"clientId": client_id, "periodA": period_a, "periodB": period_b}
        return {
            "tool_name": "getVarianceDrivers",
            "result_id": _result_id("variance", payload),
            "status": "success" if drivers else "empty",
            "source": "calculated_by_backend",
            "client_id": client_id,
            "drivers": drivers[:limit],
            "ui_action": comparison.get("ui_action"),
        }

    def get_anomalies(self, args: dict[str, Any], context: AiContext) -> dict[str, Any]:
        client_id = self._client_id(args, context)
        start, end, periodos = self._periods_for_range(client_id, args.get("startDate"), args.get("endDate"), context)
        payload = {"clientId": client_id, "startDate": start.isoformat(), "endDate": end.isoformat()}
        data = self.financial_service.get_anomalies_data(client_id, periodos) if periodos else None
        if not data:
            return {
                "tool_name": "getAnomalies",
                "result_id": _result_id("anomalies", payload),
                "status": "empty",
                "message": "No anomaly data is available for the requested range.",
            }
        return {
            "tool_name": "getAnomalies",
            "result_id": _result_id("anomalies", payload),
            "status": "success",
            "source": "calculated_by_backend",
            "client_id": client_id,
            "periodos": periodos,
            "riskScore": data["riskScore"],
            "benford": {
                "riskLevel": data["benford"]["riskLevel"],
                "chiSquare": round(float(data["benford"]["chiSquare"]), 2),
                "sampleSize": data["benford"]["sampleSize"],
            },
            "duplicateGroups": len(data["duplicates"]),
            "outliers": len(data["outliers"]),
            "totalEntries": data["totalEntries"],
            "ui_action": self._ui_action("anomalies", client_id, periodos),
        }

    def render_dashboard(self, args: dict[str, Any], context: AiContext) -> dict[str, Any]:
        client_id = self._client_id(args, context)
        filters = args.get("filters") if isinstance(args.get("filters"), dict) else {}
        start, end, periodos = self._periods_for_range(client_id, filters.get("startDate"), filters.get("endDate"), context)
        dashboard_type = str(args.get("dashboardType") or "financial_summary")
        payload = {"clientId": client_id, "dashboardType": dashboard_type, "startDate": start.isoformat(), "endDate": end.isoformat()}
        return {
            "tool_name": "renderDashboard",
            "result_id": _result_id("render", payload),
            "status": "success" if periodos else "empty",
            "source": "frontend_instruction",
            "ui_action": self._ui_action(dashboard_type, client_id, periodos),
            "message": "Dashboard action prepared." if periodos else "No periods overlap this dashboard filter.",
        }

    def _ui_action(self, dashboard_type: str, client_id: str, periodos: list[str]) -> dict[str, Any]:
        route_by_type = {
            "anomalies": "/anomalies",
            "general_ledger": "/mayor",
            "notes": "/notas",
            "variance_analysis": "/comparativo",
        }
        return {
            "type": "render_dashboard",
            "dashboard_id": dashboard_type,
            "href": route_by_type.get(dashboard_type, "/"),
            "ruc": client_id,
            "periodos": periodos,
            "filters": _periods_to_filters(periodos),
        }
