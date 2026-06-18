# Local Docker and VPS Runbook

This stack runs the app the same way it should be shaped on a VPS:

```text
Browser -> Nginx :8080 -> Next.js :3000 -> FastAPI :8000 -> Postgres :5432
```

Only Nginx is published to the host. FastAPI and Postgres stay private on the Docker network.

The Grok integration also stays server-side:

```text
Browser -> Next.js Server Action -> FastAPI /api/v1/ai/* -> xAI API
```

`XAI_API_KEY` must never be exposed as a `NEXT_PUBLIC_*` variable.

## Local Start

```bash
docker compose build
docker compose up -d
docker compose ps
```

Open:

```text
http://localhost:8080
```

Local demo login:

```text
user: demo
password: demo1234
```

The default compose values are intentionally local-only. For VPS or shared environments, copy `.env.docker.example` to `.env` and replace every secret.

If you want to test Grok locally, set these in `.env`:

```bash
XAI_API_KEY=your-server-side-xai-key
XAI_BASE_URL=https://api.x.ai/v1
XAI_MODEL=grok-4.3
```

## Optional Seed From Local CSV Files

If you have local ignored data in `data/empresas`, import it into the containerized Postgres:

```bash
docker compose cp data/empresas backend:/tmp/empresas
docker compose exec backend python -c "from pathlib import Path; from backend.app.core.config import get_settings; from backend.app.storage import create_storage; s=create_storage(get_settings()); n=0
for ruc_dir in Path('/tmp/empresas').iterdir():
    if not ruc_dir.is_dir():
        continue
    for p in ruc_dir.iterdir():
        if p.is_file() and (p.suffix.lower()=='.csv' or p.name=='config.json'):
            s.upsert(ruc_dir.name, p.name, p.read_text(encoding='utf-8-sig'))
            n += 1
print(n)"
```

Check imported RUCs:

```bash
docker compose exec backend python -c "from backend.app.core.config import get_settings; from backend.app.storage import create_storage; s=create_storage(get_settings()); print({r: len(s.list_periods(r)) for r in s.list_rucs()})"
```

## Smoke Tests

```bash
curl http://localhost:8080/nginx-health
curl -i http://localhost:8080/api/v1/rucs
docker compose exec backend python -c "import urllib.request, urllib.error; code='unexpected'
try:
    urllib.request.urlopen('http://127.0.0.1:8000/api/v1/rucs', timeout=5)
except urllib.error.HTTPError as e:
    code=e.code
print(code)"
```

Expected:

- `nginx-health` returns `ok`.
- `/api/v1/rucs` through Nginx returns `404`, because the backend is private.
- Internal backend call without `X-Backend-Api-Key` returns `401`.

## VPS Checklist

1. Install Docker and Docker Compose.
2. Copy the repo to the VPS.
3. Copy `.env.docker.example` to `.env`.
4. Replace `POSTGRES_PASSWORD`, `BACKEND_API_KEY`, `NEXTAUTH_SECRET`, `DEMO_PASSWORD`, and `NEXTAUTH_URL`.
5. Set `NEXTAUTH_URL` and `CORS_ORIGINS` to your real HTTPS domain.
6. Put TLS in front of Nginx, either directly in Nginx or with a host-level reverse proxy.
7. Open only ports `80` and `443` in the firewall.
8. Do not expose container ports `3000`, `8000`, or `5432`.
9. Configure Postgres backups and test restore before production data matters.
10. Add `XAI_API_KEY` only on the server if the AI assistant is enabled.
11. Run `docker compose up -d` and the smoke tests above.
