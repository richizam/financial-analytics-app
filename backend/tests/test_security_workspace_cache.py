from __future__ import annotations

from types import SimpleNamespace

from backend.app.core import security


def test_workspace_lookup_is_cached_within_ttl(monkeypatch):
    security._workspace_auth_cache.clear()
    calls: list[str] = []
    now = 1000.0

    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: SimpleNamespace(workspace_auth_cache_ttl_seconds=15),
    )
    monkeypatch.setattr(security.time, "monotonic", lambda: now)

    def resolve(user_id: str) -> tuple[str, str]:
        calls.append(user_id)
        return "workspace-1", "owner"

    monkeypatch.setattr(security, "_resolve_active_workspace_for_user", resolve)

    assert security._active_workspace_for_user("user-1") == ("workspace-1", "owner")
    assert security._active_workspace_for_user("user-1") == ("workspace-1", "owner")
    assert calls == ["user-1"]


def test_workspace_lookup_refreshes_after_ttl(monkeypatch):
    security._workspace_auth_cache.clear()
    calls = 0
    now = 1000.0

    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: SimpleNamespace(workspace_auth_cache_ttl_seconds=1),
    )
    monkeypatch.setattr(security.time, "monotonic", lambda: now)

    def resolve(_user_id: str) -> tuple[str, str]:
        nonlocal calls
        calls += 1
        return f"workspace-{calls}", "owner"

    monkeypatch.setattr(security, "_resolve_active_workspace_for_user", resolve)

    assert security._active_workspace_for_user("user-1") == ("workspace-1", "owner")
    now = 1002.0
    assert security._active_workspace_for_user("user-1") == ("workspace-2", "owner")
    assert calls == 2


def test_workspace_lookup_cache_can_be_disabled(monkeypatch):
    security._workspace_auth_cache.clear()
    calls = 0

    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: SimpleNamespace(workspace_auth_cache_ttl_seconds=0),
    )

    def resolve(_user_id: str) -> tuple[str, str]:
        nonlocal calls
        calls += 1
        return "workspace-1", "owner"

    monkeypatch.setattr(security, "_resolve_active_workspace_for_user", resolve)

    assert security._active_workspace_for_user("user-1") == ("workspace-1", "owner")
    assert security._active_workspace_for_user("user-1") == ("workspace-1", "owner")
    assert calls == 2
