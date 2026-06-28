from __future__ import annotations

import inspect

from backend.app.storage.postgres import DatabaseCsvStorage


def test_company_metadata_queries_do_not_scan_raw_journal_entries():
    overview_source = inspect.getsource(DatabaseCsvStorage.list_company_overviews)
    periods_source = inspect.getsource(DatabaseCsvStorage.list_periods)

    assert "public.journal_entries" not in overview_source
    assert "public.journal_entries" not in periods_source
    assert "public.csv_imports" in overview_source
    assert "public.account_period_balances" in overview_source
    assert "public.csv_imports" in periods_source
    assert "public.account_period_balances" in periods_source
