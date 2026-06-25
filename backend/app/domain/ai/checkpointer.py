"""Postgres checkpointer for the LangGraph orchestrator.

Built once at startup. Uses a psycopg connection pool with prepared statements
DISABLED (`prepare_threshold=None`) and `autocommit=True` so it works through
Supabase's transaction-mode PgBouncer pooler (port 6543) as well as a direct
(session-mode, 5432) connection. Prefer `DATABASE_URL_DIRECT` when available.

If no DSN is configured or setup fails, returns None so the caller falls back to
an in-process MemorySaver (resume still works within a process lifetime).
"""
from __future__ import annotations

from typing import Any

from backend.app.core.config import Settings


def build_checkpointer(settings: Settings) -> Any | None:
    dsn = settings.checkpointer_dsn
    if not dsn:
        return None

    try:
        from psycopg_pool import ConnectionPool
        from langgraph.checkpoint.postgres import PostgresSaver

        pool = ConnectionPool(
            conninfo=dsn,
            max_size=int(getattr(settings, "checkpointer_pool_size", 4) or 4),
            kwargs={"autocommit": True, "prepare_threshold": None},
            open=True,
        )
        saver = PostgresSaver(pool)
        saver.setup()
        return saver
    except Exception as exc:  # noqa: BLE001 - degrade to in-memory rather than block boot
        import logging

        logging.getLogger(__name__).warning(
            "LangGraph Postgres checkpointer unavailable, falling back to in-memory: %s", exc
        )
        return None
