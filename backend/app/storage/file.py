from __future__ import annotations

import re
from pathlib import Path

from .base import VALID_FILENAME, VALID_RUC


class FileCsvStorage:
    kind = "file"

    def __init__(self, data_root: Path) -> None:
        self.data_root = data_root.resolve()

    def _company_dir(self, ruc: str) -> Path:
        if not VALID_RUC.fullmatch(ruc):
            raise ValueError("RUC invalido")
        return self.data_root / ruc

    def _file_path(self, ruc: str, filename: str) -> Path:
        if not VALID_FILENAME.fullmatch(filename):
            raise ValueError("Nombre de archivo invalido")
        path = (self._company_dir(ruc) / filename).resolve()
        if not str(path).startswith(str(self.data_root)):
            raise ValueError("Ruta de archivo invalida")
        return path

    def list_rucs(self) -> list[str]:
        if not self.data_root.exists():
            return []
        return sorted(
            item.name
            for item in self.data_root.iterdir()
            if item.is_dir() and VALID_RUC.fullmatch(item.name)
        )

    def list_periods(self, ruc: str) -> list[str]:
        company_dir = self._company_dir(ruc)
        if not company_dir.exists():
            return []
        return sorted(
            item.stem
            for item in company_dir.iterdir()
            if item.is_file() and re.fullmatch(r"\d{6}\.csv", item.name, re.IGNORECASE)
        )

    def list_files(self, ruc: str) -> list[str]:
        company_dir = self._company_dir(ruc)
        if not company_dir.exists():
            return []
        return sorted(
            item.name
            for item in company_dir.iterdir()
            if item.is_file() and VALID_FILENAME.fullmatch(item.name)
        )

    def read(self, ruc: str, filename: str) -> str | None:
        path = self._file_path(ruc, filename)
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8-sig")

    def upsert(self, ruc: str, filename: str, content: str) -> None:
        path = self._file_path(ruc, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
