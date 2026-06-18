from __future__ import annotations

import re
import uuid


class DatabaseCsvStorage:
    kind = "db"

    def __init__(self, database_url: str) -> None:
        try:
            import psycopg
        except ImportError as exc:
            raise RuntimeError("Install backend/requirements.txt to use PostgreSQL storage") from exc

        self.database_url = database_url
        self._psycopg = psycopg

    def _connect(self):
        return self._psycopg.connect(self.database_url)

    def ensure_schema(self) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS "CsvFile" (
                      id text PRIMARY KEY,
                      ruc text NOT NULL,
                      filename text NOT NULL,
                      content text NOT NULL,
                      "createdAt" timestamptz NOT NULL DEFAULT NOW(),
                      "updatedAt" timestamptz NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS "CsvFile_ruc_filename_key"
                    ON "CsvFile" (ruc, filename)
                    """
                )

    def ping(self) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")

    def list_rucs(self) -> list[str]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT DISTINCT ruc FROM "CsvFile" ORDER BY ruc ASC')
                return [row[0] for row in cur.fetchall()]

    def list_periods(self, ruc: str) -> list[str]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT filename FROM "CsvFile" WHERE ruc = %s ORDER BY filename ASC',
                    (ruc,),
                )
                return [
                    row[0][:-4]
                    for row in cur.fetchall()
                    if re.fullmatch(r"\d{6}\.csv", row[0], re.IGNORECASE)
                ]

    def read(self, ruc: str, filename: str) -> str | None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT content FROM "CsvFile" WHERE ruc = %s AND filename = %s',
                    (ruc, filename),
                )
                row = cur.fetchone()
                return row[0] if row else None

    def upsert(self, ruc: str, filename: str, content: str) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO "CsvFile" (id, ruc, filename, content, "createdAt", "updatedAt")
                    VALUES (%s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT (ruc, filename)
                    DO UPDATE SET content = EXCLUDED.content, "updatedAt" = NOW()
                    """,
                    (uuid.uuid4().hex, ruc, filename, content),
                )
