from __future__ import annotations

from typing import Any

from backend.app.domain.financial import FinancialService
from backend.app.domain.financial.imports import MAX_CSV_UPLOAD_BYTES
from backend.app.domain.financial.normalization import (
    normalize_journal_csv,
    normalize_opening_balances_csv,
    parse_money_to_cents,
)


RUC = "0990123456001"
OTHER_RUC = "1799999999001"


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


def test_normalize_journal_csv_accepts_generated_accountant_variants():
    variants = [
        (
            "pipe-delimited spanish columns out of order",
            "202503.csv",
            "\n".join(
                [
                    "Credito|Glosa|Codigo Cuenta|Fecha Contable|Debito|Nombre Cuenta|Comprobante",
                    "0,00|Factura cliente A|1.1.3.01|10/03/2025|1.500,25|Clientes|V-003",
                    "1.500,25|Factura cliente A|4.1.1.01|10/03/2025|0,00|Ventas|V-003",
                ]
            ),
            150025,
        ),
        (
            "english tab-delimited ERP export",
            "202504.csv",
            "\n".join(
                [
                    "Voucher\tAccount Description\tCredit Amount\tPosting Date\tAccount Number\tDebit Amount\tDetail",
                    "SA-9\tBank\t0.00\t2025-04-12\t1.1.1.01\t750.40\tCash sale",
                    "SA-9\tSales\t750.40\t2025-04-12\t4.1.1.01\t0.00\tCash sale",
                ]
            ),
            75040,
        ),
        (
            "single signed amount with custom column names",
            "202505.csv",
            "\n".join(
                [
                    "Memo;Valor;Ledger Account;Date;Account Name",
                    "Servicio profesional;420.10;1.1.1.01;2025-05-04;Banco",
                    "Servicio profesional;-420.10;4.1.1.01;2025-05-04;Ingresos",
                ]
            ),
            42010,
        ),
    ]

    for label, filename, content, expected_amount in variants:
        result = normalize_journal_csv(content, filename)

        assert result["errors"] == [], label
        assert result["confidence"] >= 0.85, label
        assert sum(entry["debe"] for entry in result["entries"]) == expected_amount, label
        assert sum(entry["haber"] for entry in result["entries"]) == expected_amount, label


def test_normalize_opening_balances_accepts_mixed_header_names_and_credit_nature():
    content = "\n".join(
        [
            "Nature;Account Description;Balance;Account Code",
            "D;Caja bancos;1,000.00;1.1.1.01",
            "A;Cuentas por pagar;250,00;2.1.1.01",
        ]
    )

    result = normalize_opening_balances_csv(content, "saldos_iniciales_2025.csv")

    assert result["errors"] == []
    assert result["warnings"] == []
    assert result["balances"][0]["saldo"] == 100000
    assert result["balances"][1]["saldo"] == -25000


def test_normalize_rejects_non_empty_invalid_money_cells():
    content = "\n".join(
        [
            "Fecha,Cuenta,Descripcion,Debe,Haber",
            "2025-01-02,1.1.1.01,Cobro cliente,no-es-numero,0.00",
            "2025-01-02,4.1.1.01,Cobro cliente,0.00,100.00",
        ]
    )

    result = normalize_journal_csv(content, "202501.csv")

    assert result["entries"][0]["codCuenta"] == "4.1.1.01"
    assert result["errors"] == [
        {"row": 2, "field": "debit", "message": "Monto invalido: no-es-numero"}
    ]


def test_upload_rejects_oversized_csv_before_persisting():
    storage = HybridStorage()
    service = FinancialService(storage)
    oversized = "x" * (MAX_CSV_UPLOAD_BYTES + 1)

    result = service.upload_csv(RUC, "202501.csv", oversized)

    assert result == {"ok": False, "error": "CSV demasiado grande. El limite es 2 MB por archivo."}
    assert storage.files == {}


def test_uploads_multiple_generated_companies_without_mixing_dashboards():
    storage = HybridStorage()
    service = FinancialService(storage)
    company_a = "\n".join(
        [
            "Codigo Cuenta;Fecha Contable;Glosa;Debito;Credito;Nombre Cuenta",
            "1.1.3.01;15/03/2025;Factura A;1.500,25;0;Clientes",
            "4.1.1.01;15/03/2025;Factura A;0;1.500,25;Ventas",
        ]
    )
    company_b = "\n".join(
        [
            "Detail,Posting Date,Account Number,Debit Amount,Credit Amount,Account Description",
            "Invoice B,2025-03-20,1.1.3.01,850.00,0.00,Accounts receivable",
            "Invoice B,2025-03-20,4.1.1.01,0.00,850.00,Sales",
        ]
    )

    assert service.upload_csv(RUC, "202503.csv", company_a)["ok"] is True
    assert service.upload_csv(OTHER_RUC, "202503.csv", company_b)["ok"] is True

    dashboard_a = service.get_dashboard_data(RUC, ["202503"])
    dashboard_b = service.get_dashboard_data(OTHER_RUC, ["202503"])

    assert storage.list_rucs() == [RUC, OTHER_RUC]
    assert dashboard_a is not None
    assert dashboard_b is not None
    assert dashboard_a["eri"]["ingresos"]["total"] == 150025
    assert dashboard_b["eri"]["ingresos"]["total"] == 85000


def test_generated_batch_imports_many_companies_periods_and_csv_layouts():
    storage = HybridStorage()
    service = FinancialService(storage)
    rucs = [f"09900000000{index:02d}" for index in range(1, 5)]
    periods = ["202501", "202502", "202503", "202504"]

    def csv_for(period: str, amount: float, variant: int) -> str:
        date = f"15/{period[4:6]}/{period[:4]}"
        if variant == 0:
            value = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
            return "\n".join(
                [
                    "Fecha Contable;Codigo Cuenta;Nombre Cuenta;Glosa;Debito;Credito",
                    f"{date};1.1.3.01;Clientes;Venta generada;{value};0,00",
                    f"{date};4.1.1.01;Ventas;Venta generada;0,00;{value}",
                ]
            )
        if variant == 1:
            return "\n".join(
                [
                    "Posting Date,Account Number,Account Description,Detail,Debit Amount,Credit Amount",
                    f"{period[:4]}-{period[4:6]}-15,1.1.3.01,Accounts receivable,Generated sale,{amount:.2f},0.00",
                    f"{period[:4]}-{period[4:6]}-15,4.1.1.01,Sales,Generated sale,0.00,{amount:.2f}",
                ]
            )
        return "\n".join(
            [
                "Date|Ledger Account|Account Name|Memo|Valor",
                f"{period[:4]}-{period[4:6]}-15|1.1.3.01|Clientes|Venta generada|{amount:.2f}",
                f"{period[:4]}-{period[4:6]}-15|4.1.1.01|Ventas|Venta generada|-{amount:.2f}",
            ]
        )

    expected_revenue: dict[str, int] = {}
    for company_index, ruc in enumerate(rucs, start=1):
        opening = "\n".join(
            [
                "Nature;Account Description;Balance;Account Code",
                f"D;Caja banco;{company_index * 1000:.2f};1.1.1.01",
                f"A;Capital;{company_index * 1000:.2f};3.1.1.01",
            ]
        )
        assert service.upload_csv(ruc, "saldos_iniciales_2025.csv", opening)["ok"] is True

        total = 0
        for period_index, period in enumerate(periods):
            amount = company_index * 1000 + period_index * 125.50
            total += int(round(amount * 100))
            result = service.upload_csv(
                ruc,
                f"{period}.csv",
                csv_for(period, amount, (company_index + period_index) % 3),
            )
            assert result["ok"] is True
            assert result["rowCount"] == 2
        expected_revenue[ruc] = total

    overview = service.get_companies_overview()
    assert [item["ruc"] for item in overview] == rucs
    assert all(item["periodCount"] == 4 for item in overview)

    for ruc in rucs:
        dashboard = service.get_dashboard_data(ruc, periods)
        assert dashboard is not None
        assert dashboard["periodosLeidos"] == periods
        assert dashboard["eri"]["ingresos"]["total"] == expected_revenue[ruc]


def test_generated_stress_imports_many_companies_periods_and_accounting_views():
    storage = HybridStorage()
    service = FinancialService(storage)
    rucs = [f"17900000000{index:02d}" for index in range(1, 7)]
    periods = [f"2025{month:02d}" for month in range(1, 7)]

    def fmt_us(cents: int) -> str:
        return f"{cents / 100:.2f}"

    def fmt_ec(cents: int) -> str:
        return f"{cents / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    def csv_for(period: str, revenue: int, cost: int, expense: int, variant: int) -> str:
        year = period[:4]
        month = period[4:6]
        rows = [
            ("1.1.3.01", "Clientes", "Venta mensual", revenue, 0),
            ("4.1.1.01", "Ventas", "Venta mensual", 0, revenue),
            ("5.1.1.01", "Costo de ventas", "Costo mensual", cost, 0),
            ("1.1.5.01", "Inventario", "Costo mensual", 0, cost),
            ("5.2.1.01", "Gasto administrativo", "Gasto mensual", expense, 0),
            ("1.1.1.01", "Banco", "Gasto mensual", 0, expense),
        ]
        if variant == 0:
            return "\n".join(
                [
                    "Credito;Glosa;Codigo Cuenta;Fecha Contable;Debito;Nombre Cuenta;Comprobante",
                    *[
                        f"{fmt_ec(credit)};{desc};{code};15/{month}/{year};{fmt_ec(debit)};{name};M-{period}"
                        for code, name, desc, debit, credit in rows
                    ],
                ]
            )
        if variant == 1:
            return "\n".join(
                [
                    "Voucher\tAccount Description\tCredit Amount\tPosting Date\tAccount Number\tDebit Amount\tDetail",
                    *[
                        f"M-{period}\t{name}\t{fmt_us(credit)}\t{year}-{month}-15\t{code}\t{fmt_us(debit)}\t{desc}"
                        for code, name, desc, debit, credit in rows
                    ],
                ]
            )
        return "\n".join(
            [
                "Document Number|Account Name|Cr|Transaction Date|Ledger Account|Dr|Memo",
                *[
                    f"M-{period}|{name}|{fmt_ec(credit)}|15-{month}-{year}|{code}|{fmt_ec(debit)}|{desc}"
                    for code, name, desc, debit, credit in rows
                ],
            ]
        )

    expected: dict[str, dict[str, int]] = {}
    for company_index, ruc in enumerate(rucs, start=1):
        opening = "\n".join(
            [
                "Nature;Account Description;Balance;Account Code",
                f"D;Banco principal;{fmt_us(1_000_000 + company_index * 10_000)};1.1.1.01",
                f"A;Capital social;{fmt_us(1_000_000 + company_index * 10_000)};3.1.1.01",
            ]
        )
        assert service.upload_csv(ruc, "saldos_iniciales_2025.csv", opening)["ok"] is True
        expected[ruc] = {"revenue": 0, "cost": 0, "expense": 0}

        for month_index, period in enumerate(periods, start=1):
            revenue = company_index * 100_000 + month_index * 12_345
            cost = round(revenue * 0.43)
            expense = 10_000 + company_index * 1_000 + month_index * 321
            expected[ruc]["revenue"] += revenue
            expected[ruc]["cost"] += cost
            expected[ruc]["expense"] += expense

            result = service.upload_csv(
                ruc,
                f"{period}.csv",
                csv_for(period, revenue, cost, expense, (company_index + month_index) % 3),
            )
            assert result["ok"] is True
            assert result["rowCount"] == 6

    overview = service.get_companies_overview()
    assert len(overview) == len(rucs)
    assert all(item["periodCount"] == len(periods) for item in overview)

    for ruc in rucs:
        dashboard = service.get_dashboard_data(ruc, periods)
        assert dashboard is not None
        assert dashboard["periodosLeidos"] == periods
        assert len(dashboard["monthlyChart"]) == len(periods)
        assert dashboard["eri"]["ingresos"]["total"] == expected[ruc]["revenue"]
        assert dashboard["eri"]["costoVentas"]["total"] == expected[ruc]["cost"]
        assert dashboard["eri"]["gastosOperacion"]["total"] == expected[ruc]["expense"]

        comparison = service.get_comparativo_data(ruc, periods[:3], periods[3:])
        assert comparison is not None
        assert comparison["a"]["eri"]["ingresos"]["total"] < comparison["b"]["eri"]["ingresos"]["total"]

        anomalies = service.get_anomalies_data(ruc, periods)
        assert anomalies is not None
        assert anomalies["benford"]["sampleSize"] == len(periods) * 6


def test_upload_with_invalid_rows_does_not_persist_partial_import():
    storage = HybridStorage()
    service = FinancialService(storage)
    content = "\n".join(
        [
            "Fecha,Cuenta,Descripcion,Debe,Haber",
            "2025-01-01,1.1.3.01,Factura valida,100.00,0.00",
            "fecha-mala,4.1.1.01,Factura invalida,0.00,100.00",
        ]
    )

    result = service.upload_csv(RUC, "202501.csv", content)

    assert result["ok"] is False
    assert result["errors"] == [
        {"row": 3, "field": "transaction_date", "message": "Fecha invalida: fecha-mala"}
    ]
    assert storage.files == {}
    assert storage.normalized == {}


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
