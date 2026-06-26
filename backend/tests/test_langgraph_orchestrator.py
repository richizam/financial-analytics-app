from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage

from backend.app.core.config import Settings
from backend.app.domain.ai import AiAssistantService
from backend.app.domain.ai.orchestrator import LangGraphOrchestrator
from backend.app.domain.ai.tools import AiContext, AiToolValidationError
from backend.app.domain.financial import FinancialService


RUC = "0990123456001"


# --- fakes -------------------------------------------------------------------

class FakeModel:
    """Stands in for ChatOpenAI: returns scripted AIMessages in order."""

    def __init__(self, scripted: list[AIMessage]) -> None:
        self.scripted = list(scripted)
        self.calls = 0
        self.seen_messages: list[list[str]] = []

    def bind_tools(self, specs: Any, **kwargs: Any) -> "FakeModel":
        return self

    def invoke(self, messages: Any, config: Any = None) -> AIMessage:
        self.seen_messages.append([str(getattr(message, "content", "")) for message in messages])
        message = self.scripted[min(self.calls, len(self.scripted) - 1)]
        self.calls += 1
        return message


class RaisingModel:
    def bind_tools(self, specs: Any, **kwargs: Any) -> "RaisingModel":
        return self

    def invoke(self, messages: Any, config: Any = None) -> AIMessage:
        raise RuntimeError("xAI unreachable")


class FakeExecutor:
    def __init__(self, raise_first: bool = False) -> None:
        self.raise_first = raise_first
        self.calls = 0

    def definitions(self, context: AiContext) -> list[dict[str, Any]]:
        return [
            {
                "name": "getAnomalies",
                "description": "anomalies",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            }
        ]

    def execute(self, name: str, args: Any, context: AiContext) -> dict[str, Any]:
        self.calls += 1
        if self.raise_first and self.calls == 1:
            raise AiToolValidationError("bad arguments")
        return {
            "tool_name": name,
            "result_id": "r1",
            "status": "success",
            "source": "calculated_by_backend",
        }


class UiExecutor(FakeExecutor):
    def execute(self, name: str, args: Any, context: AiContext) -> dict[str, Any]:
        self.calls += 1
        return {
            "tool_name": name,
            "result_id": "render1",
            "status": "success",
            "source": "frontend_instruction",
            "ui_action": {
                "type": "render_dashboard",
                "dashboard_id": "anomalies",
                "href": "/anomalies",
                "ruc": RUC,
                "periodos": ["202501"],
            },
        }


def _ctx() -> AiContext:
    return AiContext(
        selected_ruc=RUC,
        selected_periodos=("202501",),
        allowed_rucs=(RUC,),
        available_periods_by_ruc={RUC: ["202501"]},
    )


def _tool_call_message() -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": "getAnomalies", "args": {}, "id": "call_1"}])


def _render_call_message() -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": "renderDashboard", "args": {}, "id": "call_render"}])


# --- orchestrator-level tests ------------------------------------------------

def test_graph_executes_tool_and_returns_contract():
    model = FakeModel([_tool_call_message(), AIMessage(content="Aqui esta el analisis.")])
    orch = LangGraphOrchestrator(Settings(), model=model)

    out = orch.chat(
        input_items=[{"role": "user", "content": "anomalias?"}],
        context=_ctx(),
        executor=FakeExecutor(),
        thread_id="t1",
    )

    assert out["provider"] == "langgraph"
    assert out["message"] == "Aqui esta el analisis."
    assert out["executed_tools"] == ["getAnomalies"]
    assert out["citations"][0]["result_id"] == "r1"


def test_graph_self_corrects_on_tool_validation_error():
    # First model turn calls the tool (which raises), second turn answers.
    model = FakeModel([_tool_call_message(), AIMessage(content="Listo tras corregir.")])
    executor = FakeExecutor(raise_first=True)
    orch = LangGraphOrchestrator(Settings(), model=model)

    out = orch.chat(
        input_items=[{"role": "user", "content": "anomalias?"}],
        context=_ctx(),
        executor=executor,
        thread_id="t2",
    )

    # The validation error did NOT abort the turn; the model produced a final answer.
    assert out["provider"] == "langgraph"
    assert out["message"] == "Listo tras corregir."
    # The failed call is not cited (only successful results are).
    assert out["executed_tools"] == []


def test_thread_appends_only_new_message_on_second_turn():
    # A persistent thread (same thread_id) should NOT re-seed the system+history;
    # the second turn appends only the new user message to the checkpointed state.
    model = FakeModel(
        [AIMessage(content="Primera respuesta."), AIMessage(content="Segunda respuesta.")]
    )
    orch = LangGraphOrchestrator(Settings(), model=model)
    ctx = _ctx()

    first = orch.chat(
        input_items=[{"role": "system", "content": "sys"}, {"role": "user", "content": "hola"}],
        context=ctx,
        executor=FakeExecutor(),
        thread_id="shared",
        new_message="hola",
    )
    second = orch.chat(
        input_items=[{"role": "system", "content": "sys"}, {"role": "user", "content": "y ahora?"}],
        context=ctx,
        executor=FakeExecutor(),
        thread_id="shared",
        new_message="y ahora?",
    )

    assert first["message"] == "Primera respuesta."
    assert second["message"] == "Segunda respuesta."
    # State accumulated across turns: sys + hola + ai1 + refreshed sys + y ahora? + ai2.
    snapshot = orch.graph.get_state(
        {"configurable": {"thread_id": "shared", "executor": FakeExecutor(), "context": ctx, "model": model}}
    )
    assert len(snapshot.values["messages"]) == 6


def test_existing_thread_receives_fresh_app_context():
    model = FakeModel([AIMessage(content="Primera respuesta."), AIMessage(content="Segunda respuesta.")])
    orch = LangGraphOrchestrator(Settings(), model=model)
    ctx = _ctx()

    orch.chat(
        input_items=[
            {"role": "system", "content": "ctx: periodo 2025"},
            {"role": "user", "content": "hola"},
        ],
        context=ctx,
        executor=FakeExecutor(),
        thread_id="context-thread",
        new_message="hola",
    )
    orch.chat(
        input_items=[
            {"role": "system", "content": "ctx: periodo 2026"},
            {"role": "assistant", "content": "old visible history should not be replayed"},
            {"role": "user", "content": "y ahora?"},
        ],
        context=ctx,
        executor=FakeExecutor(),
        thread_id="context-thread",
        new_message="y ahora?",
    )

    second_turn = model.seen_messages[1]
    assert second_turn[-2:] == ["ctx: periodo 2026", "y ahora?"]
    assert "old visible history should not be replayed" not in second_turn


def test_second_turn_does_not_reuse_previous_ui_action():
    model = FakeModel(
        [
            _render_call_message(),
            AIMessage(content="Abriendo anomalias."),
            AIMessage(content="Esto significa que debes revisar los outliers."),
        ]
    )
    orch = LangGraphOrchestrator(Settings(), model=model)
    ctx = _ctx()

    first = orch.chat(
        input_items=[{"role": "user", "content": "abre anomalias"}],
        context=ctx,
        executor=UiExecutor(),
        thread_id="ui-thread",
        new_message="abre anomalias",
    )
    second = orch.chat(
        input_items=[{"role": "user", "content": "que significa esto?"}],
        context=ctx,
        executor=UiExecutor(),
        thread_id="ui-thread",
        new_message="que significa esto?",
    )

    assert first["ui_action"]["dashboard_id"] == "anomalies"
    assert first["executed_tools"] == ["renderDashboard"]
    assert second["message"] == "Esto significa que debes revisar los outliers."
    assert second["ui_action"] is None
    assert second["executed_tools"] == []
    assert second["citations"] == []


def _clarify_message() -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[
            {
                "name": "askClarification",
                "args": {"question": "Que periodo quieres analizar?", "options": ["2025", "2026"]},
                "id": "call_c",
            }
        ],
    )


def test_clarification_interrupts_then_resumes():
    model = FakeModel([_clarify_message(), AIMessage(content="Con 2025, aqui esta el resumen.")])
    orch = LangGraphOrchestrator(Settings(), model=model)
    ctx = _ctx()
    common = dict(context=ctx, executor=FakeExecutor(), thread_id="clarify-thread")

    # Turn 1: the agent asks for clarification → run pauses.
    paused = orch.chat(input_items=[{"role": "user", "content": "dame el resumen"}], new_message="dame el resumen", **common)
    assert paused["provider"] == "clarification"
    assert paused["clarification"]["question"] == "Que periodo quieres analizar?"
    assert paused["clarification"]["options"] == ["2025", "2026"]

    # Turn 2: the user answers → the same thread resumes and completes.
    resumed = orch.chat(input_items=[], resume="2025", **common)
    assert resumed["provider"] == "langgraph"
    assert resumed["message"] == "Con 2025, aqui esta el resumen."


def test_graph_falls_back_on_model_error():
    orch = LangGraphOrchestrator(Settings(), model=RaisingModel())

    out = orch.chat(
        input_items=[{"role": "user", "content": "hola"}],
        context=_ctx(),
        executor=FakeExecutor(),
        thread_id="t3",
    )

    assert out["provider"] == "local-fallback"
    assert "AI" in out["message"]


# --- service-level tests (flag routing + fast path preserved) ----------------

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


def _financial_service() -> FinancialService:
    storage = MemoryStorage()
    storage.upsert(
        RUC,
        "202501.csv",
        "\n".join(
            [
                "fecha,asiento,tipo,codCuenta,nombreCuenta,descripcion,debe,haber,centroCosto",
                "2025-01-01,A1,VT,1.1.1.01,Caja,Factura 1,150.00,0.00,VENTAS",
                "2025-01-01,A1,VT,4.1.1.01,Ventas,Factura 1,0.00,150.00,VENTAS",
            ]
        ),
    )
    return FinancialService(storage)


def test_service_langgraph_flag_routes_through_graph():
    settings = Settings(ai_orchestrator="langgraph")
    model = FakeModel([AIMessage(content="Respuesta del grafo.")])
    orch = LangGraphOrchestrator(settings, model=model)
    ai = AiAssistantService(_financial_service(), settings, orchestrator=orch)

    # A non-local-intent, conceptual question goes to the graph.
    out = ai.chat("que opinas de la liquidez en general?", RUC, ["202501"], [])

    assert out["provider"] == "langgraph"
    assert out["message"] == "Respuesta del grafo."
    assert model.calls == 1


def test_local_intent_still_short_circuits_under_langgraph_flag():
    settings = Settings(ai_orchestrator="langgraph")
    model = FakeModel([AIMessage(content="should not be used")])
    orch = LangGraphOrchestrator(settings, model=model)
    ai = AiAssistantService(_financial_service(), settings, orchestrator=orch)

    out = ai.chat("muestrame las anomalias", RUC, ["202501"], [])

    # Fast path answered without ever invoking the model.
    assert model.calls == 0
    assert out["provider"] != "langgraph"


def test_clarification_resume_is_not_stolen_by_local_intent():
    settings = Settings(ai_orchestrator="langgraph")
    model = FakeModel([_clarify_message(), AIMessage(content="Retomo la aclaracion con 2025.")])
    orch = LangGraphOrchestrator(settings, model=model)
    ai = AiAssistantService(_financial_service(), settings, orchestrator=orch)

    paused = ai.chat("necesito un analisis", RUC, ["202501"], [], thread_id="resume-local")
    resumed = ai.chat(
        "muestrame anomalias de 2025",
        RUC,
        ["202501"],
        [],
        thread_id="resume-local",
        resume="muestrame anomalias de 2025",
    )

    assert paused["provider"] == "clarification"
    assert resumed["provider"] == "langgraph"
    assert resumed["message"] == "Retomo la aclaracion con 2025."
    assert model.calls == 2
