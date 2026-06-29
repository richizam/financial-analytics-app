from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"


def _migration_sql() -> str:
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(MIGRATIONS.glob("*.sql"))
    ).lower()


def test_every_public_table_created_by_migrations_has_rls_and_policy():
    sql = _migration_sql()
    tables = set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.([a-z_][a-z0-9_]*)", sql))

    assert tables
    for table in tables:
        assert f"alter table public.{table} enable row level security;" in sql
        assert re.search(rf"create\s+policy\s+\"[^\"]+\"\s+on\s+public\.{table}\b", sql)


def test_migrations_do_not_use_deprecated_or_public_bypass_patterns():
    sql = _migration_sql()

    assert "auth.role(" not in sql
    assert "service_role" not in sql
    assert "create view" not in sql
    assert "grant all" not in sql
    assert " to anon" not in sql
    assert " to public" not in sql


def test_authenticated_policies_are_scoped_to_user_or_workspace():
    sql = _migration_sql()
    policies = re.findall(r"create\s+policy\s+\"[^\"]+\".*?;", sql, flags=re.DOTALL)

    assert policies
    for policy in policies:
        if " to authenticated" not in policy:
            continue

        has_using = " using (" in policy
        has_check = " with check (" in policy
        assert has_using or has_check, policy
        assert "using (true)" not in policy
        assert "with check (true)" not in policy

        authz_terms = [
            "auth.uid()",
            "app_private.is_workspace_member(",
            "app_private.can_write_workspace(",
            "app_private.can_manage_workspace_members(",
            "app_private.is_platform_admin()",
        ]
        assert any(term in policy for term in authz_terms), policy

        if " for update" in policy:
            assert has_using and has_check, policy
        elif " for insert" in policy:
            assert has_check, policy
        elif " for select" in policy or " for delete" in policy:
            assert has_using, policy


def test_security_definer_functions_are_kept_out_of_public_schema():
    sql = _migration_sql()
    function_blocks = re.findall(
        r"(create\s+or\s+replace\s+function\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\(.*?\$\$;)",
        sql,
        flags=re.DOTALL,
    )
    security_definers = [
        (schema, name, block)
        for block, schema, name in function_blocks
        if "security definer" in block
    ]

    assert security_definers
    for schema, _name, block in security_definers:
        assert schema == "app_private"
        assert "set search_path = ''" in block
