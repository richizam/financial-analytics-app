from __future__ import annotations

from fastapi import Request

from backend.app.domain.ai import AiAssistantService
from backend.app.domain.financial import FinancialService


def get_financial_service(request: Request) -> FinancialService:
    return request.app.state.financial_service


def get_ai_service(request: Request) -> AiAssistantService:
    return request.app.state.ai_service
