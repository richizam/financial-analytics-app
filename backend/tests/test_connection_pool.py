"""Tests for the shared DB connection pool behaviour.

Covers:
1. Read queries borrow from the shared pool (no fresh psycopg connection per query).
2. The pool is configured for autocommit reads (no extra COMMIT round-trip).
3. Write methods wrap their statements in an explicit transaction.
4. A stale/dropped pooled connection is recovered instead of returning a 503.
5. The auth/security workspace lookup uses the same pooled behaviour.

All tests fake the pool/connection so they never touch a real database.
"""
from __future__ import annotations

import contextvars

import psycopg
import psycopg_pool
import pytest

from backend.app.core import security
from backend.app.storage import postgres as pg
from backend.app.storage.postgres import DatabaseCsvStorage


# --- Fakes -------------------------------------------------------------------

class FakeCursor:
    def __init__(self, rows=None, fail=False):
        self.rows = list(rows) if rows is not None else []
        self.fail = fail
        self.executed: list = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        if self.fail:
            raise psycopg.OperationalError("SSL error: unexpected eof while reading")
        self.executed.append((sql, params))

    def executemany(self, sql, seq):
        self.executed.append((sql, list(seq)))

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)


class FakeTransaction:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        self.conn.transaction_entered = True
        return self

    def __exit__(self, *exc):
        return False


class FakeConn:
    def __init__(self, rows=None, fail=False):
        self._cursor = FakeCursor(rows=rows, fail=fail)
        self.transaction_entered = False

    def cursor(self):
        return self._cursor

    def transaction(self):
        return FakeTransaction(self)


class _BorrowCtx:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, *exc):
        return False


class FakePool:
    """Hands out a sequence of connections and counts borrows."""

    def __init__(self, conns):
        self._conns = list(conns)
        self.borrows = 0

    def connection(self):
        conn = self._conns[min(self.borrows, len(self._conns) - 1)]
        self.borrows += 1
        return _BorrowCtx(conn)


@pytest.fixture(autouse=True)
def _clear_pool_registry():
    # Guard against any real pool leaking between tests.
    pg._POOLS.clear()
    yield
    pg._POOLS.clear()


# --- 1. Reads borrow from the shared pool ------------------------------------

def test_get_pool_is_shared_per_dsn(monkeypatch):
    created: list = []

    class FakeConnectionPool:
        def __init__(self, **kwargs):
            created.append(kwargs)

        def open(self):
            pass

        @staticmethod
        def check_connection(conn):
            pass

    monkeypatch.setattr(psycopg_pool, "ConnectionPool", FakeConnectionPool)

    p1 = pg.get_pool("postgresql://a")
    p2 = pg.get_pool("postgresql://a")
    p3 = pg.get_pool("postgresql://b")

    assert p1 is p2            # same DSN -> one shared pool, not a new connection per call
    assert p1 is not p3
    assert len(created) == 2   # one per distinct DSN


def test_read_method_borrows_from_pool_not_a_fresh_connection(monkeypatch):
    conn = FakeConn(rows=[("0990000000001",), ("0992222222001",)])
    pool = FakePool([conn])
    monkeypatch.setattr(pg, "get_pool", lambda dsn: pool)
    # Hard-fail if anything tries to open a brand-new connection per query.
    monkeypatch.setattr(
        psycopg, "connect",
        lambda *a, **k: pytest.fail("read opened a fresh psycopg connection instead of using the pool"),
    )

    storage = DatabaseCsvStorage("postgresql://x", workspace_id="ws-1")
    assert storage.list_rucs() == ["0990000000001", "0992222222001"]
    assert pool.borrows == 1


# --- 2. Reads run with autocommit (no extra COMMIT round-trip) ----------------

def test_pool_configured_for_autocommit_and_stale_check(monkeypatch):
    captured: dict = {}

    class FakeConnectionPool:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def open(self):
            pass

        @staticmethod
        def check_connection(conn):
            pass

    monkeypatch.setattr(psycopg_pool, "ConnectionPool", FakeConnectionPool)

    pg.get_pool("postgresql://x")

    conn_kwargs = captured["kwargs"]
    assert conn_kwargs["autocommit"] is True             # reads avoid the trailing COMMIT
    assert conn_kwargs["prepare_threshold"] is None       # safe for the transaction pooler
    assert conn_kwargs.get("keepalives") == 1             # detect dropped connections
    # Stale-connection protection is wired and recycling is configured.
    assert captured["check"] is FakeConnectionPool.check_connection
    assert captured["max_lifetime"]
    assert captured["max_idle"]


# --- 3. Writes use an explicit transaction; reads do not ---------------------

def test_write_method_uses_explicit_transaction(monkeypatch):
    conn = FakeConn(rows=[("company-1",)])  # _ensure_company RETURNING id
    monkeypatch.setattr(pg, "get_pool", lambda dsn: FakePool([conn]))

    storage = DatabaseCsvStorage("postgresql://x", workspace_id="ws-1")
    storage.set_analysis_cache("0990000000001", "dashboard", "2025", {"k": 1})

    assert conn.transaction_entered is True
    # Two statements ran atomically: ensure-company + the cache upsert.
    assert len(conn._cursor.executed) == 2


def test_read_method_does_not_open_a_transaction(monkeypatch):
    conn = FakeConn(rows=[("0990000000001",)])
    monkeypatch.setattr(pg, "get_pool", lambda dsn: FakePool([conn]))

    storage = DatabaseCsvStorage("postgresql://x", workspace_id="ws-1")
    storage.list_rucs()

    assert conn.transaction_entered is False


# --- 4. Stale/dropped connection is recovered, not surfaced as a 503 ----------

def test_workspace_lookup_recovers_from_dropped_connection(monkeypatch):
    dead = FakeConn(fail=True)                       # first borrow: query raises SSL-eof
    alive = FakeConn(rows=[("workspace-1", "owner")])  # retry succeeds
    pool = FakePool([dead, alive])
    monkeypatch.setattr(pg, "get_pool", lambda dsn: pool)

    row = security._fetch_active_workspace_row("postgresql://x", "user-1")

    assert row == ("workspace-1", "owner")
    assert pool.borrows == 2  # failed once, retried with a fresh connection


def test_non_connection_error_is_not_retried(monkeypatch):
    class AuthFailCursor(FakeCursor):
        def execute(self, sql, params=None):
            raise psycopg.OperationalError("password authentication failed for user")

    conn = FakeConn()
    conn._cursor = AuthFailCursor()
    pool = FakePool([conn])
    monkeypatch.setattr(pg, "get_pool", lambda dsn: pool)

    with pytest.raises(psycopg.OperationalError):
        security._fetch_active_workspace_row("postgresql://x", "user-1")
    assert pool.borrows == 1  # a real error is not mistaken for a dropped connection


# --- 5. Auth/security flow uses the pooled behaviour -------------------------

def test_resolve_active_workspace_uses_pool_and_returns_role(monkeypatch):
    pool = FakePool([FakeConn(rows=[("workspace-9", "admin")])])
    monkeypatch.setattr(pg, "get_pool", lambda dsn: pool)
    monkeypatch.setattr(
        security, "get_settings",
        lambda: type("S", (), {"database_url": "postgresql://x"})(),
    )

    assert security._resolve_active_workspace_for_user("user-1") == ("workspace-9", "admin")
    assert pool.borrows == 1


def test_resolve_active_workspace_persistent_failure_is_503(monkeypatch):
    from fastapi import HTTPException

    class DownCursor(FakeCursor):
        def execute(self, sql, params=None):
            raise psycopg.OperationalError("server closed the connection unexpectedly")

    conn = FakeConn()
    conn._cursor = DownCursor()
    monkeypatch.setattr(pg, "get_pool", lambda dsn: FakePool([conn]))
    monkeypatch.setattr(
        security, "get_settings",
        lambda: type("S", (), {"database_url": "postgresql://x"})(),
    )

    with pytest.raises(HTTPException) as excinfo:
        security._resolve_active_workspace_for_user("user-1")
    assert excinfo.value.status_code == 503


# --- Request-scoped connection reuse -----------------------------------------

class RecordingBorrowCtx:
    def __init__(self, conn, pool):
        self.conn = conn
        self.pool = pool
        self.exited = False

    def __enter__(self):
        self.pool.checks += 1  # the pool's check runs when a connection is borrowed
        return self.conn

    def __exit__(self, *exc):
        self.exited = True
        self.pool.returned += 1
        return False


class RecordingPool:
    def __init__(self, conns):
        self._conns = list(conns)
        self.borrows = 0
        self.checks = 0
        self.returned = 0

    def connection(self):
        conn = self._conns[min(self.borrows, len(self._conns) - 1)]
        self.borrows += 1
        return RecordingBorrowCtx(conn, self)


def test_request_scope_borrows_and_checks_once_for_multiple_reads(monkeypatch):
    conn = FakeConn(rows=[("0990000000001",)])
    pool = RecordingPool([conn])
    monkeypatch.setattr(pg, "get_pool", lambda dsn: pool)

    holder, token = pg.open_request_connection("postgresql://x")
    try:
        storage = DatabaseCsvStorage("postgresql://x", workspace_id="ws-1")
        storage.list_rucs()
        storage.list_rucs()
        storage.list_rucs()
        assert pool.borrows == 1   # one connection for the whole request
        assert pool.checks == 1    # validated once, not once per query
        assert pool.returned == 0  # still held while the request is open
    finally:
        pg.close_request_connection(holder, token)

    assert pool.returned == 1       # connection returned to the pool after the request


def test_request_scope_write_still_uses_transaction(monkeypatch):
    conn = FakeConn(rows=[("company-1",)])
    pool = RecordingPool([conn])
    monkeypatch.setattr(pg, "get_pool", lambda dsn: pool)

    holder, token = pg.open_request_connection("postgresql://x")
    try:
        storage = DatabaseCsvStorage("postgresql://x", workspace_id="ws-1")
        storage.set_analysis_cache("0990000000001", "dashboard", "2025", {"k": 1})
        assert conn.transaction_entered is True
        assert pool.borrows == 1
    finally:
        pg.close_request_connection(holder, token)

    assert pool.returned == 1


def test_request_scope_recovers_from_dropped_connection(monkeypatch):
    dead = FakeConn(fail=True)
    alive = FakeConn(rows=[("workspace-1", "owner")])
    pool = RecordingPool([dead, alive])
    monkeypatch.setattr(pg, "get_pool", lambda dsn: pool)

    holder, token = pg.open_request_connection("postgresql://x")
    try:
        row = security._fetch_active_workspace_row("postgresql://x", "user-1")
        assert row == ("workspace-1", "owner")
        # First borrow was dead -> discarded and returned; a fresh one was borrowed.
        assert pool.borrows == 2
    finally:
        pg.close_request_connection(holder, token)

    # Every borrowed connection (dead + alive) ends up returned to the pool.
    assert pool.returned == 2


def test_request_connection_is_isolated_per_context():
    assert pg._request_conn.get() is None
    seen: dict = {}

    def run(name):
        holder, token = pg.open_request_connection(f"postgresql://{name}")
        seen[name] = pg._request_conn.get()
        pg.close_request_connection(holder, token)
        seen[name + "_after"] = pg._request_conn.get()

    contextvars.copy_context().run(run, "a")
    contextvars.copy_context().run(run, "b")

    assert seen["a"] is not None and seen["b"] is not None
    assert seen["a"] is not seen["b"]      # each request/context gets its own connection holder
    assert seen["a_after"] is None         # scope cleared on close
    assert pg._request_conn.get() is None  # never leaked into the surrounding context

