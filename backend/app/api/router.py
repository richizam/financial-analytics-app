from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.app.core.security import require_backend_api_key

from .routes import company, financial, health, uploads


public_router = APIRouter()
public_router.include_router(health.router)

protected_router = APIRouter(dependencies=[Depends(require_backend_api_key)])
protected_router.include_router(financial.router)
protected_router.include_router(uploads.router)
protected_router.include_router(company.router)
