from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import psycopg


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def upsert_company(cur, workspace_id: str, ruc: str, config: dict[str, object]) -> str:
    cur.execute(
        """
        insert into public.companies (workspace_id, ruc, razon_social, sector, config)
        values (%s, %s, %s, %s, %s::jsonb)
        on conflict (workspace_id, ruc)
        do update set
          razon_social = coalesce(excluded.razon_social, public.companies.razon_social),
          sector = coalesce(excluded.sector, public.companies.sector),
          config = excluded.config,
          updated_at = now()
        returning id::text
        """,
        (
            workspace_id,
            ruc,
            config.get("razonSocial"),
            config.get("sector"),
            json.dumps(config),
        ),
    )
    return str(cur.fetchone()[0])


def main() -> None:
    parser = argparse.ArgumentParser(description="Import local data/empresas CSV data into Supabase storage tables.")
    parser.add_argument("--data-root", default="data/empresas")
    parser.add_argument("--workspace-name", default="Demo Workspace")
    parser.add_argument("--workspace-id", default=None)
    parser.add_argument("--owner-user-id", default=None)
    args = parser.parse_args()

    load_dotenv(Path(".env"))
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")

    data_root = Path(args.data_root)
    if not data_root.exists():
        raise SystemExit(f"{data_root} does not exist")

    imported = 0
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            if args.workspace_id:
                workspace_id = args.workspace_id
            else:
                cur.execute(
                    """
                    insert into public.workspaces (name, status, created_by)
                    values (%s, 'trialing', %s)
                    returning id::text
                    """,
                    (args.workspace_name, args.owner_user_id),
                )
                workspace_id = str(cur.fetchone()[0])

            if args.owner_user_id:
                cur.execute(
                    """
                    insert into public.workspace_members (workspace_id, user_id, role)
                    values (%s, %s, 'owner')
                    on conflict (workspace_id, user_id) do nothing
                    """,
                    (workspace_id, args.owner_user_id),
                )

            for ruc_dir in sorted(data_root.iterdir()):
                if not ruc_dir.is_dir():
                    continue
                ruc = ruc_dir.name
                config_path = ruc_dir / "config.json"
                config: dict[str, object] = {"ruc": ruc}
                if config_path.exists():
                    try:
                        parsed = json.loads(config_path.read_text(encoding="utf-8-sig"))
                        if isinstance(parsed, dict):
                            config.update(parsed)
                    except json.JSONDecodeError:
                        pass

                company_id = upsert_company(cur, workspace_id, ruc, config)
                for file_path in sorted(ruc_dir.glob("*.csv")):
                    cur.execute(
                        """
                        insert into public.csv_files (workspace_id, company_id, ruc, filename, content)
                        values (%s, %s, %s, %s, %s)
                        on conflict (workspace_id, ruc, filename)
                        do update set
                          company_id = excluded.company_id,
                          content = excluded.content,
                          updated_at = now()
                        """,
                        (
                            workspace_id,
                            company_id,
                            ruc,
                            file_path.name,
                            file_path.read_text(encoding="utf-8-sig"),
                        ),
                    )
                    imported += 1

    print(f"Imported {imported} CSV files into workspace {workspace_id}.")
    if not args.owner_user_id:
        print("No owner was assigned. Add a workspace_members row manually after your admin/test user signs up.")


if __name__ == "__main__":
    main()
