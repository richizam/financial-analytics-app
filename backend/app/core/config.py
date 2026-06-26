from __future__ import annotations

import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dependency is declared for real runs.
    def load_dotenv(*args: object, **kwargs: object) -> bool:
        return False


load_dotenv()


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _csv_env(name: str, default: str) -> list[str]:
    return [part.strip() for part in os.getenv(name, default).split(",") if part.strip()]


XAI_REASONING_EFFORTS = {"none", "low", "medium", "high"}


@dataclass(frozen=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", os.getenv("NODE_ENV", "local")).lower()
    app_name: str = "Financial Analytics Backend"
    api_prefix: str = "/api/v1"

    backend_storage: str = os.getenv("BACKEND_STORAGE", "auto").strip().lower()
    database_url: str | None = os.getenv("DATABASE_URL")
    # Direct (session-mode / port 5432) connection used ONLY by the LangGraph
    # Postgres checkpointer; the transaction-mode pooler (6543) breaks prepared
    # statements. Falls back to database_url when unset.
    database_url_direct: str | None = os.getenv("DATABASE_URL_DIRECT")
    data_root: Path = Path(os.getenv("DATA_ROOT", "data/empresas"))

    cors_origins: tuple[str, ...] = tuple(
        _csv_env("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    )

    backend_api_key: str | None = os.getenv("BACKEND_API_KEY")
    backend_require_api_key: bool = _bool_env(
        "BACKEND_REQUIRE_API_KEY",
        os.getenv("APP_ENV", os.getenv("NODE_ENV", "local")).lower() in {"prod", "production"},
    )

    supabase_url: str | None = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_publishable_key: str | None = (
        os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    )
    supabase_auth_required: bool = _bool_env(
        "SUPABASE_AUTH_REQUIRED",
        os.getenv("APP_ENV", os.getenv("NODE_ENV", "local")).lower() in {"prod", "production"},
    )

    xai_api_key: str | None = os.getenv("XAI_API_KEY")
    xai_base_url: str = os.getenv("XAI_BASE_URL", "https://api.x.ai/v1").strip()
    xai_model: str = os.getenv("XAI_MODEL", "grok-4.3").strip()
    xai_reasoning_effort: str = os.getenv("XAI_REASONING_EFFORT", "medium").strip().lower()
    xai_timeout_seconds: float = float(os.getenv("XAI_TIMEOUT_SECONDS", "45"))

    # Which AI orchestrator backs /ai/chat: "legacy" (hand-rolled loop) or
    # "langgraph" (graph + checkpointer + clarification). The app code keeps a
    # legacy default for non-compose/local processes; production compose sets it
    # explicitly to langgraph.
    ai_orchestrator: str = os.getenv("AI_ORCHESTRATOR", "legacy").strip().lower()
    langgraph_checkpoint_schema: str = os.getenv("LANGGRAPH_CHECKPOINT_SCHEMA", "app_private").strip()

    @property
    def api_key_required(self) -> bool:
        return self.backend_require_api_key or bool(self.backend_api_key)

    @property
    def xai_configured(self) -> bool:
        return bool(self.xai_api_key)

    @property
    def is_production(self) -> bool:
        return self.app_env in {"prod", "production"}

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_publishable_key)

    @property
    def supabase_auth_issuer(self) -> str:
        return f"{str(self.supabase_url).rstrip('/')}/auth/v1"

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_auth_issuer}/.well-known/jwks.json"

    def validate(self) -> None:
        if self.backend_storage not in {"auto", "db", "file"}:
            raise RuntimeError("BACKEND_STORAGE must be auto, db, or file")
        if self.backend_storage == "db" and not self.database_url:
            raise RuntimeError("DATABASE_URL is required when BACKEND_STORAGE=db")
        if self.api_key_required and not self.backend_api_key:
            raise RuntimeError("BACKEND_API_KEY is required when backend API key protection is enabled")
        if self.supabase_auth_required and not self.supabase_configured:
            raise RuntimeError("Supabase auth requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY")
        if not self.xai_base_url:
            raise RuntimeError("XAI_BASE_URL cannot be empty")
        if not self.xai_model:
            raise RuntimeError("XAI_MODEL cannot be empty")
        if self.xai_reasoning_effort not in XAI_REASONING_EFFORTS:
            raise RuntimeError("XAI_REASONING_EFFORT must be none, low, medium, or high")
        if self.ai_orchestrator not in {"legacy", "langgraph"}:
            raise RuntimeError("AI_ORCHESTRATOR must be legacy or langgraph")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", self.langgraph_checkpoint_schema):
            raise RuntimeError("LANGGRAPH_CHECKPOINT_SCHEMA must be a safe PostgreSQL identifier")

    @property
    def checkpointer_dsn(self) -> str | None:
        return self.database_url_direct or self.database_url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.validate()
    return settings
