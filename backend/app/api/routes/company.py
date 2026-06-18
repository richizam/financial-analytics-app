from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from backend.app.api.dependencies import get_financial_service
from backend.app.domain.financial import FinancialService
from backend.app.schemas.requests import CompanyConfigRequest


router = APIRouter(tags=["company"])


@router.post("/company-config")
def save_company_config(
    request: CompanyConfigRequest,
    service: FinancialService = Depends(get_financial_service),
) -> dict[str, Any]:
    return service.save_company_config(request.config)


@router.get("/company-config/{ruc}")
def get_company_config(
    ruc: str,
    service: FinancialService = Depends(get_financial_service),
) -> dict[str, Any] | None:
    return service.get_company_config(ruc)
