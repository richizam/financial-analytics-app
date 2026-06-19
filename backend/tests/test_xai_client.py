from __future__ import annotations

from typing import Any

import pytest

from backend.app.core.config import Settings
from backend.app.domain.ai import xai_client as xai_module
from backend.app.domain.ai.xai_client import XaiClient


class FakeResponse:
    status_code = 200
    text = ""

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def json(self) -> dict[str, Any]:
        return self.payload


def test_settings_rejects_invalid_xai_reasoning_effort() -> None:
    with pytest.raises(RuntimeError, match="XAI_REASONING_EFFORT"):
        Settings(xai_reasoning_effort="maximum").validate()


def test_chat_completion_sends_configured_reasoning_effort(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_post(
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
        timeout: float,
    ) -> FakeResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(xai_module, "httpx", type("FakeHttpx", (), {"post": staticmethod(fake_post)}))

    client = XaiClient(Settings(xai_api_key="test-key", xai_reasoning_effort="medium"))
    client.create_chat_completion([{"role": "user", "content": "hola"}])

    assert captured["url"].endswith("/v1/chat/completions")
    assert captured["json"]["reasoning_effort"] == "medium"
    assert captured["headers"]["Authorization"] == "Bearer test-key"


def test_response_api_sends_configured_reasoning_effort(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_post(
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
        timeout: float,
    ) -> FakeResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return FakeResponse({"output": [{"type": "message", "content": []}]})

    monkeypatch.setattr(xai_module, "httpx", type("FakeHttpx", (), {"post": staticmethod(fake_post)}))

    client = XaiClient(Settings(xai_api_key="test-key", xai_reasoning_effort="medium"))
    client.create_response([{"role": "user", "content": "hola"}])

    assert captured["url"].endswith("/v1/responses")
    assert captured["json"]["reasoning"] == {"effort": "medium"}
    assert captured["headers"]["Authorization"] == "Bearer test-key"
