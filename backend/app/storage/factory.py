from __future__ import annotations

from backend.app.core.config import Settings

from .base import CsvStorage
from .file import FileCsvStorage
from .postgres import DatabaseCsvStorage


def create_storage(settings: Settings) -> CsvStorage:
    if settings.backend_storage in {"auto", "db"} and settings.database_url:
        try:
            db = DatabaseCsvStorage(settings.database_url)
            db.ensure_schema()
            db.ping()
            return db
        except Exception:
            if settings.backend_storage == "db":
                raise

    return FileCsvStorage(settings.data_root)
