from __future__ import annotations

import pytest

from backend.app.domain.ai.csv_profile import build_csv_profile, heuristic_mapping
from backend.app.domain.ai.tools import AiContext, AiToolExecutor, AiToolValidationError
from backend.app.domain.financial import FinancialService


class MemoryStorage:
    kind = "memory"

    def __init__(self) -> None:
        self.files: dict[str, dict[str, str]] = {}

    def list_rucs(self) -> list[str]:
        return sorted(self.files)

    def list_periods(self, ruc: str) -> list[str]:
        return sorted(
            filename[:6]
            for filename in self.files.get(ruc, {})
            if filename.endswith(".csv") and filename[:6].isdigit()
        )

    def read(self, ruc: str, filename: str) -> str | None:
        return self.files.get(ruc, {}).get(filename)

    def upsert(self, ruc: str, filename: str, content: str) -> None:
        self.files.setdefault(ruc, {})[filename] = content


def service_with_data() -> FinancialService:
    storage = MemoryStorage()
    storage.upsert(
        "0990123456001",
        "202501.csv",
        "\n".join(
            [
                "fecha,asiento,tipo,codCuenta,nombreCuenta,descripcion,debe,haber,centroCosto",
                "2025-01-01,A1,VT,1.1.1.01,Caja,Factura 1,150.00,0.00,VENTAS",
                "2025-01-01,A1,VT,4.1.1.01,Ventas,Factura 1,0.00,150.00,VENTAS",
                "2025-01-02,A2,CV,5.1.1.01,Costo ventas,Costo 1,50.00,0.00,VENTAS",
                "2025-01-02,A2,CV,1.1.5.01,Inventario,Costo 1,0.00,50.00,VENTAS",
            ]
        ),
    )
    return FinancialService(storage)


def ai_context() -> AiContext:
    return AiContext(
        selected_ruc="0990123456001",
        selected_periodos=("202501",),
        allowed_rucs=("0990123456001",),
        available_periods_by_ruc={"0990123456001": ["202501"]},
    )


def test_ai_tool_summary_uses_backend_metrics():
    executor = AiToolExecutor(service_with_data())

    result = executor.execute(
        "getFinancialSummary",
        {
            "clientId": "0990123456001",
            "startDate": "2025-01-01",
            "endDate": "2025-01-31",
            "metrics": ["revenue", "gross_profit", "net_profit", "cash_in"],
        },
        ai_context(),
    )

    assert result["status"] == "success"
    assert result["source"] == "calculated_by_backend"
    assert result["metrics"]["revenue"]["value"] == 150
    assert result["metrics"]["gross_profit"]["value"] == 100
    assert result["metrics"]["cash_in"]["value"] == 150
    assert result["ui_action"]["periodos"] == ["202501"]


def test_ai_tool_rejects_forbidden_client():
    executor = AiToolExecutor(service_with_data())

    with pytest.raises(AiToolValidationError):
        executor.execute(
            "getFinancialSummary",
            {
                "clientId": "9999999999999",
                "startDate": "2025-01-01",
                "endDate": "2025-01-31",
                "metrics": ["revenue"],
            },
            ai_context(),
        )


def test_csv_profile_masks_text_examples_and_maps_columns():
    content = "\n".join(
        [
            "Fecha,Concepto,Debe,Haber,Cuenta",
            "2025-06-01,Payment to supplier 123456789,1200.00,0.00,6105",
            "2025-06-15,Invoice customer 987654321,0.00,2500.00,4101",
        ]
    )

    profile = build_csv_profile("sample.csv", content)
    proposal = heuristic_mapping(profile)

    concepto = next(column for column in profile["columns"] if column["name"] == "Concepto")
    assert concepto["examples"][0] == "Payment to supplier ***"
    assert proposal["mapping"]["transaction_date"] == "Fecha"
    assert proposal["mapping"]["debit"] == "Debe"
    assert proposal["mapping"]["credit"] == "Haber"
