"""xAI/Grok chat model for the LangGraph orchestrator.

xAI exposes an OpenAI-compatible API, so `langchain_openai.ChatOpenAI` pointed at
the xAI base URL gives us tool-calling, retries, and message handling for free.
This module is imported only when `settings.ai_orchestrator == "langgraph"`, so the
langchain dependency never loads on the legacy path.
"""
from __future__ import annotations

from typing import Any

from backend.app.core.config import Settings


def build_chat_model(settings: Settings, **overrides: Any):
    """Construct the xAI chat model. `max_retries` gives transient-error backoff
    (timeouts / 5xx / 429) at the HTTP layer; node-level RetryPolicy in the graph
    handles the rest."""
    from langchain_openai import ChatOpenAI

    kwargs: dict[str, Any] = {
        "model": settings.xai_model,
        "base_url": settings.xai_base_url,
        "api_key": settings.xai_api_key,
        "temperature": 0.2,
        "timeout": settings.xai_timeout_seconds,
        "max_retries": 3,
        # xAI-specific knob passed straight through to the request body.
        "extra_body": {"reasoning_effort": settings.xai_reasoning_effort},
    }
    kwargs.update(overrides)
    return ChatOpenAI(**kwargs)
