from __future__ import annotations

from fastapi import Depends, Request

from backend.app.core.security import AuthenticatedUser, require_supabase_user
from backend.app.domain.ai import AiAssistantService
from backend.app.domain.financial import FinancialService


def get_financial_service(request: Request) -> FinancialService:
    return request.app.state.financial_service


def get_authorized_financial_service(
    request: Request,
    user: AuthenticatedUser = Depends(require_supabase_user),
) -> FinancialService:
    return request.app.state.financial_service.for_workspace(user.workspace_id)


def get_ai_service(
    request: Request,
    user: AuthenticatedUser = Depends(require_supabase_user),
) -> AiAssistantService:
    financial_service = request.app.state.financial_service.for_workspace(user.workspace_id)
    return request.app.state.ai_service.with_financial_service(financial_service)
