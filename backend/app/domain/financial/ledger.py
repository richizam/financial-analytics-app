from __future__ import annotations

from typing import Any

from .accounting import JournalEntry, SaldoCuenta


def cuenta_map(
    entries: list[JournalEntry],
    opening: dict[str, SaldoCuenta],
) -> dict[str, str]:
    """Map account code -> account name across entries and opening balances."""
    mapping: dict[str, str] = {}
    for entry in entries:
        mapping[entry["codCuenta"]] = entry["nombreCuenta"]
    for cod, saldo in opening.items():
        mapping.setdefault(cod, saldo["nombreCuenta"])
    return mapping


def build_mayor_response(
    entries: list[JournalEntry],
    opening: dict[str, SaldoCuenta],
    cod_cuenta: str | None,
) -> dict[str, Any]:
    """Build the libro-mayor page payload: the account list plus the selected ledger."""
    accounts = cuenta_map(entries, opening)
    cuentas = [
        {"codCuenta": cod, "nombreCuenta": nombre}
        for cod, nombre in sorted(accounts.items())
    ]
    selected = (
        cod_cuenta
        if cod_cuenta and cod_cuenta in accounts
        else (cuentas[0]["codCuenta"] if cuentas else None)
    )
    if selected is None:
        return {"cuentas": cuentas, "mayor": None, "selectedCuenta": None}
    return {
        "cuentas": cuentas,
        "mayor": build_mayor(entries, opening, selected, accounts[selected]),
        "selectedCuenta": selected,
    }


def build_mayor(
    entries: list[JournalEntry],
    opening: dict[str, SaldoCuenta],
    cod: str,
    nombre: str,
) -> dict[str, Any]:
    """Build a single account's running-balance ledger (libro mayor)."""
    saldo_inicial = int(opening.get(cod, {}).get("saldo", 0))
    account_entries = sorted(
        [entry for entry in entries if entry["codCuenta"] == cod],
        key=lambda entry: (entry["fecha"], entry["asiento"]),
    )
    saldo_acumulado = saldo_inicial
    total_debe = 0
    total_haber = 0
    mayor_entries: list[dict[str, Any]] = []
    for entry in account_entries:
        total_debe += int(entry["debe"])
        total_haber += int(entry["haber"])
        saldo_acumulado += int(entry["debe"]) - int(entry["haber"])
        mayor_entries.append(
            {
                "fecha": entry["fecha"],
                "asiento": entry["asiento"],
                "tipo": entry["tipo"],
                "descripcion": entry["descripcion"],
                "debe": entry["debe"],
                "haber": entry["haber"],
                "saldo": saldo_acumulado,
            }
        )

    return {
        "codCuenta": cod,
        "nombreCuenta": nombre,
        "saldoInicial": saldo_inicial,
        "entries": mayor_entries,
        "totalDebe": total_debe,
        "totalHaber": total_haber,
        "saldoFinal": saldo_acumulado,
    }
