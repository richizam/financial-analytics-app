from __future__ import annotations

from typing import Any


def aggregate_account_period_balances(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Roll journal entries up to one balance row per (period, account).

    This is derived accounting data, not storage mechanics, so it lives in the
    domain layer. Storage backends persist whatever this returns verbatim.
    Amounts stay in cents.
    """
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in entries:
        key = (str(entry.get("periodo", "")), str(entry.get("codCuenta", "")))
        current = grouped.setdefault(
            key,
            {
                "period": key[0],
                "codCuenta": key[1],
                "nombreCuenta": entry.get("nombreCuenta", ""),
                "totalDebe": 0,
                "totalHaber": 0,
                "entryCount": 0,
            },
        )
        current["nombreCuenta"] = entry.get("nombreCuenta", current["nombreCuenta"])
        current["totalDebe"] += int(entry.get("debe", 0))
        current["totalHaber"] += int(entry.get("haber", 0))
        current["entryCount"] += 1

    for item in grouped.values():
        item["saldo"] = item["totalDebe"] - item["totalHaber"]

    return list(grouped.values())
