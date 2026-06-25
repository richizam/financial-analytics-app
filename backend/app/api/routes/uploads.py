from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, Form, UploadFile

from backend.app.api.dependencies import get_ai_service
from backend.app.domain.ai import AiAssistantService


router = APIRouter(tags=["uploads"])


@router.post("/upload-csv")
async def upload_csv(
    file: UploadFile = File(...),
    ruc: str = Form(...),
    mapping: str | None = Form(default=None),
    ai_service: AiAssistantService = Depends(get_ai_service),
) -> dict[str, Any]:
    raw = await file.read()
    content = raw.decode("utf-8-sig", errors="replace")
    parsed_mapping: dict[str, Any] | None = None
    if mapping:
        try:
            value = json.loads(mapping)
        except json.JSONDecodeError:
            return {"ok": False, "error": "El mapeo enviado no es JSON valido."}
        if not isinstance(value, dict):
            return {"ok": False, "error": "El mapeo enviado debe ser un objeto JSON."}
        parsed_mapping = value
    return ai_service.financial_service.upload_csv(
        ruc,
        file.filename or "",
        content,
        mapping=parsed_mapping,
        mapping_provider=ai_service.suggest_csv_mapping,
    )
