"""LangGraph agent graph: agent (model) ↔ tools, with bounded tool rounds.

The graph is compiled once with a checkpointer and reused. Per-request handles
(the tool executor, the AiContext, the chat model) are injected through
`config["configurable"]`, never stored in the checkpointed state.

The clarification (interrupt) node is added in a later step; today the graph is
the legacy loop ported onto LangGraph with tool-error self-correction and
node-level retry.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from langchain_core.messages import SystemMessage, ToolMessage, trim_messages
from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy, interrupt

from .state import AgentState
from .tool_registry import CLARIFY_TOOL_NAME, build_tool_specs, run_tool

_logger = logging.getLogger("backend.app.domain.ai.langgraph")

# Matches the legacy `for _ in range(3)` cap: agent→tools repeated ~3×.
RECURSION_LIMIT = 8

# Recent conversation window sent to the model. System/context messages are
# layered on top per turn (not persisted, not counted here), so token use stays
# bounded no matter how long the persisted thread grows.
MAX_WINDOW_MESSAGES = 14


def _configurable(config: dict[str, Any]) -> dict[str, Any]:
    return (config or {}).get("configurable", {}) or {}


def _trim_window(messages: list[Any]) -> list[Any]:
    """Keep the last MAX_WINDOW_MESSAGES conversation messages without orphaning a
    tool result from the assistant tool-call that produced it (start_on='human')."""
    if len(messages) <= MAX_WINDOW_MESSAGES:
        return messages
    try:
        return trim_messages(
            messages,
            max_tokens=MAX_WINDOW_MESSAGES,
            token_counter=len,  # count messages, not tokens
            strategy="last",
            start_on="human",
            include_system=False,
            allow_partial=False,
        )
    except Exception:  # pragma: no cover - defensive: never block a turn on trimming
        window = messages[-MAX_WINDOW_MESSAGES:]
        while window and not _is_human(window[0]):
            window = window[1:]
        return window or messages[-1:]


def _is_human(message: Any) -> bool:
    return getattr(message, "type", None) == "human" or message.__class__.__name__ == "HumanMessage"


def _dedupe_system(messages: list[Any]) -> list[Any]:
    """Safety net: collapse duplicate system/context blocks before the model call."""
    seen: set[str] = set()
    out: list[Any] = []
    for message in messages:
        if isinstance(message, SystemMessage):
            key = message.content if isinstance(message.content, str) else str(message.content)
            if key in seen:
                continue
            seen.add(key)
        out.append(message)
    return out


def _log_model_call(ai_message: Any, model_input: list[Any], elapsed_ms: float) -> None:
    usage = getattr(ai_message, "usage_metadata", None) or {}
    _logger.info(
        "langgraph model call: messages=%d input_tokens=%s output_tokens=%s total_tokens=%s latency_ms=%.0f",
        len(model_input),
        usage.get("input_tokens"),
        usage.get("output_tokens"),
        usage.get("total_tokens"),
        elapsed_ms,
    )


def _agent_node(state: AgentState, config: dict[str, Any]) -> dict[str, Any]:
    cfg = _configurable(config)
    model = cfg["model"]
    executor = cfg["executor"]
    context = cfg["context"]

    # System prompt + current app context come from config (rebuilt every turn),
    # never from persisted state, so they appear exactly once and always reflect
    # the latest RUC/periods. Persisted state holds only the conversation.
    system_messages = cfg.get("system_messages") or []
    window = _trim_window(state.get("messages") or [])
    model_input = _dedupe_system([*system_messages, *window])

    specs = build_tool_specs(executor, context)
    bound = model.bind_tools(specs, parallel_tool_calls=False) if specs else model

    started = time.monotonic()
    ai_message = bound.invoke(model_input)
    _log_model_call(ai_message, model_input, (time.monotonic() - started) * 1000)
    return {"messages": [ai_message]}


def _tools_node(state: AgentState, config: dict[str, Any]) -> dict[str, Any]:
    cfg = _configurable(config)
    executor = cfg["executor"]
    context = cfg["context"]

    last = state["messages"][-1]
    tool_calls = getattr(last, "tool_calls", None) or []

    tool_messages: list[ToolMessage] = []
    results: list[dict[str, Any]] = []
    turn_id = str(state.get("turn_id") or "")
    for call in tool_calls:
        outcome = run_tool(executor, context, call["name"], call.get("args") or {})
        tool_messages.append(
            ToolMessage(
                content=json.dumps(outcome.content, ensure_ascii=False),
                tool_call_id=call["id"],
                name=call["name"],
            )
        )
        if outcome.result is not None:
            tracked_result = dict(outcome.result)
            tracked_result["_turn_id"] = turn_id
            results.append(tracked_result)

    return {"messages": tool_messages, "executed_results": results}


def _clarify_call(message: Any) -> dict[str, Any] | None:
    for call in getattr(message, "tool_calls", None) or []:
        if call.get("name") == CLARIFY_TOOL_NAME:
            return call
    return None


def _clarify_node(state: AgentState, config: dict[str, Any]) -> dict[str, Any]:
    last = state["messages"][-1]
    call = _clarify_call(last) or {"id": "", "args": {}}
    payload = call.get("args") or {}

    # Pauses the run; the orchestrator surfaces `payload` to the UI. On resume,
    # `answer` is the user's reply and the run continues from here.
    answer = interrupt(
        {
            "question": payload.get("question"),
            "options": payload.get("options"),
            "field": payload.get("field"),
        }
    )

    return {
        "messages": [
            ToolMessage(
                content=json.dumps({"user_answer": answer}, ensure_ascii=False),
                tool_call_id=call.get("id") or "",
                name=CLARIFY_TOOL_NAME,
            )
        ]
    }


def _route_after_agent(state: AgentState) -> str:
    last = state["messages"][-1]
    if _clarify_call(last):
        return "clarify"
    if getattr(last, "tool_calls", None):
        return "tools"
    return END


def build_graph(checkpointer: Any):
    builder = StateGraph(AgentState)
    # Transient model errors (timeout / 5xx / 429) are retried at the node level;
    # the model adapter also retries at the HTTP layer.
    builder.add_node("agent", _agent_node, retry=RetryPolicy(max_attempts=3))
    builder.add_node("tools", _tools_node)
    builder.add_node("clarify", _clarify_node)

    builder.add_edge(START, "agent")
    builder.add_conditional_edges(
        "agent",
        _route_after_agent,
        {"tools": "tools", "clarify": "clarify", END: END},
    )
    builder.add_edge("tools", "agent")
    builder.add_edge("clarify", "agent")

    return builder.compile(checkpointer=checkpointer)
