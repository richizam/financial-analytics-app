from __future__ import annotations

import re
from typing import Protocol


VALID_RUC = re.compile(r"^\d{13}$")
VALID_FILENAME = re.compile(r"^(\d{6}|saldos_iniciales_\d{4})\.csv$|^config\.json$", re.IGNORECASE)


class CsvStorage(Protocol):
    kind: str

    def list_rucs(self) -> list[str]:
        ...

    def list_periods(self, ruc: str) -> list[str]:
        ...

    def list_files(self, ruc: str) -> list[str]:
        ...

    def read(self, ruc: str, filename: str) -> str | None:
        ...

    def upsert(self, ruc: str, filename: str, content: str) -> None:
        ...

    def for_workspace(self, workspace_id: str) -> "CsvStorage":
        ...
