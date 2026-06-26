from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from backend.app.api.dependencies import get_ai_service
from backend.app.core.security import AuthenticatedUser, require_supabase_user
from backend.app.domain.ai import AiAssistantService
from backend.app.domain.ai.tools import AiToolValidationError
from backend.app.domain.ai.xai_client import XaiClientError, XaiConfigurationError
from backend.app.schemas.requests import AiChatRequest


router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/chat")
def chat(
    request: AiChatRequest,
    ai_service: AiAssistantService = Depends(get_ai_service),
    user: AuthenticatedUser = Depends(require_supabase_user),
) -> dict[str, Any]:
    # Public handle is the client's opaque conversation_id; the real LangGraph
    # thread_id is namespaced with the workspace so threads can't cross tenants.
    conversation_id = request.conversation_id or uuid.uuid4().hex
    thread_id = f"{user.workspace_id}:{conversation_id}"
    try:
        result = ai_service.chat(
            request.message,
            request.ruc,
            request.periodos,
            [
                item.model_dump() if hasattr(item, "model_dump") else item.dict()
                for item in request.conversation
            ],
            request.conversation_summary,
            thread_id=thread_id,
            resume=request.resume,
            workspace_id=user.workspace_id,
        )
        result.pop("thread_id", None)
        result["conversation_id"] = conversation_id
        return result
    except AiToolValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except XaiConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except XaiClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/csv-mapping")
async def csv_mapping(
    file: UploadFile = File(...),
    ai_service: AiAssistantService = Depends(get_ai_service),
) -> dict[str, Any]:
    raw = await file.read()
    if len(raw) > 2_000_000:
        raise HTTPException(status_code=413, detail="CSV is too large for AI profiling")
    content = raw.decode("utf-8-sig", errors="replace")
    return ai_service.suggest_csv_mapping(file.filename or "upload.csv", content)
