from __future__ import annotations

import os
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


@dataclass(frozen=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", os.getenv("NODE_ENV", "local")).lower()
    app_name: str = "Financial Analytics Backend"
    api_prefix: str = "/api/v1"

    backend_storage: str = os.getenv("BACKEND_STORAGE", "auto").strip().lower()
    database_url: str | None = os.getenv("DATABASE_URL")
    data_root: Path = Path(os.getenv("DATA_ROOT", "data/empresas"))

    cors_origins: tuple[str, ...] = tuple(
        _csv_env("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    )

    backend_api_key: str | None = os.getenv("BACKEND_API_KEY")
    backend_require_api_key: bool = _bool_env(
        "BACKEND_REQUIRE_API_KEY",
        os.getenv("APP_ENV", os.getenv("NODE_ENV", "local")).lower() in {"prod", "production"},
    )

    xai_api_key: str | None = os.getenv("XAI_API_KEY")
    xai_base_url: str = os.getenv("XAI_BASE_URL", "https://api.x.ai/v1").strip()
    xai_model: str = os.getenv("XAI_MODEL", "grok-4.3").strip()
    xai_timeout_seconds: float = float(os.getenv("XAI_TIMEOUT_SECONDS", "45"))

    @property
    def api_key_required(self) -> bool:
        return self.backend_require_api_key or bool(self.backend_api_key)

    @property
    def xai_configured(self) -> bool:
        return bool(self.xai_api_key)

    @property
    def is_production(self) -> bool:
        return self.app_env in {"prod", "production"}

    def validate(self) -> None:
        if self.backend_storage not in {"auto", "db", "file"}:
            raise RuntimeError("BACKEND_STORAGE must be auto, db, or file")
        if self.backend_storage == "db" and not self.database_url:
            raise RuntimeError("DATABASE_URL is required when BACKEND_STORAGE=db")
        if self.api_key_required and not self.backend_api_key:
            raise RuntimeError("BACKEND_API_KEY is required when backend API key protection is enabled")
        if not self.xai_base_url:
            raise RuntimeError("XAI_BASE_URL cannot be empty")
        if not self.xai_model:
            raise RuntimeError("XAI_MODEL cannot be empty")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.validate()
    return settings
