from __future__ import annotations

import json

from backend.app.domain.financial import FinancialService
from backend.app.storage.file import FileCsvStorage


SOURCE = "0990123456001"
DEST = "0992222222001"


def _seed_source(storage: FileCsvStorage) -> None:
    storage.upsert(SOURCE, "202501.csv", "Fecha,Asiento\n2025-01-05,AJ-1\n")
    storage.upsert(SOURCE, "202502.csv", "Fecha,Asiento\n2025-02-05,AJ-2\n")
    storage.upsert(SOURCE, "saldos_iniciales_2025.csv", "Cod_Cuenta,Saldo\n1.1.1.01,500000\n")
    storage.upsert(SOURCE, "config.json", json.dumps({"ruc": SOURCE, "razonSocial": "Origen", "sector": "comercial"}))


def test_clone_copies_data_and_writes_config(tmp_path):
    storage = FileCsvStorage(tmp_path)
    _seed_source(storage)
    service = FinancialService(storage)

    result = service.clone_company(
        SOURCE,
        DEST,
        {"razonSocial": "Comercial Andina S.A.", "sector": "comercial", "niifFramework": "niif_pymes"},
    )

    assert result == {"ok": True, "ruc": DEST}
    # period files copied
    assert storage.list_periods(DEST) == ["202501", "202502"]
    # non-period data file copied too
    assert "saldos_iniciales_2025.csv" in storage.list_files(DEST)
    # fresh config written with the new identity + demo flag
    config = service.get_company_config(DEST)
    assert config is not None
    assert config["ruc"] == DEST
    assert config["razonSocial"] == "Comercial Andina S.A."
    assert config["niifFramework"] == "niif_pymes"
    assert config["isDemo"] is True
    assert "createdAt" in config


def test_clone_rejects_existing_destination(tmp_path):
    storage = FileCsvStorage(tmp_path)
    _seed_source(storage)
    storage.upsert(DEST, "202501.csv", "Fecha,Asiento\n2025-01-05,X\n")
    service = FinancialService(storage)

    result = service.clone_company(SOURCE, DEST)

    assert result["ok"] is False
    assert "existe" in result["error"]


def test_clone_rejects_invalid_destination_ruc(tmp_path):
    storage = FileCsvStorage(tmp_path)
    _seed_source(storage)
    service = FinancialService(storage)

    assert service.clone_company(SOURCE, "123")["ok"] is False
    assert service.clone_company(SOURCE, SOURCE)["ok"] is False


def test_clone_rejects_empty_source(tmp_path):
    storage = FileCsvStorage(tmp_path)
    service = FinancialService(storage)

    result = service.clone_company(SOURCE, DEST)

    assert result["ok"] is False
    assert "origen" in result["error"]


def test_companies_overview_includes_period_coverage_and_config(tmp_path):
    storage = FileCsvStorage(tmp_path)
    _seed_source(storage)
    storage.upsert(DEST, "202503.csv", "Fecha,Asiento\n2025-03-05,AJ-3\n")
    storage.upsert(
        DEST,
        "config.json",
        json.dumps(
            {
                "ruc": DEST,
                "razonSocial": "Destino",
                "sector": "servicios",
                "niifFramework": "niif_pymes",
                "isDemo": True,
            }
        ),
    )
    service = FinancialService(storage)

    overview = service.get_companies_overview()

    assert overview == [
        {
            "ruc": SOURCE,
            "razonSocial": "Origen",
            "sector": "comercial",
            "niifFramework": "",
            "isDemo": False,
            "periodCount": 2,
            "firstPeriod": "202501",
            "lastPeriod": "202502",
            "periods": ["202501", "202502"],
        },
        {
            "ruc": DEST,
            "razonSocial": "Destino",
            "sector": "servicios",
            "niifFramework": "niif_pymes",
            "isDemo": True,
            "periodCount": 1,
            "firstPeriod": "202503",
            "lastPeriod": "202503",
            "periods": ["202503"],
        },
    ]
