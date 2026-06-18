from __future__ import annotations

import json
from typing import Any

from backend.app.core.config import Settings
from backend.app.domain.financial import FinancialService

from .csv_profile import TARGET_SCHEMA, build_csv_profile, heuristic_mapping, safe_json_dumps
from .prompts import CSV_MAPPING_PROMPT, SYSTEM_PROMPT
from .tools import AiContext, AiToolExecutor, AiToolValidationError
from .xai_client import XaiClient, XaiClientError, XaiConfigurationError


class AiAssistantService:
    def __init__(
        self,
        financial_service: FinancialService,
        settings: Settings,
        xai_client: XaiClient | None = None,
    ) -> None:
        self.financial_service = financial_service
        self.settings = settings
        self.xai_client = xai_client or XaiClient(settings)
        self.tools = AiToolExecutor(financial_service)

    def chat(self, message: str, ruc: str, periodos: list[str], conversation: list[dict[str, str]]) -> dict[str, Any]:
        clean_message = message.strip()
        if not clean_message:
            raise AiToolValidationError("message is required")

        context = self._context(ruc, periodos)
        messages = self._initial_input(clean_message, context, conversation)
        response = self.xai_client.create_chat_completion(
            messages,
            tools=self.tools.definitions(context),
        )

        executed_results: list[dict[str, Any]] = []
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

        message_text = self._chat_text(response)
        if not message_text:
            message_text = "No pude generar una explicacion, pero el backend si proceso la solicitud."

        ui_action = self._first_ui_action(executed_results)
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
        conversation: list[dict[str, str]],
    ) -> list[dict[str, Any]]:
        context_payload = {
            "selected_client_id": context.selected_ruc,
            "selected_periods": list(context.selected_periodos),
            "available_clients": list(context.allowed_rucs),
            "available_periods_for_selected_client": context.available_periods_by_ruc.get(context.selected_ruc, []),
        }
        input_items: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        for item in conversation[-6:]:
            role = item.get("role")
            content = str(item.get("content") or "")[:2000]
            if role in {"user", "assistant"} and content:
                input_items.append({"role": role, "content": content})
        input_items.append(
            {
                "role": "user",
                "content": (
                    "Backend context JSON:\n"
                    f"{json.dumps(context_payload, ensure_ascii=False)}\n\n"
                    f"User question:\n{message}"
                ),
            }
        )
        return input_items

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
