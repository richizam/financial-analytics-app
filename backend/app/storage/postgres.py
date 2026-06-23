from __future__ import annotations

import json
import re
import time


class DatabaseCsvStorage:
    kind = "db"

    def __init__(self, database_url: str, workspace_id: str | None = None) -> None:
        try:
            import psycopg
        except ImportError as exc:
            raise RuntimeError("Install backend/requirements.txt to use PostgreSQL storage") from exc

        self.database_url = database_url
        self.workspace_id = workspace_id
        self._psycopg = psycopg

    def for_workspace(self, workspace_id: str) -> "DatabaseCsvStorage":
        return DatabaseCsvStorage(self.database_url, workspace_id)

    def _connect(self):
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                return self._psycopg.connect(self.database_url, connect_timeout=10)
            except self._psycopg.OperationalError as exc:
                last_exc = exc
                if attempt == 2:
                    break
                time.sleep(0.5 * (attempt + 1))
        if last_exc:
            raise last_exc
        raise RuntimeError("Could not connect to database")

    def _workspace_id(self) -> str:
        if not self.workspace_id:
            raise RuntimeError("Database storage requires a workspace context")
        return self.workspace_id

    def ensure_schema(self) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select
                      to_regclass('public.workspaces') is not null
                      and to_regclass('public.workspace_members') is not null
                      and to_regclass('public.companies') is not null
                      and to_regclass('public.csv_files') is not null
                    """
                )
                ready = cur.fetchone()[0]
                if not ready:
                    raise RuntimeError(
                        "Supabase storage schema is missing. Run the auth/workspace migration first."
                    )

    def ping(self) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")

    def list_rucs(self) -> list[str]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT ruc
                    FROM public.companies
                    WHERE workspace_id = %s
                    ORDER BY ruc ASC
                    """,
                    (self._workspace_id(),),
                )
                return [row[0] for row in cur.fetchall()]

    def list_periods(self, ruc: str) -> list[str]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT filename
                    FROM public.csv_files
                    WHERE workspace_id = %s AND ruc = %s
                    ORDER BY filename ASC
                    """,
                    (self._workspace_id(), ruc),
                )
                return [
                    row[0][:-4]
                    for row in cur.fetchall()
                    if re.fullmatch(r"\d{6}\.csv", row[0], re.IGNORECASE)
                ]

    def list_files(self, ruc: str) -> list[str]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT filename
                    FROM public.csv_files
                    WHERE workspace_id = %s AND ruc = %s
                    ORDER BY filename ASC
                    """,
                    (self._workspace_id(), ruc),
                )
                files = [row[0] for row in cur.fetchall()]
                cur.execute(
                    """
                    SELECT config
                    FROM public.companies
                    WHERE workspace_id = %s AND ruc = %s
                    """,
                    (self._workspace_id(), ruc),
                )
                row = cur.fetchone()
                if row and row[0]:
                    files.append("config.json")
                return sorted(files)

    def read(self, ruc: str, filename: str) -> str | None:
        if filename.lower() == "config.json":
            return self._read_config(ruc)
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT content
                    FROM public.csv_files
                    WHERE workspace_id = %s AND ruc = %s AND filename = %s
                    """,
                    (self._workspace_id(), ruc, filename),
                )
                row = cur.fetchone()
                return row[0] if row else None

    def _read_config(self, ruc: str) -> str | None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT config
                    FROM public.companies
                    WHERE workspace_id = %s AND ruc = %s
                    """,
                    (self._workspace_id(), ruc),
                )
                row = cur.fetchone()
                if not row or not row[0]:
                    return None
                config = row[0]
                if isinstance(config, str):
                    return config
                return json.dumps(config, ensure_ascii=False)

    def upsert(self, ruc: str, filename: str, content: str) -> None:
        if filename.lower() == "config.json":
            self._upsert_config(ruc, content)
            return

        workspace_id = self._workspace_id()
        with self._connect() as conn:
            with conn.cursor() as cur:
                company_id = self._ensure_company(cur, workspace_id, ruc)
                cur.execute(
                    """
                    INSERT INTO public.csv_files (workspace_id, company_id, ruc, filename, content)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (workspace_id, ruc, filename)
                    DO UPDATE SET
                      company_id = EXCLUDED.company_id,
                      content = EXCLUDED.content,
                      updated_at = NOW()
                    """,
                    (workspace_id, company_id, ruc, filename, content),
                )

    def _upsert_config(self, ruc: str, content: str) -> None:
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        razon_social = parsed.get("razonSocial")
        sector = parsed.get("sector")
        workspace_id = self._workspace_id()
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.companies (workspace_id, ruc, razon_social, sector, config)
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (workspace_id, ruc)
                    DO UPDATE SET
                      razon_social = COALESCE(EXCLUDED.razon_social, public.companies.razon_social),
                      sector = COALESCE(EXCLUDED.sector, public.companies.sector),
                      config = EXCLUDED.config,
                      updated_at = NOW()
                    """,
                    (workspace_id, ruc, razon_social, sector, json.dumps(parsed)),
                )

    def _ensure_company(self, cur, workspace_id: str, ruc: str) -> str:
        cur.execute(
            """
            INSERT INTO public.companies (workspace_id, ruc)
            VALUES (%s, %s)
            ON CONFLICT (workspace_id, ruc)
            DO UPDATE SET updated_at = public.companies.updated_at
            RETURNING id::text
            """,
            (workspace_id, ruc),
        )
        return str(cur.fetchone()[0])
