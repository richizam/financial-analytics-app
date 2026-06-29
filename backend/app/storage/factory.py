from __future__ import annotations

from backend.app.core.config import Settings

from .base import CsvStorage
from .file import FileCsvStorage
from .postgres import DatabaseCsvStorage


def create_storage(settings: Settings) -> CsvStorage:
    if settings.is_production and settings.backend_storage == "auto" and not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for production storage")

    if settings.backend_storage in {"auto", "db"} and settings.database_url:
        try:
            db = DatabaseCsvStorage(settings.database_url)
            db.ensure_schema()
            db.ping()
            return db
        except Exception:
            if settings.backend_storage == "db" or settings.is_production:
                raise

    return FileCsvStorage(settings.data_root)
