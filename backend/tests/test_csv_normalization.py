from __future__ import annotations

from typing import Any

from backend.app.domain.financial import FinancialService
from backend.app.domain.financial.normalization import normalize_journal_csv, parse_money_to_cents


RUC = "0990123456001"


class HybridStorage:
    kind = "hybrid"

    def __init__(self) -> None:
        self.files: dict[str, dict[str, str]] = {}
        self.normalized: dict[str, dict[str, list[dict[str, Any]]]] = {}
        self.cache: dict[tuple[str, str, str], dict[str, Any]] = {}

    def for_workspace(self, workspace_id: str) -> "HybridStorage":
        return self

    def list_rucs(self) -> list[str]:
        return sorted(set(self.files) | set(self.normalized))

    def list_periods(self, ruc: str) -> list[str]:
        raw = {
            filename[:6]
            for filename in self.files.get(ruc, {})
            if filename[:6].isdigit() and filename.endswith(".csv")
        }
        normalized = set(self.normalized.get(ruc, {}))
        return sorted(raw | normalized)

    def list_files(self, ruc: str) -> list[str]:
        return sorted(self.files.get(ruc, {}))

    def read(self, ruc: str, filename: str) -> str | None:
        return self.files.get(ruc, {}).get(filename)

    def upsert(self, ruc: str, filename: str, content: str) -> None:
        self.files.setdefault(ruc, {})[filename] = content

    def upsert_journal_import(
        self,
        ruc: str,
        filename: str,
        content: str,
        entries: list[dict[str, Any]],
        aggregates: list[dict[str, Any]],
        meta: dict[str, Any],
    ) -> None:
        self.upsert(ruc, filename, content)
        self.normalized.setdefault(ruc, {})[filename[:6]] = entries
        self.invalidate_analysis_cache(ruc)

    def get_journal_entries(self, ruc: str, periodos: list[str]) -> tuple[list[dict[str, Any]], set[str]]:
        entries: list[dict[str, Any]] = []
        found: set[str] = set()
        for periodo in periodos:
            period_entries = self.normalized.get(ruc, {}).get(periodo)
            if period_entries is None:
                continue
            entries.extend(period_entries)
            found.add(periodo)
        return entries, found

    def get_opening_balances(self, ruc: str, year: int):
        return None

    def get_analysis_cache(self, ruc: str, analysis_type: str, period_key: str):
        return self.cache.get((ruc, analysis_type, period_key))

    def set_analysis_cache(self, ruc: str, analysis_type: str, period_key: str, payload: dict[str, Any]) -> None:
        self.cache[(ruc, analysis_type, period_key)] = payload

    def invalidate_analysis_cache(self, ruc: str) -> None:
        for key in list(self.cache):
            if key[0] == ruc:
                del self.cache[key]


def test_money_parser_accepts_common_accounting_formats():
    assert parse_money_to_cents("1.234,56") == 123456
    assert parse_money_to_cents("1,234.56") == 123456
    assert parse_money_to_cents("(99.10)") == -9910


def test_normalize_journal_csv_accepts_spanish_headers_and_semicolon_delimiter():
    content = "\n".join(
        [
            "Dia;Comprobante;Cuenta;Nombre;Glosa;Debito;Credito;Centro de costo",
            "05/02/2025;A-1;1.1.3.01;Clientes;Factura 1;1.234,56;0,00;VENTAS",
            "05/02/2025;A-1;4.1.1.01;Ventas;Factura 1;0,00;1.234,56;VENTAS",
        ]
    )

    result = normalize_journal_csv(content, "202502.csv")

    assert result["errors"] == []
    assert result["confidence"] >= 0.85
    assert result["entries"][0]["fecha"] == "2025-02-05"
    assert result["entries"][0]["debe"] == 123456
    assert result["entries"][1]["haber"] == 123456


def test_normalize_journal_csv_supports_single_signed_amount_column():
    content = "\n".join(
        [
            "Fecha,Cuenta,Descripcion,Monto",
            "2025-01-02,5.2.1.01,Gasto oficina,80.50",
            "2025-01-02,1.1.1.01,Banco,-80.50",
        ]
    )

    result = normalize_journal_csv(content, "202501.csv")

    assert result["errors"] == []
    assert result["entries"][0]["debe"] == 8050
    assert result["entries"][0]["haber"] == 0
    assert result["entries"][1]["debe"] == 0
    assert result["entries"][1]["haber"] == 8050


def test_upload_returns_mapping_required_when_columns_are_ambiguous():
    service = FinancialService(HybridStorage())
    content = "\n".join(["Dia,Texto,Valor", "2025-01-01,Venta,100.00"])

    result = service.upload_csv(RUC, "202501.csv", content)

    assert result["ok"] is False
    assert result["mappingRequired"] is True
    assert result["proposal"]["requires_user_confirmation"] is True


def test_upload_persists_normalized_data_and_dashboard_reads_raw_fallback():
    storage = HybridStorage()
    storage.upsert(
        RUC,
        "202501.csv",
        "\n".join(
            [
                "fecha,asiento,tipo,codCuenta,nombreCuenta,descripcion,debe,haber,centroCosto",
                "2025-01-01,A1,VT,1.1.3.01,Clientes,Factura 1,100.00,0.00,VENTAS",
                "2025-01-01,A1,VT,4.1.1.01,Ventas,Factura 1,0.00,100.00,VENTAS",
            ]
        ),
    )
    service = FinancialService(storage)
    content = "\n".join(
        [
            "Dia;Asiento;Cuenta;Nombre;Glosa;Debito;Credito",
            "01/02/2025;A2;1.1.3.01;Clientes;Factura 2;200,00;0,00",
            "01/02/2025;A2;4.1.1.01;Ventas;Factura 2;0,00;200,00",
        ]
    )

    upload = service.upload_csv(RUC, "202502.csv", content)
    dashboard = service.get_dashboard_data(RUC, ["202501", "202502"])

    assert upload["ok"] is True
    assert storage.normalized[RUC]["202502"][0]["debe"] == 20000
    assert dashboard is not None
    assert dashboard["periodosLeidos"] == ["202501", "202502"]
    assert dashboard["eri"]["ingresos"]["total"] == 30000
