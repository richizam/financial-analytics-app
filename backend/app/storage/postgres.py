from __future__ import annotations

import json
import re
import time
from typing import Any


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
                      and to_regclass('public.csv_imports') is not null
                      and to_regclass('public.journal_entries') is not null
                      and to_regclass('public.opening_balances') is not null
                      and to_regclass('public.account_period_balances') is not null
                      and to_regclass('public.analysis_cache') is not null
                    """
                )
                ready = cur.fetchone()[0]
                if not ready:
                    raise RuntimeError(
                        "Supabase storage schema is missing. Run the auth/workspace and normalized data migrations first."
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
                    SELECT period
                    FROM (
                      SELECT substring(filename from 1 for 6) AS period
                      FROM public.csv_files
                      WHERE workspace_id = %s AND ruc = %s AND filename ~* '^[0-9]{6}[.]csv$'
                      UNION
                      SELECT period
                      FROM public.journal_entries
                      WHERE workspace_id = %s AND ruc = %s
                    ) periods
                    WHERE period ~ '^[0-9]{6}$'
                    ORDER BY period ASC
                    """,
                    (self._workspace_id(), ruc, self._workspace_id(), ruc),
                )
                return [row[0] for row in cur.fetchall()]

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
                self._upsert_raw_file(cur, workspace_id, ruc, filename, content)

    def upsert_journal_import(
        self,
        ruc: str,
        filename: str,
        content: str,
        entries: list[dict[str, Any]],
        aggregates: list[dict[str, Any]],
        meta: dict[str, Any],
    ) -> None:
        period = filename[:6]
        workspace_id = self._workspace_id()
        with self._connect() as conn:
            with conn.cursor() as cur:
                company_id, file_id = self._upsert_raw_file(cur, workspace_id, ruc, filename, content)
                import_id = self._upsert_import(
                    cur,
                    workspace_id,
                    company_id,
                    file_id,
                    ruc,
                    filename,
                    period,
                    "journal",
                    meta,
                )

                cur.execute(
                    """
                    DELETE FROM public.journal_entries
                    WHERE workspace_id = %s AND ruc = %s AND period = %s
                    """,
                    (workspace_id, ruc, period),
                )
                cur.execute(
                    """
                    DELETE FROM public.account_period_balances
                    WHERE workspace_id = %s AND ruc = %s AND period = %s
                    """,
                    (workspace_id, ruc, period),
                )

                if entries:
                    cur.executemany(
                        """
                        INSERT INTO public.journal_entries (
                          workspace_id, company_id, source_file_id, import_id,
                          ruc, period, row_number, fecha, asiento, tipo,
                          cod_cuenta, nombre_cuenta, descripcion,
                          debe_cents, haber_cents, centro_costo,
                          document_number, currency, raw_row
                        )
                        VALUES (
                          %s, %s, %s, %s,
                          %s, %s, %s, %s, %s, %s,
                          %s, %s, %s,
                          %s, %s, %s,
                          %s, %s, %s::jsonb
                        )
                        """,
                        [
                            (
                                workspace_id,
                                company_id,
                                file_id,
                                import_id,
                                ruc,
                                entry.get("periodo") or period,
                                int(entry.get("rowNumber") or index),
                                entry["fecha"],
                                entry.get("asiento", ""),
                                entry.get("tipo", ""),
                                entry.get("codCuenta", ""),
                                entry.get("nombreCuenta", ""),
                                entry.get("descripcion", ""),
                                int(entry.get("debe", 0)),
                                int(entry.get("haber", 0)),
                                entry.get("centroCosto", ""),
                                entry.get("documentNumber"),
                                entry.get("currency"),
                                json.dumps(entry.get("rawRow", {}), ensure_ascii=False),
                            )
                            for index, entry in enumerate(entries, start=1)
                        ],
                    )
                self._upsert_account_period_balances(cur, workspace_id, company_id, ruc, aggregates)
                self._invalidate_analysis_cache_cur(cur, workspace_id, ruc)

    def upsert_opening_balance_import(
        self,
        ruc: str,
        filename: str,
        content: str,
        balances: list[dict[str, Any]],
        meta: dict[str, Any],
    ) -> None:
        match = re.fullmatch(r"saldos_iniciales_(\d{4})\.csv", filename, re.IGNORECASE)
        if not match:
            raise ValueError("Invalid opening balance filename")
        year = int(match.group(1))
        workspace_id = self._workspace_id()
        with self._connect() as conn:
            with conn.cursor() as cur:
                company_id, file_id = self._upsert_raw_file(cur, workspace_id, ruc, filename, content)
                import_id = self._upsert_import(
                    cur,
                    workspace_id,
                    company_id,
                    file_id,
                    ruc,
                    filename,
                    None,
                    "opening_balance",
                    meta,
                )
                cur.execute(
                    """
                    DELETE FROM public.opening_balances
                    WHERE workspace_id = %s AND ruc = %s AND year = %s
                    """,
                    (workspace_id, ruc, year),
                )
                if balances:
                    cur.executemany(
                        """
                        INSERT INTO public.opening_balances (
                          workspace_id, company_id, source_file_id, import_id,
                          ruc, year, cod_cuenta, nombre_cuenta, saldo_cents, tipo, raw_row
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                        """,
                        [
                            (
                                workspace_id,
                                company_id,
                                file_id,
                                import_id,
                                ruc,
                                year,
                                balance.get("codCuenta", ""),
                                balance.get("nombreCuenta", ""),
                                int(balance.get("saldo", 0)),
                                balance.get("tipo", ""),
                                json.dumps(balance.get("rawRow", {}), ensure_ascii=False),
                            )
                            for balance in balances
                        ],
                    )
                self._invalidate_analysis_cache_cur(cur, workspace_id, ruc)

    def get_journal_entries(self, ruc: str, periodos: list[str]) -> tuple[list[dict[str, Any]], set[str]]:
        if not periodos:
            return [], set()
        workspace_id = self._workspace_id()
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      period, row_number, fecha::text, asiento, tipo,
                      cod_cuenta, nombre_cuenta, descripcion,
                      debe_cents, haber_cents, centro_costo,
                      document_number, currency, raw_row
                    FROM public.journal_entries
                    WHERE workspace_id = %s AND ruc = %s AND period = ANY(%s)
                    ORDER BY period ASC, fecha ASC, asiento ASC, row_number ASC
                    """,
                    (workspace_id, ruc, periodos),
                )
                rows = cur.fetchall()
        entries = [
            {
                "fecha": row[2],
                "asiento": row[3],
                "tipo": row[4],
                "codCuenta": row[5],
                "nombreCuenta": row[6],
                "descripcion": row[7],
                "debe": int(row[8]),
                "haber": int(row[9]),
                "centroCosto": row[10],
                "periodo": row[0],
                "rowNumber": row[1],
                "documentNumber": row[11],
                "currency": row[12],
                "rawRow": row[13] or {},
            }
            for row in rows
        ]
        return entries, {entry["periodo"] for entry in entries}

    def get_opening_balances(self, ruc: str, year: int) -> dict[str, dict[str, Any]] | None:
        workspace_id = self._workspace_id()
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT cod_cuenta, nombre_cuenta, saldo_cents
                    FROM public.opening_balances
                    WHERE workspace_id = %s AND ruc = %s AND year = %s
                    ORDER BY cod_cuenta ASC
                    """,
                    (workspace_id, ruc, year),
                )
                rows = cur.fetchall()
        if not rows:
            return None
        return {
            row[0]: {
                "codCuenta": row[0],
                "nombreCuenta": row[1],
                "totalDebe": int(row[2]) if int(row[2]) > 0 else 0,
                "totalHaber": -int(row[2]) if int(row[2]) < 0 else 0,
                "saldo": int(row[2]),
            }
            for row in rows
        }

    def get_analysis_cache(self, ruc: str, analysis_type: str, period_key: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM public.analysis_cache
                    WHERE workspace_id = %s
                      AND ruc = %s
                      AND analysis_type = %s
                      AND period_key = %s
                      AND cache_version = 1
                    """,
                    (self._workspace_id(), ruc, analysis_type, period_key),
                )
                row = cur.fetchone()
        payload = row[0] if row else None
        return payload if isinstance(payload, dict) else None

    def set_analysis_cache(self, ruc: str, analysis_type: str, period_key: str, payload: dict[str, Any]) -> None:
        workspace_id = self._workspace_id()
        with self._connect() as conn:
            with conn.cursor() as cur:
                company_id = self._ensure_company(cur, workspace_id, ruc)
                cur.execute(
                    """
                    INSERT INTO public.analysis_cache (
                      workspace_id, company_id, ruc, analysis_type, period_key, cache_version, payload
                    )
                    VALUES (%s, %s, %s, %s, %s, 1, %s::jsonb)
                    ON CONFLICT (workspace_id, ruc, analysis_type, period_key, cache_version)
                    DO UPDATE SET
                      company_id = EXCLUDED.company_id,
                      payload = EXCLUDED.payload,
                      updated_at = NOW()
                    """,
                    (workspace_id, company_id, ruc, analysis_type, period_key, json.dumps(payload, ensure_ascii=False)),
                )

    def invalidate_analysis_cache(self, ruc: str) -> None:
        workspace_id = self._workspace_id()
        with self._connect() as conn:
            with conn.cursor() as cur:
                self._invalidate_analysis_cache_cur(cur, workspace_id, ruc)

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

    def _upsert_raw_file(self, cur, workspace_id: str, ruc: str, filename: str, content: str) -> tuple[str, str]:
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
            RETURNING company_id::text, id::text
            """,
            (workspace_id, company_id, ruc, filename, content),
        )
        row = cur.fetchone()
        return str(row[0]), str(row[1])

    def _upsert_import(
        self,
        cur,
        workspace_id: str,
        company_id: str,
        file_id: str,
        ruc: str,
        filename: str,
        period: str | None,
        import_type: str,
        meta: dict[str, Any],
    ) -> str:
        cur.execute(
            """
            INSERT INTO public.csv_imports (
              workspace_id, company_id, source_file_id, ruc, filename, period,
              import_type, status, provider, mapping, confidence, row_count, error_count, warnings
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'succeeded', %s, %s::jsonb, %s, %s, %s, %s::jsonb)
            ON CONFLICT (workspace_id, ruc, filename)
            DO UPDATE SET
              company_id = EXCLUDED.company_id,
              source_file_id = EXCLUDED.source_file_id,
              period = EXCLUDED.period,
              import_type = EXCLUDED.import_type,
              status = EXCLUDED.status,
              provider = EXCLUDED.provider,
              mapping = EXCLUDED.mapping,
              confidence = EXCLUDED.confidence,
              row_count = EXCLUDED.row_count,
              error_count = EXCLUDED.error_count,
              warnings = EXCLUDED.warnings,
              updated_at = NOW()
            RETURNING id::text
            """,
            (
                workspace_id,
                company_id,
                file_id,
                ruc,
                filename,
                period,
                import_type,
                meta.get("provider", "canonical"),
                json.dumps(meta.get("mapping", {}), ensure_ascii=False),
                float(meta.get("confidence", 1)),
                int(meta.get("row_count", 0)),
                int(meta.get("error_count", 0)),
                json.dumps(meta.get("warnings", []), ensure_ascii=False),
            ),
        )
        return str(cur.fetchone()[0])

    def _upsert_account_period_balances(
        self,
        cur,
        workspace_id: str,
        company_id: str,
        ruc: str,
        aggregates: list[dict[str, Any]],
    ) -> None:
        # Aggregates are computed in the domain layer (aggregation.py); storage
        # only persists the precomputed per-account-period rows.
        if not aggregates:
            return

        cur.executemany(
            """
            INSERT INTO public.account_period_balances (
              workspace_id, company_id, ruc, period, cod_cuenta, nombre_cuenta,
              total_debe_cents, total_haber_cents, saldo_cents, entry_count
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (workspace_id, ruc, period, cod_cuenta)
            DO UPDATE SET
              company_id = EXCLUDED.company_id,
              nombre_cuenta = EXCLUDED.nombre_cuenta,
              total_debe_cents = EXCLUDED.total_debe_cents,
              total_haber_cents = EXCLUDED.total_haber_cents,
              saldo_cents = EXCLUDED.saldo_cents,
              entry_count = EXCLUDED.entry_count,
              updated_at = NOW()
            """,
            [
                (
                    workspace_id,
                    company_id,
                    ruc,
                    item["period"],
                    item["codCuenta"],
                    item["nombreCuenta"],
                    int(item["totalDebe"]),
                    int(item["totalHaber"]),
                    int(item["saldo"]),
                    int(item["entryCount"]),
                )
                for item in aggregates
            ],
        )

    def _invalidate_analysis_cache_cur(self, cur, workspace_id: str, ruc: str) -> None:
        cur.execute(
            """
            DELETE FROM public.analysis_cache
            WHERE workspace_id = %s AND ruc = %s
            """,
            (workspace_id, ruc),
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
