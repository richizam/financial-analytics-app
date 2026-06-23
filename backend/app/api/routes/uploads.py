from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, UploadFile

from backend.app.api.dependencies import get_authorized_financial_service
from backend.app.domain.financial import FinancialService


router = APIRouter(tags=["uploads"])


@router.post("/upload-csv")
async def upload_csv(
    file: UploadFile = File(...),
    ruc: str = Form(...),
    service: FinancialService = Depends(get_authorized_financial_service),
) -> dict[str, Any]:
    raw = await file.read()
    content = raw.decode("utf-8-sig", errors="replace")
    return service.upload_csv(ruc, file.filename or "", content)
