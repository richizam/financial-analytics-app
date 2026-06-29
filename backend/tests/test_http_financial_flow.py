from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api.router import protected_router
from backend.app.core import security
from backend.app.core.config import Settings
from backend.app.core.security import AuthenticatedUser, require_supabase_user
from backend.app.domain.financial import FinancialService
from backend.app.storage.file import FileCsvStorage


RUC_A = "0991111111001"
RUC_B = "0992222222001"
API_KEY = "server-only-key"


class WorkspaceFileStorage(FileCsvStorage):
    def for_workspace(self, workspace_id: str) -> FileCsvStorage:
        safe_workspace = "".join(ch for ch in workspace_id if ch.isalnum() or ch in {"-", "_"})
        return FileCsvStorage(self.data_root / safe_workspace)


class FakeAiService:
    def __init__(self, financial_service: FinancialService | None = None) -> None:
        self.financial_service = financial_service

    def with_financial_service(self, financial_service: FinancialService) -> "FakeAiService":
        return FakeAiService(financial_service)

    def suggest_csv_mapping(self, _filename: str, _content: str) -> dict[str, Any]:
        return {
            "provider": "test-ai",
            "proposal": {
                "mapping": {
                    "transaction_date": "DocDate",
                    "description": "Narrative",
                    "debit": "DebitValue",
                    "credit": "CreditValue",
                    "amount": None,
                    "account_code": "Acct",
                    "account_name": "AcctName",
                    "journal_entry": "VoucherId",
                    "entry_type": None,
                    "currency": None,
                    "cost_center": None,
                    "document_number": None,
                },
                "confidence": 1,
                "warnings": [],
                "requires_user_confirmation": False,
                "detected_format": {},
            },
            "warnings": [],
        }


def _build_client(tmp_path: Path, monkeypatch) -> tuple[TestClient, dict[str, str]]:
    active = {"workspace": "ws-a"}

    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: Settings(
            app_env="production",
            backend_api_key=API_KEY,
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_test",
        ),
    )

    app = FastAPI()
    app.state.financial_service = FinancialService(WorkspaceFileStorage(tmp_path / "data"))
    app.state.ai_service = FakeAiService()

    def fake_user() -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=f"user-{active['workspace']}",
            email=None,
            workspace_id=active["workspace"],
            workspace_role="owner",
        )

    app.dependency_overrides[require_supabase_user] = fake_user
    app.include_router(protected_router, prefix="/api/v1")
    return TestClient(app), active


def _upload(client: TestClient, ruc: str, filename: str, content: str) -> dict[str, Any]:
    response = client.post(
        "/api/v1/upload-csv",
        headers={"X-Backend-Api-Key": API_KEY},
        data={"ruc": ruc},
        files={"file": (filename, content.encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 200
    return response.json()


def _post(client: TestClient, path: str, payload: dict[str, Any]) -> Any:
    response = client.post(
        f"/api/v1{path}",
        headers={"X-Backend-Api-Key": API_KEY},
        json=payload,
    )
    assert response.status_code == 200
    return response.json()


def test_authenticated_http_flow_uploads_generated_csvs_and_reads_all_financial_views(tmp_path, monkeypatch):
    client, active = _build_client(tmp_path, monkeypatch)

    ai_mapped_csv = "\n".join(
        [
            "VoucherId|AcctName|CreditValue|DocDate|Acct|DebitValue|Narrative",
            "A-001|Clientes|0.00|2025-01-15|1.1.3.01|321.00|Factura generada A",
            "A-001|Ventas|321.00|2025-01-15|4.1.1.01|0.00|Factura generada A",
        ]
    )
    spanish_reordered_csv = "\n".join(
        [
            "Credito;Glosa;Codigo Cuenta;Fecha Contable;Debito;Nombre Cuenta;Comprobante",
            "0,00;Factura generada B;1.1.3.01;20/02/2025;654,50;Clientes;A-002",
            "654,50;Factura generada B;4.1.1.01;20/02/2025;0,00;Ventas;A-002",
        ]
    )
    opening = "\n".join(
        [
            "Nature;Account Description;Balance;Account Code",
            "D;Banco principal;1000.00;1.1.1.01",
            "A;Capital social;1000.00;3.1.1.01",
        ]
    )

    assert _upload(client, RUC_A, "saldos_iniciales_2025.csv", opening)["ok"] is True
    first_upload = _upload(client, RUC_A, "202501.csv", ai_mapped_csv)
    second_upload = _upload(client, RUC_A, "202502.csv", spanish_reordered_csv)

    assert first_upload["ok"] is True
    assert first_upload["provider"] == "test-ai"
    assert second_upload["ok"] is True
    assert second_upload["provider"] == "heuristic"

    rucs_response = client.get("/api/v1/rucs", headers={"X-Backend-Api-Key": API_KEY})
    assert rucs_response.status_code == 200
    assert rucs_response.json() == [RUC_A]
    assert _post(client, "/periods", {"rucs": [RUC_A]}) == {RUC_A: ["202501", "202502"]}

    dashboard = _post(client, "/dashboard", {"ruc": RUC_A, "periodos": ["202501", "202502"]})
    assert dashboard["periodosLeidos"] == ["202501", "202502"]
    assert dashboard["eri"]["ingresos"]["total"] == 97550
    assert dashboard["monthlyChart"][0]["ingresos"] == 32100
    assert dashboard["monthlyChart"][1]["ingresos"] == 65450

    comparison = _post(
        client,
        "/comparativo",
        {"ruc": RUC_A, "periodosA": ["202501"], "periodosB": ["202502"]},
    )
    assert comparison["a"]["eri"]["ingresos"]["total"] == 32100
    assert comparison["b"]["eri"]["ingresos"]["total"] == 65450

    mayor = _post(client, "/mayor/completo", {"ruc": RUC_A, "periodos": ["202501", "202502"]})
    assert {item["codCuenta"] for item in mayor} >= {"1.1.1.01", "1.1.3.01", "3.1.1.01", "4.1.1.01"}

    anomalies = _post(client, "/anomalies", {"ruc": RUC_A, "periodos": ["202501", "202502"]})
    assert anomalies["benford"]["sampleSize"] == 4

    notas = _post(client, "/notas", {"ruc": RUC_A, "periodos": ["202501", "202502"]})
    assert notas["ruc"] == RUC_A
    assert notas["eri"]["ingresos"]["total"] == 97550

    active["workspace"] = "ws-b"
    assert client.get("/api/v1/rucs", headers={"X-Backend-Api-Key": API_KEY}).json() == []
    isolated_dashboard = _post(client, "/dashboard", {"ruc": RUC_A, "periodos": ["202501", "202502"]})
    assert isolated_dashboard["periodosLeidos"] == []
    assert isolated_dashboard["eri"]["ingresos"]["total"] == 0

    assert _upload(client, RUC_B, "202501.csv", ai_mapped_csv)["ok"] is True
    assert client.get("/api/v1/rucs", headers={"X-Backend-Api-Key": API_KEY}).json() == [RUC_B]

    active["workspace"] = "ws-a"
    assert client.get("/api/v1/rucs", headers={"X-Backend-Api-Key": API_KEY}).json() == [RUC_A]
