"""Turn tool results into structured presentation blocks for the chat UI.

The model writes the natural-language explanation; these blocks let the frontend
own the formatting of every financial number (currency, %, deltas) instead of
relying on model-generated markdown. Values are passed through as plain numbers
with a `format` hint — the frontend formats them with Intl.NumberFormat.
"""
from __future__ import annotations

from typing import Any


# unit (as emitted by tools.py) -> frontend format hint
_UNIT_FORMAT = {"USD": "currency", "ratio": "percent", "times": "ratio"}

METRIC_LABELS = {
    "revenue": "Ingresos",
    "costs": "Costos y gastos",
    "gross_profit": "Utilidad bruta",
    "gross_margin": "Margen bruto",
    "operating_profit": "Utilidad operacional",
    "net_profit": "Utilidad neta",
    "ebitda": "EBITDA",
    "assets": "Total activos",
    "liabilities": "Total pasivos",
    "equity": "Total patrimonio",
    "current_ratio": "Razon corriente",
    "cash_in": "Entradas de efectivo",
    "cash_out": "Salidas de efectivo",
}


def _fmt(unit: Any) -> str:
    return _UNIT_FORMAT.get(str(unit), "number")


def build_blocks(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map this turn's executed tool results to ordered UI blocks."""
    blocks: list[dict[str, Any]] = []
    for result in results:
        if not isinstance(result, dict):
            continue
        tool = result.get("tool_name")
        status = result.get("status")

        if status == "empty":
            blocks.append(
                {
                    "type": "caveat",
                    "level": "warning",
                    "message": result.get("message") or "No hay datos para el rango solicitado.",
                }
            )
            continue
        if status != "success":
            continue

        if tool == "getFinancialSummary":
            blocks.append(_summary_block(result))
            monthly = _monthly_table_block(result)
            if monthly:
                blocks.append(monthly)
        elif tool == "comparePeriods":
            blocks.append(_comparison_block(result, "Comparativo", result.get("comparison") or {}))
        elif tool in ("getRevenueBreakdown", "getExpenseBreakdown"):
            blocks.append(_breakdown_block(result, tool))
        elif tool == "getVarianceDrivers":
            blocks.append(_drivers_block(result))
        elif tool == "getAnomalies":
            blocks.append(_anomalies_block(result))
        # renderDashboard is navigation only — no block.

    return [block for block in blocks if block]


def _summary_block(result: dict[str, Any]) -> dict[str, Any]:
    metrics = result.get("metrics") or {}
    rows = [
        {
            "key": key,
            "label": metric.get("label") or METRIC_LABELS.get(key, key),
            "value": metric.get("value"),
            "format": _fmt(metric.get("unit")),
        }
        for key, metric in metrics.items()
    ]
    return {
        "type": "key_metrics",
        "title": "Resumen financiero",
        "ruc": result.get("client_id"),
        "periods": result.get("periodos") or [],
        "metrics": rows,
    }


def _monthly_table_block(result: dict[str, Any]) -> dict[str, Any] | None:
    monthly = result.get("monthly") or []
    if len(monthly) < 2:
        return None
    rows = [
        {
            "label": item.get("label"),
            "revenue": item.get("revenue"),
            "gross_profit": item.get("gross_profit"),
            "net_profit": item.get("net_profit"),
        }
        for item in monthly
    ]
    return {
        "type": "table",
        "title": "Detalle por periodo",
        "columns": [
            {"key": "label", "label": "Periodo"},
            {"key": "revenue", "label": "Ingresos", "format": "currency", "align": "right"},
            {"key": "gross_profit", "label": "Utilidad bruta", "format": "currency", "align": "right"},
            {"key": "net_profit", "label": "Utilidad neta", "format": "currency", "align": "right"},
        ],
        "rows": rows,
    }


def _comparison_block(result: dict[str, Any], title: str, comparison: dict[str, Any]) -> dict[str, Any]:
    rows = [
        {
            "key": key,
            "label": METRIC_LABELS.get(key, key),
            "a": values.get("periodA"),
            "b": values.get("periodB"),
            "delta": values.get("delta"),
            "deltaPct": values.get("delta_pct"),
            "format": _fmt(values.get("unit")),
        }
        for key, values in comparison.items()
    ]
    return {
        "type": "comparison",
        "title": title,
        "periodsA": result.get("periodosA") or [],
        "periodsB": result.get("periodosB") or [],
        "rows": rows,
    }


def _breakdown_block(result: dict[str, Any], tool: str) -> dict[str, Any]:
    title = "Detalle de ingresos" if tool == "getRevenueBreakdown" else "Detalle de gastos"
    rows = [
        {"nombreCuenta": item.get("nombreCuenta"), "amount": item.get("amount")}
        for item in (result.get("items") or [])
    ]
    return {
        "type": "table",
        "title": title,
        "columns": [
            {"key": "nombreCuenta", "label": "Cuenta"},
            {"key": "amount", "label": "Monto", "format": "currency", "align": "right"},
        ],
        "rows": rows,
    }


def _drivers_block(result: dict[str, Any]) -> dict[str, Any]:
    rows = [
        {
            "key": driver.get("metric"),
            "label": METRIC_LABELS.get(driver.get("metric"), driver.get("metric")),
            "a": driver.get("periodA"),
            "b": driver.get("periodB"),
            "delta": driver.get("delta"),
            "deltaPct": driver.get("delta_pct"),
            "format": _fmt(driver.get("unit")),
        }
        for driver in (result.get("drivers") or [])
    ]
    return {
        "type": "comparison",
        "title": "Principales variaciones",
        "periodsA": result.get("periodosA") or [],
        "periodsB": result.get("periodosB") or [],
        "rows": rows,
    }


def _anomalies_block(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "insight",
        "title": "Riesgo de anomalias",
        "items": [
            {"label": "Puntaje de riesgo", "value": result.get("riskScore"), "format": "number"},
            {"label": "Grupos duplicados", "value": result.get("duplicateGroups"), "format": "integer"},
            {"label": "Outliers", "value": result.get("outliers"), "format": "integer"},
            {"label": "Asientos", "value": result.get("totalEntries"), "format": "integer"},
        ],
    }
