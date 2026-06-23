# Local Docker and VPS Runbook

The production-shaped stack is now:

```text
Browser -> Nginx :8080 -> Next.js :3000 -> FastAPI :8000 -> Supabase Auth/Postgres
```

Only Nginx is published to the host. FastAPI stays private on the Docker network. Supabase owns user identity and the financial storage tables.

## Required Supabase Setup

1. Run `supabase/migrations/202606230001_auth_workspaces_storage.sql` on the Supabase project.
2. In Supabase Auth, enable Email/Password.
3. Set the app/site URL to your local or production origin.
4. Configure the confirm-signup email template to use:

```text
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

5. Copy the project URL, publishable key, and pooled Postgres connection string.

## Local Start

Copy the Docker env template:

```bash
copy .env.docker.example .env
```

Fill:

```bash
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
DATABASE_URL=
BACKEND_API_KEY=
```

Then run:

```bash
docker compose build
docker compose up -d
docker compose ps
```

Open:

```text
http://localhost:8080
```

Create an accountant account from `/auth/signin`. The signup trigger creates a trial workspace automatically.

## Import Existing Local CSV Data

The repo includes a migration script for ignored/local CSV data:

```bash
python scripts/migrate_local_data_to_supabase.py --workspace-name "Demo Workspace"
```

If you already have an admin/test user, pass its user id:

```bash
python scripts/migrate_local_data_to_supabase.py --workspace-name "Demo Workspace" --owner-user-id <auth-user-uuid>
```

## Smoke Tests

```bash
curl http://localhost:8080/nginx-health
curl -i http://localhost:8080/api/v1/rucs
```

Expected:

- `nginx-health` returns `ok`.
- `/api/v1/rucs` through Nginx returns `404`, because the backend is private.
- Business data is visible only after login because Next.js forwards the Supabase token to FastAPI.

## VPS Checklist

1. Install Docker and Docker Compose.
2. Copy the repo to the VPS.
3. Copy `.env.docker.example` to `.env`.
4. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `BACKEND_API_KEY`, and `CORS_ORIGINS`.
5. Put TLS in front of Nginx.
6. Open only ports `80` and `443` in the firewall.
7. Do not expose container ports `3000` or `8000`.
8. Keep Supabase service-role/secret keys out of frontend env vars.
9. Add `XAI_API_KEY` only on the server if the AI assistant is enabled.
10. Run `docker compose up -d` and the smoke tests above.
