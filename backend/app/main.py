from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.router import protected_router, public_router
from backend.app.core.config import get_settings
from backend.app.domain.ai import AiAssistantService
from backend.app.domain.financial import FinancialService
from backend.app.storage import create_storage


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    storage = create_storage(settings)
    app.state.financial_service = FinancialService(storage)
    app.state.ai_service = AiAssistantService(app.state.financial_service, settings)
    app.include_router(public_router)
    app.include_router(protected_router, prefix=settings.api_prefix)
    return app


app = create_app()
