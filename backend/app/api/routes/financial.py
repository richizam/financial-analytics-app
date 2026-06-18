from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from backend.app.api.dependencies import get_financial_service
from backend.app.domain.financial import FinancialService
from backend.app.schemas.requests import ComparativoRequest, MayorRequest, PeriodsRequest, RucsRequest


router = APIRouter(tags=["financial"])


@router.get("/rucs")
def rucs(service: FinancialService = Depends(get_financial_service)) -> list[str]:
    return service.get_available_rucs()


@router.post("/periods")
def periods(
    request: RucsRequest,
    service: FinancialService = Depends(get_financial_service),
) -> dict[str, list[str]]:
    return service.get_all_periods(request.rucs)


@router.post("/dashboard")
def dashboard(
    request: PeriodsRequest,
    service: FinancialService = Depends(get_financial_service),
) -> dict[str, Any] | None:
    return service.get_dashboard_data(request.ruc, request.periodos)


@router.post("/mayor")
def mayor(
    request: MayorRequest,
    service: FinancialService = Depends(get_financial_service),
) -> dict[str, Any]:
    return service.get_mayor_page_data(request.ruc, request.periodos, request.codCuenta)


@router.post("/mayor/completo")
def mayor_completo(
    request: PeriodsRequest,
    service: FinancialService = Depends(get_financial_service),
) -> list[dict[str, Any]]:
    return service.get_mayor_completo_data(request.ruc, request.periodos)


@router.post("/anomalies")
def anomalies(
    request: PeriodsRequest,
    service: FinancialService = Depends(get_financial_service),
) -> dict[str, Any] | None:
    return service.get_anomalies_data(request.ruc, request.periodos)


@router.post("/comparativo")
def comparativo(
    request: ComparativoRequest,
    service: FinancialService = Depends(get_financial_service),
) -> dict[str, Any] | None:
    return service.get_comparativo_data(request.ruc, request.periodosA, request.periodosB)


@router.post("/notas")
def notas(
    request: PeriodsRequest,
    service: FinancialService = Depends(get_financial_service),
) -> dict[str, Any] | None:
    return service.get_notas_data(request.ruc, request.periodos)
