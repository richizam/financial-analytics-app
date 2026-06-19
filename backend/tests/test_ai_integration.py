from __future__ import annotations

import pytest

from backend.app.core.config import Settings
from backend.app.domain.ai import AiAssistantService
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
    storage.upsert(
        "0990123456001",
        "202601.csv",
        "\n".join(
            [
                "fecha,asiento,tipo,codCuenta,nombreCuenta,descripcion,debe,haber,centroCosto",
                "2026-01-01,A1,VT,1.1.1.01,Caja,Factura 1,300.00,0.00,VENTAS",
                "2026-01-01,A1,VT,4.1.1.01,Ventas,Factura 1,0.00,300.00,VENTAS",
                "2026-01-02,A2,CV,5.1.1.01,Costo ventas,Costo 1,120.00,0.00,VENTAS",
                "2026-01-02,A2,CV,1.1.5.01,Inventario,Costo 1,0.00,120.00,VENTAS",
            ]
        ),
    )
    return FinancialService(storage)


def csv_for_period(periodo: str) -> str:
    year = periodo[:4]
    month = periodo[4:6]
    return "\n".join(
        [
            "fecha,asiento,tipo,codCuenta,nombreCuenta,descripcion,debe,haber,centroCosto",
            f"{year}-{month}-01,A1,VT,1.1.1.01,Caja,Factura 1,150.00,0.00,VENTAS",
            f"{year}-{month}-01,A1,VT,4.1.1.01,Ventas,Factura 1,0.00,150.00,VENTAS",
            f"{year}-{month}-02,A2,CV,5.1.1.01,Costo ventas,Costo 1,50.00,0.00,VENTAS",
            f"{year}-{month}-02,A2,CV,1.1.5.01,Inventario,Costo 1,0.00,50.00,VENTAS",
        ]
    )


def service_with_periods(periodos: list[str]) -> FinancialService:
    storage = MemoryStorage()
    for periodo in periodos:
        storage.upsert("0990123456001", f"{periodo}.csv", csv_for_period(periodo))
    return FinancialService(storage)


def period_range(start: str, end: str) -> list[str]:
    start_index = int(start[:4]) * 12 + int(start[4:6]) - 1
    end_index = int(end[:4]) * 12 + int(end[4:6]) - 1
    return [
        f"{index // 12:04d}{index % 12 + 1:02d}"
        for index in range(start_index, end_index + 1)
    ]


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


class FailingXaiClient:
    model = "test"

    @property
    def configured(self) -> bool:
        return True

    def create_chat_completion(self, *args, **kwargs):
        raise AssertionError("xAI should not be called for local anomaly intent")


class PassiveXaiClient:
    model = "test"

    @property
    def configured(self) -> bool:
        return True

    def create_chat_completion(self, *args, **kwargs):
        return {"choices": [{"message": {"content": "respuesta del modelo"}}]}


class CapturingXaiClient:
    model = "test"

    def __init__(self) -> None:
        self.messages: list[dict[str, str]] = []

    @property
    def configured(self) -> bool:
        return True

    def create_chat_completion(self, messages, *args, **kwargs):
        self.messages = messages
        return {"choices": [{"message": {"content": "Se refiere al resultado de anomalias mostrado antes."}}]}


def test_anomaly_intent_is_local_and_returns_ui_action():
    ai = AiAssistantService(service_with_data(), Settings(), FailingXaiClient())

    result = ai.chat("muestrame las anomalías", "0990123456001", ["202501"], [])

    assert result["provider"] == "local-intent"
    assert result["executed_tools"] == ["getAnomalies"]
    assert result["ui_action"]["href"] == "/anomalies"
    assert result["ui_action"]["periodos"] == ["202501"]


def test_anomaly_intent_uses_year_from_message_over_selected_period():
    ai = AiAssistantService(service_with_data(), Settings(), FailingXaiClient())

    result = ai.chat("muestrame las anomalias de 2025", "0990123456001", ["202601"], [])

    assert result["provider"] == "local-intent"
    assert result["executed_tools"] == ["getAnomalies"]
    assert result["ui_action"]["href"] == "/anomalies"
    assert result["ui_action"]["periodos"] == ["202501"]


def test_follow_up_question_is_sent_as_chat_not_backend_context():
    xai = CapturingXaiClient()
    ai = AiAssistantService(service_with_data(), Settings(), xai)
    conversation = [
        {"role": "user", "content": "Que anomalias hubo en 2025?"},
        {
            "role": "assistant",
            "content": (
                "Listo. Te muestro la pantalla de Anomalias para Ene 2025. "
                "Riesgo yellow, score 52/100, 0 grupos duplicados y 2 outliers sobre 4 asientos."
            ),
        },
    ]

    result = ai.chat("Que significa esto?", "0990123456001", ["202501"], conversation)

    assert result["provider"] == "xai"
    assert result["message"] == "Se refiere al resultado de anomalias mostrado antes."
    assert xai.messages[-1] == {"role": "user", "content": "Que significa esto?"}
    assert "selected_client_id" not in xai.messages[-1]["content"]
    assert any(
        item["role"] == "assistant" and "Riesgo yellow" in item["content"]
        for item in xai.messages
    )
    assert any(
        item["role"] == "system" and "selected_client_id" in item["content"]
        for item in xai.messages
    )


def test_follow_up_includes_visible_comparison_action_context():
    xai = CapturingXaiClient()
    ai = AiAssistantService(service_with_periods(period_range("202601", "202606")), Settings(), xai)
    conversation = [
        {"role": "user", "content": "Compara Q1 vs Q2 de 2026"},
        {
            "role": "assistant",
            "content": "Listo. Abro Comparativo para Ene 2026 - Mar 2026 vs Abr 2026 - Jun 2026.",
            "ui_action": {
                "type": "render_dashboard",
                "dashboard_id": "variance_analysis",
                "href": "/comparativo",
                "ruc": "0990123456001",
                "periodos": ["202601", "202602", "202603", "202604", "202605", "202606"],
                "periodosA": ["202601", "202602", "202603"],
                "periodosB": ["202604", "202605", "202606"],
            },
            "executed_tools": ["comparePeriods"],
        },
    ]

    result = ai.chat("Que significa esto?", "0990123456001", period_range("202601", "202606"), conversation)

    assert result["provider"] == "xai"
    assistant_context = next(
        item["content"]
        for item in xai.messages
        if item["role"] == "assistant" and "Contexto visible de la app" in item["content"]
    )
    assert "Comparativo" in assistant_context
    assert "Periodo A: Ene 2026 - Mar 2026" in assistant_context
    assert "Periodo B: Abr 2026 - Jun 2026" in assistant_context
    assert "Herramientas usadas: comparePeriods" in assistant_context
    assert xai.messages[-1] == {"role": "user", "content": "Que significa esto?"}


def test_main_dashboard_intent_returns_home_action_for_requested_year():
    ai = AiAssistantService(service_with_data(), Settings(), FailingXaiClient())

    result = ai.chat("muestrame el dashboard del tiempo dde 2025", "0990123456001", ["202601"], [])

    assert result["provider"] == "local-intent"
    assert result["executed_tools"] == ["renderDashboard"]
    assert result["ui_action"]["href"] == "/"
    assert result["ui_action"]["periodos"] == ["202501"]


def test_show_data_for_year_returns_home_dashboard_action():
    ai = AiAssistantService(service_with_data(), Settings(), FailingXaiClient())

    result = ai.chat("muestrame los datos del 2025", "0990123456001", ["202601"], [])

    assert result["provider"] == "local-intent"
    assert result["executed_tools"] == ["renderDashboard"]
    assert result["ui_action"]["dashboard_id"] == "financial_summary"
    assert result["ui_action"]["href"] == "/"
    assert result["ui_action"]["periodos"] == ["202501"]


def test_compare_quarters_intent_opens_comparativo_with_two_period_sets():
    service = service_with_periods(["202601", "202602", "202603", "202604", "202605", "202606"])
    ai = AiAssistantService(service, Settings(), FailingXaiClient())

    result = ai.chat("Compara Q1 vs Q2 de 2026", "0990123456001", ["202601"], [])

    assert result["provider"] == "local-intent"
    assert result["executed_tools"] == ["comparePeriods"]
    assert result["ui_action"]["href"] == "/comparativo"
    assert result["ui_action"]["dashboard_id"] == "variance_analysis"
    assert result["ui_action"]["periodosA"] == ["202601", "202602", "202603"]
    assert result["ui_action"]["periodosB"] == ["202604", "202605", "202606"]
    assert result["ui_action"]["periodos"] == [
        "202601",
        "202602",
        "202603",
        "202604",
        "202605",
        "202606",
    ]


def test_compare_years_tool_returns_comparativo_action():
    executor = AiToolExecutor(service_with_periods(period_range("202501", "202612")))
    context = AiContext(
        selected_ruc="0990123456001",
        selected_periodos=("202601",),
        allowed_rucs=("0990123456001",),
        available_periods_by_ruc={"0990123456001": period_range("202501", "202612")},
    )

    result = executor.execute(
        "comparePeriods",
        {
            "clientId": "0990123456001",
            "periodA": {"startDate": "2025-01-01", "endDate": "2025-12-31"},
            "periodB": {"startDate": "2026-01-01", "endDate": "2026-12-31"},
            "metrics": ["revenue", "net_profit"],
        },
        context,
    )

    assert result["ui_action"]["href"] == "/comparativo"
    assert result["ui_action"]["periodosA"] == period_range("202501", "202512")
    assert result["ui_action"]["periodosB"] == period_range("202601", "202612")


def test_metric_comparison_does_not_trigger_period_navigation_locally():
    ai = AiAssistantService(service_with_periods(period_range("202601", "202612")), Settings(), PassiveXaiClient())

    result = ai.chat("compara ingresos y costos de 2026", "0990123456001", ["202601"], [])

    assert result["provider"] == "xai"
    assert result["ui_action"] is None


def test_anomaly_intent_uses_cross_year_month_range_from_message():
    service = service_with_periods(
        [
            "202501",
            "202502",
            "202503",
            "202504",
            "202505",
            "202506",
            "202507",
            "202508",
            "202509",
            "202510",
            "202511",
            "202512",
            "202601",
            "202602",
            "202603",
            "202604",
            "202605",
        ]
    )
    ai = AiAssistantService(service, Settings(), FailingXaiClient())

    result = ai.chat(
        "muestrame las anomalias desde noviembre del 2025 a Junio del 2026",
        "0990123456001",
        ["202601", "202602", "202603", "202604", "202605"],
        [],
    )

    assert result["provider"] == "local-intent"
    assert result["executed_tools"] == ["getAnomalies"]
    assert result["ui_action"]["href"] == "/anomalies"
    assert result["ui_action"]["periodos"] == [
        "202511",
        "202512",
        "202601",
        "202602",
        "202603",
        "202604",
        "202605",
    ]


def test_anomaly_intent_accepts_numeric_month_range():
    service = service_with_periods(["202510", "202511", "202512", "202601", "202602", "202603"])
    ai = AiAssistantService(service, Settings(), FailingXaiClient())

    result = ai.chat("ver riesgo de 11/2025 hasta 02/2026", "0990123456001", ["202603"], [])

    assert result["provider"] == "local-intent"
    assert result["executed_tools"] == ["getAnomalies"]
    assert result["ui_action"]["periodos"] == ["202511", "202512", "202601", "202602"]


def test_show_data_intent_uses_cross_year_month_range():
    service = service_with_periods(["202511", "202512", "202601", "202602", "202603", "202604", "202605"])
    ai = AiAssistantService(service, Settings(), FailingXaiClient())

    result = ai.chat("muestrame los datos de nov 2025 a may 2026", "0990123456001", ["202601"], [])

    assert result["provider"] == "local-intent"
    assert result["executed_tools"] == ["renderDashboard"]
    assert result["ui_action"]["href"] == "/"
    assert result["ui_action"]["periodos"] == ["202511", "202512", "202601", "202602", "202603", "202604", "202605"]


COMMON_RANGE_PERIODS = [
    "202501",
    "202502",
    "202503",
    "202504",
    "202505",
    "202506",
    "202507",
    "202508",
    "202509",
    "202510",
    "202511",
    "202512",
    "202601",
    "202602",
    "202603",
    "202604",
    "202605",
]
NOV_2025_TO_MAY_2026 = ["202511", "202512", "202601", "202602", "202603", "202604", "202605"]
JAN_TO_MAR_2026 = ["202601", "202602", "202603"]
FULL_2025 = [
    "202501",
    "202502",
    "202503",
    "202504",
    "202505",
    "202506",
    "202507",
    "202508",
    "202509",
    "202510",
    "202511",
    "202512",
]


@pytest.mark.parametrize(
    ("prompt", "expected_href", "expected_tool", "expected_periodos"),
    [
        ("muestrame las anomalias desde noviembre del 2025 a junio del 2026", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("muéstrame anomalías de noviembre 2025 hasta junio 2026", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("quiero ver el riesgo entre nov 2025 y jun 2026", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("riesgo de noviembre a junio 2026", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("show anomalies from november 2025 to june 2026", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("muestrame anomalías 2025-11 a 2026-06", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("muestrame anomalias de 202511 a 202606", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("muestrame anomalias de 11/2025 hasta 06/2026", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("muestrame anomalias de 2025/11 a 2026/06", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("muestrame anomalias de nov-2025 a jun-2026", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("muestrame anomalias de nov/2025 a jun/2026", "/anomalies", "getAnomalies", NOV_2025_TO_MAY_2026),
        ("muestrame las anomalias q1 2026", "/anomalies", "getAnomalies", JAN_TO_MAR_2026),
        ("muestrame las anomalias del primer trimestre 2026", "/anomalies", "getAnomalies", JAN_TO_MAR_2026),
        ("muestrame las anomalias de enero a marzo 2026", "/anomalies", "getAnomalies", JAN_TO_MAR_2026),
        ("muestrame las anomalias de enero 2026", "/anomalies", "getAnomalies", ["202601"]),
        ("muestrame las anomalias del 2025", "/anomalies", "getAnomalies", FULL_2025),
        ("muestrame los datos desde noviembre del 2025 a junio del 2026", "/", "renderDashboard", NOV_2025_TO_MAY_2026),
        ("abre el dashboard de nov 2025 a jun 2026", "/", "renderDashboard", NOV_2025_TO_MAY_2026),
        ("muestrame el dashboard 2025-11 hasta 2026-06", "/", "renderDashboard", NOV_2025_TO_MAY_2026),
        ("muestrame los datos q1 2026", "/", "renderDashboard", JAN_TO_MAR_2026),
        ("muestrame los datos de enero a marzo 2026", "/", "renderDashboard", JAN_TO_MAR_2026),
        ("muestrame los datos 202511 a 202606", "/", "renderDashboard", NOV_2025_TO_MAY_2026),
        ("muestrame los datos del 2025", "/", "renderDashboard", FULL_2025),
        ("abre notas niif de noviembre 2025 a mayo 2026", "/notas", "renderDashboard", NOV_2025_TO_MAY_2026),
        ("muestrame libro mayor de noviembre 2025 a mayo 2026", "/mayor", "renderDashboard", NOV_2025_TO_MAY_2026),
    ],
)
def test_local_navigation_intents_parse_common_period_phrasings(
    prompt: str,
    expected_href: str,
    expected_tool: str,
    expected_periodos: list[str],
):
    ai = AiAssistantService(service_with_periods(COMMON_RANGE_PERIODS), Settings(), FailingXaiClient())

    result = ai.chat(prompt, "0990123456001", ["202601", "202602", "202603", "202604", "202605"], [])

    assert result["provider"] == "local-intent"
    assert result["executed_tools"] == [expected_tool]
    assert result["ui_action"]["href"] == expected_href
    assert result["ui_action"]["periodos"] == expected_periodos


def test_local_navigation_intents_support_long_uploaded_year_ranges():
    available = period_range("203001", "203512")
    ai = AiAssistantService(service_with_periods(available), Settings(), FailingXaiClient())

    result = ai.chat("muestrame las anomalias de 2030 a 2035", "0990123456001", ["203501"], [])

    assert result["provider"] == "local-intent"
    assert result["executed_tools"] == ["getAnomalies"]
    assert result["ui_action"]["periodos"] == available


def test_ai_tools_do_not_reject_ranges_longer_than_two_years():
    available = period_range("203001", "203512")
    executor = AiToolExecutor(service_with_periods(available))
    context = AiContext(
        selected_ruc="0990123456001",
        selected_periodos=tuple(available),
        allowed_rucs=("0990123456001",),
        available_periods_by_ruc={"0990123456001": available},
    )

    result = executor.execute(
        "getFinancialSummary",
        {
            "clientId": "0990123456001",
            "startDate": "2030-01-01",
            "endDate": "2035-12-31",
            "metrics": ["revenue"],
        },
        context,
    )

    assert result["status"] == "success"
    assert result["ui_action"]["periodos"] == available


@pytest.mark.parametrize(
    ("prompt", "expected_periodos"),
    [
        ("muestrame anomalias de nov 25 a jun 26", ["202511", "202512", "202601", "202602", "202603", "202604", "202605", "202606"]),
        ("muestrame anomalias de 11/25 a 06/26", ["202511", "202512", "202601", "202602", "202603", "202604", "202605", "202606"]),
        ("muestrame los datos de dic 99 a feb 00", ["199912", "200001", "200002"]),
    ],
)
def test_local_navigation_intents_accept_two_digit_year_month_ranges(prompt: str, expected_periodos: list[str]):
    available = period_range("199901", "200012") + period_range("202501", "202612")
    ai = AiAssistantService(service_with_periods(available), Settings(), FailingXaiClient())

    result = ai.chat(prompt, "0990123456001", ["202601"], [])

    assert result["provider"] == "local-intent"
    assert result["ui_action"]["periodos"] == expected_periodos


@pytest.mark.parametrize(
    "question",
    [
        "Que quiere decir riesgo medio-bajo?",          # anomalies keyword ("riesgo")
        "Que significa el score de anomalias?",         # anomalies
        "Por que cambio el margen entre 2025 y 2026?",  # comparison keywords ("cambio", "entre ... y")
        "Que es el libro mayor?",                       # general ledger
        "Para que sirven las notas niif?",              # notes
        "Es bueno tener un margen neto de 33%?",        # judgement question
        "Como se interpreta la razon corriente?",       # interpretation
        "Que tan saludable es la liquidez?",            # interpretation
        "What does a medium risk score mean?",          # english
    ],
)
def test_conceptual_questions_go_to_model_across_all_areas(question: str):
    # A question that merely mentions an area keyword must be answered conversationally,
    # never turned into a templated navigation reply. Holds for every area and phrasing.
    ai = AiAssistantService(service_with_data(), Settings(), PassiveXaiClient())

    result = ai.chat(question, "0990123456001", ["202501"], [])

    assert result["provider"] == "xai"
    assert result["message"] == "respuesta del modelo"
    assert result["ui_action"] is None
    assert result["executed_tools"] == []


def test_navigation_commands_still_use_local_intent_after_explanatory_guard():
    # Genuine "show me X" commands keep the deterministic fast path (no regression).
    ai = AiAssistantService(service_with_data(), Settings(), FailingXaiClient())

    result = ai.chat("muestrame las anomalias de 2025", "0990123456001", ["202601"], [])

    assert result["provider"] == "local-intent"
    assert result["ui_action"]["href"] == "/anomalies"
