"""Postgres checkpointer for the LangGraph orchestrator.

Built once at startup. Checkpoint tables are created in a private schema
(`app_private` by default), not `public`, so Supabase's Data API does not expose
LangGraph internals. Uses a psycopg connection pool with prepared statements
DISABLED (`prepare_threshold=None`) and `autocommit=True`. The pool configures
`search_path` after every connection opens because Supabase/PgBouncer may ignore
startup `options`. Prefer `DATABASE_URL_DIRECT` when available.

If no DSN is configured or setup fails, returns None so the caller falls back to
an in-process MemorySaver (resume still works within a process lifetime).
"""
from __future__ import annotations

from typing import Any

from backend.app.core.config import Settings


def _prepare_schema(pool: Any, schema: str) -> None:
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"create schema if not exists {schema}")


def build_checkpointer(settings: Settings) -> Any | None:
    dsn = settings.checkpointer_dsn
    if not dsn:
        if settings.is_production:
            raise RuntimeError("LangGraph production mode requires DATABASE_URL or DATABASE_URL_DIRECT")
        return None

    try:
        from psycopg_pool import ConnectionPool
        from langgraph.checkpoint.postgres import PostgresSaver

        schema = settings.langgraph_checkpoint_schema

        def configure_connection(conn: Any) -> None:
            conn.execute(f"set search_path to {schema}, public")

        pool = ConnectionPool(
            conninfo=dsn,
            max_size=int(getattr(settings, "checkpointer_pool_size", 4) or 4),
            kwargs={
                "autocommit": True,
                "prepare_threshold": None,
            },
            configure=configure_connection,
            open=True,
        )
        _prepare_schema(pool, schema)
        saver = PostgresSaver(pool)
        saver.setup()
        return saver
    except Exception as exc:  # noqa: BLE001 - degrade to in-memory rather than block boot
        if settings.is_production:
            raise RuntimeError("LangGraph Postgres checkpointer unavailable") from exc
        import logging

        logging.getLogger(__name__).warning(
            "LangGraph Postgres checkpointer unavailable, falling back to in-memory: %s", exc
        )
        return None
