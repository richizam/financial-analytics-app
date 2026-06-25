"""Adapter exposing the existing AiToolExecutor tools to the LangGraph agent.

The 7 tools and their financial logic live unchanged in tools.py. This module
only (a) reshapes `AiToolExecutor.definitions(context)` into the OpenAI tool
format that `ChatOpenAI.bind_tools()` accepts, and (b) runs a tool call so that
an `AiToolValidationError` becomes self-correction feedback (a tool message the
model can react to) instead of aborting the whole turn.

Adding a tool stays a single edit in tools.py (schema in `definitions()` +
handler in `execute()`); it is surfaced here automatically.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .tools import AiContext, AiToolExecutor, AiToolValidationError


CLARIFY_TOOL_NAME = "askClarification"

# Routed to the graph's clarify (interrupt) node, never to AiToolExecutor.execute.
CLARIFY_TOOL_SPEC: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": CLARIFY_TOOL_NAME,
        "description": (
            "Pregunta al usuario por informacion faltante o ambigua (periodo, empresa, "
            "metrica) ANTES de ejecutar otra herramienta. Usala solo cuando no puedas "
            "resolver la solicitud con el contexto disponible."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Pregunta clara para el usuario."},
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Opciones sugeridas para responder (opcional).",
                },
                "field": {"type": "string", "description": "Dato que falta, p.ej. 'periodo'."},
            },
            "required": ["question"],
            "additionalProperties": False,
        },
    },
}


@dataclass(frozen=True)
class ToolOutcome:
    name: str
    content: dict[str, Any]   # JSON-serializable payload fed back to the model
    result: dict[str, Any] | None  # the tool result when successful, else None
    is_error: bool


def build_tool_specs(executor: AiToolExecutor, context: AiContext) -> list[dict[str, Any]]:
    """OpenAI-format tool specs for ChatOpenAI.bind_tools(), including the
    clarification tool the agent uses to ask the user for missing info."""
    specs: list[dict[str, Any]] = []
    for definition in executor.definitions(context):
        specs.append(
            {
                "type": "function",
                "function": {
                    "name": definition["name"],
                    "description": definition.get("description", ""),
                    "parameters": definition.get("parameters", {}),
                },
            }
        )
    specs.append(CLARIFY_TOOL_SPEC)
    return specs


def run_tool(
    executor: AiToolExecutor,
    context: AiContext,
    name: str,
    raw_args: Any,
) -> ToolOutcome:
    """Execute one tool call. Validation errors are returned as structured
    feedback (is_error=True) so the agent node can let the model retry."""
    try:
        result = executor.execute(name, raw_args, context)
    except AiToolValidationError as exc:
        return ToolOutcome(
            name=name,
            content={
                "error": str(exc),
                "hint": "Revisa los argumentos de la herramienta y vuelve a intentar.",
            },
            result=None,
            is_error=True,
        )
    return ToolOutcome(name=name, content=result, result=result, is_error=False)
