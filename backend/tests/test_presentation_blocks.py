from __future__ import annotations

from backend.app.domain.ai.presentation import build_blocks


def test_financial_summary_becomes_key_metrics_block():
    results = [
        {
            "tool_name": "getFinancialSummary",
            "status": "success",
            "client_id": "0990123456001",
            "periodos": ["202501", "202512"],
            "metrics": {
                "revenue": {"label": "Ingresos", "value": 994418.0, "unit": "USD"},
                "net_profit": {"label": "Utilidad neta", "value": 229025.64, "unit": "USD"},
                "gross_margin": {"label": "Margen bruto", "value": 0.4471, "unit": "ratio"},
                "current_ratio": {"label": "Razon corriente", "value": 1.8, "unit": "times"},
            },
            "monthly": [],
        }
    ]
    blocks = build_blocks(results)
    assert len(blocks) == 1
    block = blocks[0]
    assert block["type"] == "key_metrics"
    assert block["ruc"] == "0990123456001"
    assert block["periods"] == ["202501", "202512"]
    by_key = {m["key"]: m for m in block["metrics"]}
    assert by_key["revenue"]["value"] == 994418.0
    assert by_key["revenue"]["format"] == "currency"
    assert by_key["gross_margin"]["format"] == "percent"
    assert by_key["current_ratio"]["format"] == "ratio"


def test_financial_summary_with_monthly_adds_table():
    results = [
        {
            "tool_name": "getFinancialSummary",
            "status": "success",
            "client_id": "0990123456001",
            "periodos": ["202501", "202502"],
            "metrics": {"revenue": {"label": "Ingresos", "value": 100.0, "unit": "USD"}},
            "monthly": [
                {"label": "Ene 2025", "revenue": 50.0, "gross_profit": 20.0, "net_profit": 10.0},
                {"label": "Feb 2025", "revenue": 50.0, "gross_profit": 20.0, "net_profit": 10.0},
            ],
        }
    ]
    blocks = build_blocks(results)
    assert [b["type"] for b in blocks] == ["key_metrics", "table"]
    table = blocks[1]
    assert table["columns"][1]["format"] == "currency"
    assert len(table["rows"]) == 2


def test_compare_periods_becomes_comparison_block_with_deltas():
    results = [
        {
            "tool_name": "comparePeriods",
            "status": "success",
            "periodosA": ["202501"],
            "periodosB": ["202601"],
            "comparison": {
                "revenue": {
                    "periodA": 100.0,
                    "periodB": 150.0,
                    "delta": 50.0,
                    "delta_pct": 0.5,
                    "unit": "USD",
                },
            },
        }
    ]
    blocks = build_blocks(results)
    assert len(blocks) == 1
    block = blocks[0]
    assert block["type"] == "comparison"
    assert block["periodsA"] == ["202501"]
    row = block["rows"][0]
    assert row["label"] == "Ingresos"
    assert row["a"] == 100.0 and row["b"] == 150.0
    assert row["delta"] == 50.0 and row["deltaPct"] == 0.5
    assert row["format"] == "currency"


def test_breakdown_becomes_table_block():
    results = [
        {
            "tool_name": "getExpenseBreakdown",
            "status": "success",
            "items": [
                {"nombreCuenta": "Sueldos", "amount": 1200.0},
                {"nombreCuenta": "Arriendo", "amount": 800.0},
            ],
        }
    ]
    blocks = build_blocks(results)
    assert blocks[0]["type"] == "table"
    assert blocks[0]["title"] == "Detalle de gastos"
    assert blocks[0]["rows"][0]["nombreCuenta"] == "Sueldos"


def test_empty_result_becomes_caveat():
    results = [
        {"tool_name": "getFinancialSummary", "status": "empty", "message": "No available periods."}
    ]
    blocks = build_blocks(results)
    assert blocks == [{"type": "caveat", "level": "warning", "message": "No available periods."}]


def test_render_dashboard_and_text_only_produce_no_blocks():
    # renderDashboard is navigation only; a plain answer has no tool results.
    assert build_blocks([{"tool_name": "renderDashboard", "status": "success", "source": "frontend_instruction"}]) == []
    assert build_blocks([]) == []
