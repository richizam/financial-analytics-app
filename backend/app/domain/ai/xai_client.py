from __future__ import annotations

from typing import Any

try:
    import httpx
except ImportError:  # pragma: no cover - dependency is declared for real runs.
    httpx = None  # type: ignore[assignment]

from backend.app.core.config import Settings


class XaiConfigurationError(RuntimeError):
    pass


class XaiClientError(RuntimeError):
    pass


def _normalize_base_url(raw: str) -> str:
    base_url = raw.rstrip("/")
    return base_url if base_url.endswith("/v1") else f"{base_url}/v1"


class XaiClient:
    def __init__(self, settings: Settings) -> None:
        self.api_key = settings.xai_api_key
        self.base_url = _normalize_base_url(settings.xai_base_url)
        self.model = settings.xai_model
        self.reasoning_effort = settings.xai_reasoning_effort
        self.timeout_seconds = settings.xai_timeout_seconds

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def create_response(
        self,
        input_items: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        previous_response_id: str | None = None,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise XaiConfigurationError("XAI_API_KEY is not configured")
        if httpx is None:
            raise XaiConfigurationError("httpx is not installed")

        body: dict[str, Any] = {
            "model": self.model,
            "input": input_items,
            "store": False,
            "temperature": 0.2,
            "reasoning": {"effort": self.reasoning_effort},
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
            body["parallel_tool_calls"] = False
        if previous_response_id:
            body["previous_response_id"] = previous_response_id

        try:
            response = httpx.post(
                f"{self.base_url}/responses",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=self.timeout_seconds,
            )
        except Exception as exc:  # pragma: no cover - network failure shape varies.
            raise XaiClientError(f"xAI request failed: {exc}") from exc

        if response.status_code >= 400:
            detail = response.text[:800]
            raise XaiClientError(f"xAI request failed ({response.status_code}): {detail}")

        parsed = response.json()
        if not isinstance(parsed, dict):
            raise XaiClientError("xAI returned an unexpected response shape")
        return parsed

    def create_chat_completion(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise XaiConfigurationError("XAI_API_KEY is not configured")
        if httpx is None:
            raise XaiConfigurationError("httpx is not installed")

        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
            "reasoning_effort": self.reasoning_effort,
        }
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool.get("description", ""),
                        "parameters": tool.get("parameters", {}),
                    },
                }
                for tool in tools
            ]
            body["tool_choice"] = "auto"
            body["parallel_tool_calls"] = False

        try:
            response = httpx.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=self.timeout_seconds,
            )
        except Exception as exc:  # pragma: no cover - network failure shape varies.
            raise XaiClientError(f"xAI request failed: {exc}") from exc

        if response.status_code >= 400:
            detail = response.text[:800]
            raise XaiClientError(f"xAI request failed ({response.status_code}): {detail}")

        parsed = response.json()
        if not isinstance(parsed, dict):
            raise XaiClientError("xAI returned an unexpected response shape")
        return parsed
