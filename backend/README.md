# Python Backend

This FastAPI service owns the data access and financial calculations for the app.
Next.js remains the React shell and calls this service through server actions.

## Structure

```text
backend/app/
  api/                 HTTP routes, dependencies, router composition
  core/                settings and backend-to-backend security
  domain/financial/    accounting rules and financial application service
  schemas/             Pydantic request schemas
  storage/             file and PostgreSQL storage adapters
  main.py              FastAPI app factory
```

Business logic belongs in `domain/financial`; route handlers should stay thin.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```

In another terminal, run the Next frontend:

```bash
npm run dev
```

## Configuration

- `PYTHON_BACKEND_URL`: URL used by Next.js to reach this service. Defaults to `http://127.0.0.1:8000`.
- `APP_ENV`: set to `production` in production.
- `BACKEND_STORAGE`: `auto`, `db`, or `file`. Defaults to `auto`.
- `DATABASE_URL`: PostgreSQL URL used when storage is `db` or when `auto` can connect.
- `DATA_ROOT`: filesystem fallback root. Defaults to `data/empresas`.
- `CORS_ORIGINS`: comma-separated browser origins. Defaults to local Next dev origins.
- `BACKEND_API_KEY`: shared secret sent by Next.js to the Python backend as `X-Backend-Api-Key`.
- `BACKEND_REQUIRE_API_KEY`: set to `true` to force API-key checks. It defaults to `true` when `APP_ENV=production`.

The database storage uses the existing Prisma-compatible `CsvFile` table shape.
Protected application endpoints are mounted under `/api/v1`. `/health` stays public and returns only service status.

## Production Access

The Python API is not meant to be a public browser-facing API. In production:

1. Bind it to a private interface or private service network, not directly to the public internet.
2. Set `APP_ENV=production`, `BACKEND_REQUIRE_API_KEY=true`, and a strong `BACKEND_API_KEY` on both Next.js and FastAPI.
3. Point `PYTHON_BACKEND_URL` at the private backend URL from the Next.js runtime.
4. Restrict `CORS_ORIGINS` to the frontend origin.
5. Do not expose FastAPI directly through a public load balancer unless another private-network or gateway policy blocks public access.

When `APP_ENV=production`, FastAPI disables `/docs`, `/redoc`, and `/openapi.json`.
