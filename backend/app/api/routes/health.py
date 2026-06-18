from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from backend.app.api.dependencies import get_financial_service
from backend.app.domain.financial import FinancialService


router = APIRouter(tags=["health"])


@router.get("/health")
def health(service: FinancialService = Depends(get_financial_service)) -> dict[str, Any]:
    return {"ok": True, "storage": service.storage.kind}
