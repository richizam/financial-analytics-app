from __future__ import annotations

from typing import Any


class AnalysisCache:
    """Thin wrapper over a storage backend's optional analysis-cache methods.

    File storage has no cache; database storage does. The getattr probes keep
    the cache transparent: when the backend lacks the methods, every call is a
    no-op and analyses are recomputed on demand.
    """

    def __init__(self, storage: Any) -> None:
        self.storage = storage

    @staticmethod
    def period_key(periodos: list[str]) -> str:
        return ",".join(sorted(periodos))

    def get(self, ruc: str, analysis_type: str, period_key: str) -> dict[str, Any] | None:
        getter = getattr(self.storage, "get_analysis_cache", None)
        if not callable(getter):
            return None
        cached = getter(ruc, analysis_type, period_key)
        return cached if isinstance(cached, dict) else None

    def set(self, ruc: str, analysis_type: str, period_key: str, payload: dict[str, Any]) -> None:
        setter = getattr(self.storage, "set_analysis_cache", None)
        if callable(setter):
            setter(ruc, analysis_type, period_key, payload)

    def invalidate(self, ruc: str) -> None:
        invalidator = getattr(self.storage, "invalidate_analysis_cache", None)
        if callable(invalidator):
            invalidator(ruc)
