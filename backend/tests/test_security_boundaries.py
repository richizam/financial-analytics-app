from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.app.api.dependencies import get_ai_service
from backend.app.api.router import protected_router, public_router
from backend.app.api.routes import uploads
from backend.app.core.config import Settings
from backend.app.core import security
from backend.app.domain.financial.imports import MAX_CSV_UPLOAD_BYTES
from backend.app.storage import factory
from backend.app.storage.file import FileCsvStorage


ROOT = Path(__file__).resolve().parents[2]


def _service_block(compose_text: str, service: str) -> str:
    lines = compose_text.splitlines()
    start = next(index for index, line in enumerate(lines) if line == f"  {service}:")
    body: list[str] = []
    for line in lines[start + 1 :]:
        if line.startswith("  ") and not line.startswith("    ") and line.endswith(":"):
            break
        body.append(line)
    return "\n".join(body)


def test_production_storage_fails_closed_without_database_url():
    settings = Settings(
        app_env="production",
        backend_storage="auto",
        database_url=None,
        backend_api_key="test-backend-key",
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_test",
    )

    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        factory.create_storage(settings)


def test_production_storage_does_not_fallback_to_file_when_database_fails(monkeypatch):
    class BrokenDatabaseStorage:
        def __init__(self, _database_url: str) -> None:
            pass

        def ensure_schema(self) -> None:
            raise RuntimeError("schema missing")

        def ping(self) -> None:
            raise AssertionError("ping should not be reached")

    monkeypatch.setattr(factory, "DatabaseCsvStorage", BrokenDatabaseStorage)
    settings = Settings(
        app_env="production",
        backend_storage="auto",
        database_url="postgresql://user:pass@example.test:5432/postgres",
        backend_api_key="test-backend-key",
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_test",
    )

    with pytest.raises(RuntimeError, match="schema missing"):
        factory.create_storage(settings)


def test_file_storage_rejects_path_traversal_and_invalid_rucs(tmp_path):
    storage = FileCsvStorage(tmp_path)

    with pytest.raises(ValueError):
        storage.upsert("0990123456001", "../202501.csv", "x")
    with pytest.raises(ValueError):
        storage.read("../0990123456001", "202501.csv")
    with pytest.raises(ValueError):
        storage.read("0990123456001", "202501.csv/../../secret.csv")


def test_only_health_is_on_the_public_backend_router():
    public_paths = {route.path for route in public_router.routes}
    protected_paths = {route.path for route in protected_router.routes}

    assert "/health" in public_paths
    assert "/upload-csv" in protected_paths
    assert "/ai/chat" in protected_paths
    assert "/upload-csv" not in public_paths
    assert "/ai/chat" not in public_paths
    assert protected_router.dependencies


def test_protected_backend_routes_require_api_key_then_supabase_token(monkeypatch):
    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: Settings(
            app_env="production",
            backend_api_key="server-only-key",
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_test",
        ),
    )
    app = FastAPI()
    app.include_router(protected_router, prefix="/api/v1")
    client = TestClient(app)

    missing_key = client.post("/api/v1/dashboard", json={"ruc": "0990123456001", "periodos": ["202501"]})
    missing_auth = client.post(
        "/api/v1/dashboard",
        headers={"X-Backend-Api-Key": "server-only-key"},
        json={"ruc": "0990123456001", "periodos": ["202501"]},
    )

    assert missing_key.status_code == 401
    assert missing_key.json()["detail"] == "Invalid backend API key"
    assert missing_auth.status_code == 401
    assert missing_auth.json()["detail"] == "Missing Supabase access token"


def test_upload_route_rejects_oversized_file_before_domain_import():
    class FailingFinancialService:
        def upload_csv(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            raise AssertionError("oversized upload should be rejected before import")

    class FakeAiService:
        financial_service = FailingFinancialService()

        def suggest_csv_mapping(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            raise AssertionError("oversized upload should not call AI mapping")

    app = FastAPI()
    app.dependency_overrides[get_ai_service] = lambda: FakeAiService()
    app.include_router(uploads.router)
    client = TestClient(app)

    response = client.post(
        "/upload-csv",
        data={"ruc": "0990123456001"},
        files={"file": ("202501.csv", b"x" * (MAX_CSV_UPLOAD_BYTES + 1), "text/csv")},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": False, "error": "CSV demasiado grande. El limite es 2 MB por archivo."}


def test_upload_route_rejects_non_json_mapping_before_domain_import():
    class FailingFinancialService:
        def upload_csv(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            raise AssertionError("bad mapping should be rejected before import")

    class FakeAiService:
        financial_service = FailingFinancialService()

    app = FastAPI()
    app.dependency_overrides[get_ai_service] = lambda: FakeAiService()
    app.include_router(uploads.router)
    client = TestClient(app)

    response = client.post(
        "/upload-csv",
        data={"ruc": "0990123456001", "mapping": "not-json"},
        files={"file": ("202501.csv", b"Fecha,Cuenta,Descripcion,Debe,Haber\n", "text/csv")},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": False, "error": "El mapeo enviado no es JSON valido."}


def test_compose_publishes_only_nginx_and_forces_backend_production_guards():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    backend = _service_block(compose, "backend")
    frontend = _service_block(compose, "frontend")
    nginx = _service_block(compose, "nginx")

    assert "\n    ports:" not in backend
    assert "\n    ports:" not in frontend
    assert "\n    ports:" in nginx
    assert "APP_ENV: production" in backend
    assert "BACKEND_STORAGE: db" in backend
    assert 'BACKEND_REQUIRE_API_KEY: "true"' in backend
    assert 'SUPABASE_AUTH_REQUIRED: "true"' in backend
    assert "BACKEND_API_KEY" in frontend
    assert "PYTHON_BACKEND_URL: http://backend:8000" in frontend


def test_nginx_does_not_proxy_browser_requests_to_backend_api():
    nginx = (ROOT / "deploy" / "nginx" / "default.conf").read_text(encoding="utf-8")

    assert "location ^~ /api/v1/" in nginx
    assert "return 404;" in nginx.split("location ^~ /api/v1/", 1)[1].split("}", 1)[0]
    assert "location = /health" in nginx
    assert "return 404;" in nginx.split("location = /health", 1)[1].split("}", 1)[0]
    assert "proxy_pass http://frontend:3000;" in nginx
    assert "proxy_pass http://backend:8000;" not in nginx


def test_frontend_does_not_reference_server_secrets_as_public_env_vars():
    frontend_sources = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in (ROOT / "src").rglob("*")
        if path.suffix in {".ts", ".tsx"}
    )

    forbidden_browser_envs = [
        "NEXT_PUBLIC_BACKEND_API_KEY",
        "NEXT_PUBLIC_DATABASE_URL",
        "NEXT_PUBLIC_XAI_API_KEY",
        "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE",
        "service_role",
    ]
    for token in forbidden_browser_envs:
        assert token not in frontend_sources
