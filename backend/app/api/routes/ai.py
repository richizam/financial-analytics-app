from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from backend.app.api.dependencies import get_ai_service
from backend.app.domain.ai import AiAssistantService
from backend.app.domain.ai.tools import AiToolValidationError
from backend.app.domain.ai.xai_client import XaiClientError, XaiConfigurationError
from backend.app.schemas.requests import AiChatRequest


router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/chat")
def chat(
    request: AiChatRequest,
    ai_service: AiAssistantService = Depends(get_ai_service),
) -> dict[str, Any]:
    try:
        return ai_service.chat(
            request.message,
            request.ruc,
            request.periodos,
            [
                item.model_dump() if hasattr(item, "model_dump") else item.dict()
                for item in request.conversation
            ],
        )
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
