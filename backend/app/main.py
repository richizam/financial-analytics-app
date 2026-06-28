from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.router import protected_router, public_router
from backend.app.core.config import get_settings
from backend.app.domain.ai import AiAssistantService
from backend.app.domain.financial import FinancialService
from backend.app.storage import create_storage
from backend.app.storage.postgres import (
    close_pools,
    close_request_connection,
    open_request_connection,
    warmup_pool,
)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Warm the shared DB connection pool so the first request doesn't pay the
    # ~1.7s connection setup; close all pools cleanly on shutdown.
    settings = get_settings()
    if settings.database_url:
        warmup_pool(settings.database_url)
    try:
        yield
    finally:
        close_pools()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def _db_request_scope(request, call_next):
        # Open a request-scoped DB connection so the request's queries reuse one
        # validated connection instead of borrowing (and re-checking) per query.
        # Lazy: no connection is borrowed unless the request actually queries.
        if not settings.database_url:
            return await call_next(request)
        holder, token = open_request_connection(settings.database_url)
        try:
            return await call_next(request)
        finally:
            close_request_connection(holder, token)

    storage = create_storage(settings)
    app.state.financial_service = FinancialService(storage)

    # Build the LangGraph orchestrator (with a Postgres checkpointer) once at
    # startup so the checkpointer/connection pool is shared across requests.
    orchestrator = None
    if settings.ai_orchestrator == "langgraph":
        from backend.app.domain.ai.checkpointer import build_checkpointer
        from backend.app.domain.ai.orchestrator import LangGraphOrchestrator

        checkpointer = build_checkpointer(settings)
        orchestrator = LangGraphOrchestrator(settings, checkpointer=checkpointer)

    app.state.ai_service = AiAssistantService(
        app.state.financial_service, settings, orchestrator=orchestrator
    )
    app.include_router(public_router)
    app.include_router(protected_router, prefix=settings.api_prefix)
    return app


app = create_app()
