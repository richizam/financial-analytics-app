from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict

from langgraph.graph.message import add_messages


class AgentState(TypedDict, total=False):
    """Graph state. Only serializable data lives here (it is checkpointed);
    per-request handles like the tool executor and chat model are passed through
    RunnableConfig["configurable"] instead."""

    messages: Annotated[list, add_messages]
    ruc: str
    periodos: list[str]
    workspace_id: str
    # operator.add so each tools-node return appends rather than overwrites.
    executed_results: Annotated[list[dict[str, Any]], operator.add]
    pending_clarification: dict[str, Any] | None
