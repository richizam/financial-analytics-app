from __future__ import annotations

from .accounting import JournalEntry, SaldoCuenta


JOURNAL_HEADER = "fecha,asiento,tipo,codCuenta,nombreCuenta,descripcion,debe,haber,centroCosto"
OPENING_HEADER = "Cod_Cuenta,Nombre_Cuenta,Saldo_Inicial,Tipo"


def entries_to_canonical_csv(entries: list[JournalEntry]) -> str:
    """Render normalized journal entries as the canonical YYYYMM.csv text.

    Used as the fallback persistence format when the storage backend has no
    structured journal-import path (e.g. file storage). Amounts are stored in
    cents internally and emitted here as 2-decimal currency.
    """
    lines = [JOURNAL_HEADER]
    for entry in entries:
        lines.append(
            ",".join(
                [
                    _csv_cell(str(entry.get("fecha", ""))),
                    _csv_cell(str(entry.get("asiento", ""))),
                    _csv_cell(str(entry.get("tipo", ""))),
                    _csv_cell(str(entry.get("codCuenta", ""))),
                    _csv_cell(str(entry.get("nombreCuenta", ""))),
                    _csv_cell(str(entry.get("descripcion", ""))),
                    f"{int(entry.get('debe', 0)) / 100:.2f}",
                    f"{int(entry.get('haber', 0)) / 100:.2f}",
                    _csv_cell(str(entry.get("centroCosto", ""))),
                ]
            )
        )
    return "\n".join(lines) + "\n"


def opening_balances_to_canonical_csv(balances: list[SaldoCuenta]) -> str:
    """Render normalized opening balances as the canonical saldos_iniciales_YYYY.csv text."""
    lines = [OPENING_HEADER]
    for balance in balances:
        saldo = int(balance.get("saldo", 0))
        lines.append(
            ",".join(
                [
                    _csv_cell(str(balance.get("codCuenta", ""))),
                    _csv_cell(str(balance.get("nombreCuenta", ""))),
                    f"{abs(saldo) / 100:.2f}",
                    "A" if saldo < 0 else "D",
                ]
            )
        )
    return "\n".join(lines) + "\n"


def _csv_cell(value: str) -> str:
    if any(char in value for char in [",", '"', "\n"]):
        return '"' + value.replace('"', '""') + '"'
    return value
