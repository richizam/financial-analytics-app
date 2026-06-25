from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class RucsRequest(BaseModel):
    rucs: list[str]


class PeriodsRequest(BaseModel):
    ruc: str
    periodos: list[str]


class MayorRequest(PeriodsRequest):
    codCuenta: str | None = None


class ComparativoRequest(BaseModel):
    ruc: str
    periodosA: list[str]
    periodosB: list[str]


class CompanyConfigRequest(BaseModel):
    config: dict[str, Any]


class CompanyCloneRequest(BaseModel):
    sourceRuc: str
    destRuc: str
    config: dict[str, Any] | None = None


class AiConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    ui_action: dict[str, Any] | None = None
    executed_tools: list[str] = []


class AiChatRequest(BaseModel):
    message: str
    ruc: str
    periodos: list[str] = []
    conversation: list[AiConversationMessage] = []
    conversation_summary: str | None = None
    # Opaque per-thread id from the client; namespaced with the workspace on the
    # server to form the LangGraph thread_id. Generated server-side if absent.
    conversation_id: str | None = None
    # The user's answer to a pending clarification (resumes an interrupted run).
    resume: str | None = None
