from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class RucsRequest(BaseModel):
    rucs: list[str]


class PeriodsRequest(BaseModel):
    ruc: str
    periodos: list[str]


class MayorRequest(PeriodsRequest):
    codCuenta: str | None = None


class ComparativoRequest(BaseModel):
    ruc: str
    periodosA: list[str]
    periodosB: list[str]


class CompanyConfigRequest(BaseModel):
    config: dict[str, Any]
