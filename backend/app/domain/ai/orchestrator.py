"""LangGraph-backed orchestrator for /ai/chat.

Produces exactly the same response dict as the legacy loop
(message, ui_action, citations, executed_tools, provider, model) so the API
contract and frontend are unchanged. The legacy fast path (local-intent
short-circuit) still runs in AiAssistantService before this is invoked.
"""
from __future__ import annotations

import uuid
from typing import Any

from backend.app.core.config import Settings

from .model_adapter import build_chat_model
from .tools import AiContext, AiToolExecutor


def _to_lc_messages(input_items: list[dict[str, Any]]) -> list[Any]:
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    messages: list[Any] = []
    for item in input_items:
        role = item.get("role")
        content = str(item.get("content") or "")
        if role == "system":
            messages.append(SystemMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
        else:
            messages.append(HumanMessage(content=content))
    return messages


def _system_lc_messages(input_items: list[dict[str, Any]]) -> list[Any]:
    return _to_lc_messages([item for item in input_items if item.get("role") == "system"])


def _conversation_lc_messages(input_items: list[dict[str, Any]]) -> list[Any]:
    return _to_lc_messages([item for item in input_items if item.get("role") in ("user", "assistant")])


class LangGraphOrchestrator:
    def __init__(self, settings: Settings, checkpointer: Any | None = None, model: Any | None = None) -> None:
        from langgraph.checkpoint.memory import MemorySaver

        from .graph import build_graph

        self.settings = settings
        self.checkpointer = checkpointer or MemorySaver()
        self.model = model or build_chat_model(settings)
        self.graph = build_graph(self.checkpointer)

    def chat(
        self,
        *,
        input_items: list[dict[str, Any]],
        context: AiContext,
        executor: AiToolExecutor,
        thread_id: str,
        new_message: str | None = None,
        resume: str | None = None,
        workspace_id: str | None = None,
    ) -> dict[str, Any]:
        from .graph import RECURSION_LIMIT

        # System prompt + current app context are passed through config (rebuilt
        # every turn) and layered onto the model input by the agent node. They are
        # never written to the persisted state, so the checkpoint holds only the
        # real conversation (user/assistant/tool) and token use stays bounded.
        config = {
            "configurable": {
                "thread_id": thread_id,
                "executor": executor,
                "context": context,
                "model": self.model,
                "system_messages": _system_lc_messages(input_items),
            },
            "recursion_limit": RECURSION_LIMIT,
        }

        # Resume an interrupted (clarification) run with the user's answer.
        if resume is not None:
            from langgraph.types import Command

            invoke_input: Any = Command(resume=resume)
        else:
            turn_id = uuid.uuid4().hex
            # Existing thread: append only the new user message (history is already
            # checkpointed). New thread: seed with the conversation messages only —
            # never the system/context blocks.
            if new_message is not None and self._thread_has_history(config):
                from langchain_core.messages import HumanMessage

                messages_in: list[Any] = [HumanMessage(content=new_message)]
            else:
                messages_in = _conversation_lc_messages(input_items)

            invoke_input = {
                "messages": messages_in,
                "ruc": context.selected_ruc,
                "periodos": list(context.selected_periodos),
                "workspace_id": workspace_id or "",
                "turn_id": turn_id,
                "executed_results": [],
            }

        try:
            final_state = self.graph.invoke(invoke_input, config)
        except Exception as exc:  # model/transport failure after retries
            return {
                "message": (
                    "No pude contactar al proveedor de AI en este momento. "
                    "Prueba otra vez en unos segundos."
                ),
                "ui_action": None,
                "citations": [],
                "executed_tools": [],
                "provider": "local-fallback",
                "model": self.settings.xai_model,
                "error": str(exc),
            }

        clarification = self._pending_interrupt(config)
        if clarification is not None:
            return self._clarification_response(final_state, clarification, thread_id)

        return self._finalize(final_state, thread_id)

    def _pending_interrupt(self, config: dict[str, Any]) -> dict[str, Any] | None:
        """A paused (interrupted) run exposes its payload via the state snapshot's
        pending tasks rather than the invoke() return value."""
        try:
            snapshot = self.graph.get_state(config)
        except Exception:
            return None
        for task in getattr(snapshot, "tasks", ()) or ():
            for itr in getattr(task, "interrupts", ()) or ():
                value = getattr(itr, "value", None)
                if isinstance(value, dict):
                    return value
                if value is not None:
                    return {"question": str(value)}
        return None

    def _clarification_response(
        self, final_state: Any, payload: dict[str, Any], thread_id: str
    ) -> dict[str, Any]:
        executed_results = self._current_turn_results(final_state if isinstance(final_state, dict) else {})
        question = payload.get("question") or "Necesito mas informacion para continuar."
        return {
            "message": question,
            "ui_action": None,
            "citations": [],
            "executed_tools": [str(r.get("tool_name")) for r in executed_results],
            "provider": "clarification",
            "model": self.settings.xai_model,
            "clarification": {
                "question": question,
                "options": payload.get("options") or [],
                "field": payload.get("field"),
            },
            "thread_id": thread_id,
        }

    def _thread_has_history(self, config: dict[str, Any]) -> bool:
        try:
            snapshot = self.graph.get_state(config)
        except Exception:
            return False
        values = getattr(snapshot, "values", None) or {}
        return bool(values.get("messages"))

    def _finalize(self, final_state: dict[str, Any], thread_id: str) -> dict[str, Any]:
        executed_results = self._current_turn_results(final_state)
        message_text = self._last_text(final_state.get("messages") or [])
        if not message_text:
            message_text = "No pude generar una explicacion, pero el backend si proceso la solicitud."

        # Navigation only when the model explicitly used a frontend_instruction tool.
        ui_action = None
        for result in reversed(executed_results):
            if result.get("source") == "frontend_instruction" and isinstance(result.get("ui_action"), dict):
                ui_action = result["ui_action"]
                break

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
            "provider": "langgraph",
            "model": self.settings.xai_model,
            "thread_id": thread_id,
        }

    @staticmethod
    def _current_turn_results(final_state: dict[str, Any]) -> list[dict[str, Any]]:
        turn_id = str(final_state.get("turn_id") or "")
        results = final_state.get("executed_results") or []
        if not turn_id:
            return [result for result in results if isinstance(result, dict)]
        return [
            result
            for result in results
            if isinstance(result, dict) and str(result.get("_turn_id") or "") == turn_id
        ]

    @staticmethod
    def _last_text(messages: list[Any]) -> str:
        for message in reversed(messages):
            if getattr(message, "type", None) == "ai" or message.__class__.__name__ == "AIMessage":
                content = getattr(message, "content", "")
                if isinstance(content, str) and content.strip():
                    return content.strip()
                if isinstance(content, list):
                    parts = [c.get("text", "") for c in content if isinstance(c, dict)]
                    joined = "".join(parts).strip()
                    if joined:
                        return joined
        return ""
