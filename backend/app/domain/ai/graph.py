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
from typing import Any

from langchain_core.messages import ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy, interrupt

from .state import AgentState
from .tool_registry import CLARIFY_TOOL_NAME, build_tool_specs, run_tool

# Matches the legacy `for _ in range(3)` cap: agent→tools repeated ~3×.
RECURSION_LIMIT = 8


def _configurable(config: dict[str, Any]) -> dict[str, Any]:
    return (config or {}).get("configurable", {}) or {}


def _agent_node(state: AgentState, config: dict[str, Any]) -> dict[str, Any]:
    cfg = _configurable(config)
    model = cfg["model"]
    executor = cfg["executor"]
    context = cfg["context"]

    specs = build_tool_specs(executor, context)
    bound = model.bind_tools(specs, parallel_tool_calls=False) if specs else model
    ai_message = bound.invoke(state["messages"])
    return {"messages": [ai_message]}


def _tools_node(state: AgentState, config: dict[str, Any]) -> dict[str, Any]:
    cfg = _configurable(config)
    executor = cfg["executor"]
    context = cfg["context"]

    last = state["messages"][-1]
    tool_calls = getattr(last, "tool_calls", None) or []

    tool_messages: list[ToolMessage] = []
    results: list[dict[str, Any]] = []
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
            results.append(outcome.result)

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
