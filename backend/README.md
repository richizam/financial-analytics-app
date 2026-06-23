# Python Backend

FastAPI owns financial calculations and protected data access. Next.js remains the React shell and calls this service through server actions.

## Structure

```text
backend/app/
  api/                 HTTP routes, dependencies, router composition
  core/                settings, API-key guard, Supabase JWT verification
  domain/financial/    accounting rules and financial application service
  domain/ai/           Grok/xAI tools and orchestration
  schemas/             Pydantic request schemas
  storage/             file and Supabase Postgres storage adapters
  main.py              FastAPI app factory
```

## Configuration

- `PYTHON_BACKEND_URL`: URL used by Next.js to reach this service. Defaults to `http://127.0.0.1:8000`.
- `APP_ENV`: set to `production` in production.
- `BACKEND_STORAGE`: use `db` for Supabase Postgres.
- `DATABASE_URL`: Supabase Postgres connection string.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key used for token validation fallback.
- `SUPABASE_AUTH_REQUIRED`: set to `true` in production.
- `CORS_ORIGINS`: comma-separated browser origins.
- `BACKEND_API_KEY`: shared secret sent by Next.js as `X-Backend-Api-Key`.
- `BACKEND_REQUIRE_API_KEY`: set to `true` in production.

Protected application endpoints are mounted under `/api/v1`. `/health` stays public and returns only service status.

## Access Model

Business routes require both:

```text
X-Backend-Api-Key: <server-side shared key>
Authorization: Bearer <Supabase access token>
```

The backend verifies the Supabase JWT, resolves the user's active workspace, and scopes all RUC/file access to that workspace. The AI service receives the same scoped financial service, so AI tools cannot see companies outside the authenticated workspace.

## Production Access

The Python API is not meant to be public browser-facing infrastructure.

1. Keep FastAPI on a private Docker/VPS network.
2. Expose only Nginx/public frontend ports.
3. Set `APP_ENV=production`, `BACKEND_REQUIRE_API_KEY=true`, and `SUPABASE_AUTH_REQUIRED=true`.
4. Restrict `CORS_ORIGINS` to the frontend origin.
5. Never expose Supabase secret/service-role keys to the frontend.

When `APP_ENV=production`, FastAPI disables `/docs`, `/redoc`, and `/openapi.json`.
