"""Shared throwaway-PostgreSQL fixtures for the integration tests.

Several integration tests need a REAL PostgreSQL: FK cascades, pgvector, JSON
casts and alembic migrations cannot be reproduced by fake sessions or SQLite.
Each of them gets its own uniquely named database, created for the test and
always dropped afterwards, so a test can never touch the developer's database
(the ``DATABASE_URL`` of ``.env``) nor another test's data.

Where the server comes from:

* ``TEST_PG_ADMIN_URL`` (e.g. ``postgresql://postgres:postgres@localhost:5432/postgres``)
  — the URL of a maintenance database on a server where that role may
  ``CREATE DATABASE``. CI sets it (``pgvector/pgvector:pg17`` service). When it
  is set the server is REQUIRED: an unreachable server fails the tests instead
  of skipping them, so a broken CI service cannot turn the suite silently green.
* otherwise the local unix socket (``/var/run/postgresql``, peer auth as the
  current OS user) — the developer setup. Tests are skipped, with the reason,
  when it is not reachable.

The server must provide the pgvector extension (``ocr_blocks`` needs it).

Fixtures:

* ``pg_server``   — session-scoped: the reachable server (or skip/fail);
* ``throwaway_pg`` — an EMPTY database (no extension, no table), e.g. for
  migrations;
* ``pg_schema_db`` — the same with pgvector enabled and the full SQLAlchemy
  schema created (``Base.metadata.create_all``);
* ``migrated_pg`` — the same after ``alembic upgrade head``: the production
  schema, including the Prisma-owned tables (Better Auth, ``user_signatures``…)
  that have no SQLAlchemy model.
"""

from __future__ import annotations

import getpass
import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

ADMIN_URL_ENV = "TEST_PG_ADMIN_URL"
_SOCKET_DIR = "/var/run/postgresql"
PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class SqlResult:
    """Outcome of :meth:`ThrowawayDatabase.psql` (``psql -tAq``-shaped)."""

    returncode: int
    stdout: str
    stderr: str


def _format_value(value: object) -> str:
    """Render a value the way ``psql -tA`` prints it."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "t" if value else "f"
    return str(value)


def run_sql(dsn: str, sql: str) -> SqlResult:
    """Run *sql* in autocommit mode and return its rows as ``psql -tA`` would.

    Never raises on an SQL error: like ``psql -v ON_ERROR_STOP=1`` the failure
    is reported through ``returncode``/``stderr`` so the caller asserts on it.
    """
    import psycopg2

    try:
        connection = psycopg2.connect(dsn, connect_timeout=5)
    except psycopg2.Error as exc:
        return SqlResult(returncode=2, stdout="", stderr=str(exc))
    try:
        connection.autocommit = True
        with connection.cursor() as cursor:
            cursor.execute(sql)
            rows = cursor.fetchall() if cursor.description else []
    except psycopg2.Error as exc:
        return SqlResult(returncode=1, stdout="", stderr=str(exc))
    finally:
        connection.close()
    lines = ["|".join(_format_value(value) for value in row) for row in rows]
    return SqlResult(returncode=0, stdout="\n".join(lines) + ("\n" if lines else ""), stderr="")


def _with_database(url: str, database: str, drivername: str) -> str:
    """Rewrite a PostgreSQL URL to point at *database* through *drivername*."""
    from sqlalchemy.engine import make_url

    return (
        make_url(url)
        .set(drivername=drivername, database=database)
        .render_as_string(hide_password=False)
    )


@dataclass(frozen=True)
class PgServer:
    """A reachable PostgreSQL server on which databases can be created."""

    admin_url: str
    source: str

    def dsn(self, database: str) -> str:
        """libpq URL (psycopg2 / alembic ``DATABASE_URL`` form)."""
        return _with_database(self.admin_url, database, "postgresql")

    def admin(self, sql: str) -> SqlResult:
        return run_sql(self.admin_url, sql)


@dataclass(frozen=True)
class ThrowawayDatabase:
    """A database created for one test and dropped after it."""

    name: str
    server: PgServer

    @property
    def dsn(self) -> str:
        """libpq URL: psycopg2, ``psql``, alembic's ``DATABASE_URL``."""
        return self.server.dsn(self.name)

    @property
    def sync_url(self) -> str:
        """SQLAlchemy URL for a sync (psycopg2) engine."""
        return _with_database(self.server.admin_url, self.name, "postgresql+psycopg2")

    @property
    def async_url(self) -> str:
        """SQLAlchemy URL for an async (asyncpg) engine."""
        return _with_database(self.server.admin_url, self.name, "postgresql+asyncpg")

    def psql(self, sql: str) -> SqlResult:
        return run_sql(self.dsn, sql)


def _socket_admin_url() -> str | None:
    if not Path(_SOCKET_DIR).exists():
        return None
    user = os.environ.get("USER") or getpass.getuser()
    return f"postgresql://{user}@/postgres?host={_SOCKET_DIR}"


def _probe(server: PgServer) -> str | None:
    """Return why *server* cannot host the tests, or ``None`` when it can."""
    reached = server.admin("SELECT 1 FROM pg_available_extensions WHERE name = 'vector'")
    if reached.returncode != 0:
        return f"cannot connect: {reached.stderr.strip()}"
    if reached.stdout.strip() != "1":
        return "the pgvector extension is not installed on the server"
    return None


@pytest.fixture(scope="session")
def pg_server() -> PgServer:
    """The PostgreSQL server the integration tests may create databases on."""
    try:
        import asyncpg  # noqa: F401
        import psycopg2  # noqa: F401
    except ImportError as exc:  # pragma: no cover - both are in requirements.txt
        pytest.skip(f"PostgreSQL drivers missing: {exc}")

    explicit = os.environ.get(ADMIN_URL_ENV)
    if explicit:
        server = PgServer(admin_url=explicit, source=ADMIN_URL_ENV)
        problem = _probe(server)
        if problem:
            # Configured on purpose (CI): never degrade into a silent skip.
            pytest.fail(f"{ADMIN_URL_ENV} is set but unusable — {problem}", pytrace=False)
        return server

    socket_url = _socket_admin_url()
    if socket_url is None:
        pytest.skip(
            f"no PostgreSQL for integration tests: set {ADMIN_URL_ENV} "
            f"or run a local server on {_SOCKET_DIR}"
        )
    server = PgServer(admin_url=socket_url, source="unix socket")
    problem = _probe(server)
    if problem:
        pytest.skip(
            f"local PostgreSQL ({_SOCKET_DIR}, peer auth) unusable — {problem}; "
            f"set {ADMIN_URL_ENV} to use another server"
        )
    return server


@pytest.fixture
def throwaway_pg(pg_server: PgServer) -> Iterator[ThrowawayDatabase]:
    """An empty, uniquely named database, always dropped afterwards."""
    database = ThrowawayDatabase(name=f"gigapdf_test_{uuid.uuid4().hex[:16]}", server=pg_server)
    created = pg_server.admin(f'CREATE DATABASE "{database.name}"')
    assert created.returncode == 0, created.stderr
    try:
        yield database
    finally:
        dropped = pg_server.admin(f'DROP DATABASE IF EXISTS "{database.name}" WITH (FORCE)')
        assert dropped.returncode == 0, dropped.stderr


@pytest.fixture
def pg_schema_db(throwaway_pg: ThrowawayDatabase) -> ThrowawayDatabase:
    """A throwaway database with pgvector and the full SQLAlchemy schema."""
    from sqlalchemy import create_engine

    # database.py imports api_key and tenant at its end: the whole schema.
    from app.models.database import Base

    enabled = throwaway_pg.psql("CREATE EXTENSION IF NOT EXISTS vector")
    assert enabled.returncode == 0, enabled.stderr
    engine = create_engine(throwaway_pg.sync_url)
    try:
        Base.metadata.create_all(engine)
    finally:
        engine.dispose()
    return throwaway_pg


def run_alembic(database: ThrowawayDatabase, *args: str) -> subprocess.CompletedProcess:
    """Run the alembic CLI of the project against *database* (never ``.env``'s)."""
    env = dict(os.environ)
    env["DATABASE_URL"] = database.dsn
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(PROJECT_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )


@pytest.fixture
def migrated_pg(throwaway_pg: ThrowawayDatabase) -> ThrowawayDatabase:
    """A throwaway database migrated with ``alembic upgrade head``."""
    upgraded = run_alembic(throwaway_pg, "upgrade", "head")
    assert upgraded.returncode == 0, upgraded.stderr
    return throwaway_pg


# ---------------------------------------------------------------------------
# Application on a throwaway database (storage / quota integration tests)
# ---------------------------------------------------------------------------


@pytest.fixture
async def factory(pg_schema_db, monkeypatch):
    """Point the application's session factories at the throwaway database."""
    from sqlalchemy import create_engine
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from sqlalchemy.orm import sessionmaker

    from app.core import database

    engine = create_async_engine(pg_schema_db.async_url)
    session_factory = async_sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )
    sync_engine = create_engine(pg_schema_db.sync_url)
    monkeypatch.setattr(database, "_engine", engine)
    monkeypatch.setattr(database, "_session_factory", session_factory)
    monkeypatch.setattr(
        database, "_sync_session_factory", sessionmaker(bind=sync_engine, expire_on_commit=False)
    )
    try:
        yield session_factory
    finally:
        await engine.dispose()
        sync_engine.dispose()


@pytest.fixture
def boundaries(monkeypatch):
    """Object storage, activity log and embeddings: outside the transaction."""
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock

    from app.api.v1 import storage as storage_module

    s3 = storage_module.s3_service
    mocks = SimpleNamespace(
        upload_file=MagicMock(return_value={"key": "x"}),
        copy_file=MagicMock(return_value={"dest_key": "x"}),
        delete_file=MagicMock(return_value=True),
    )
    for name in ("upload_file", "copy_file", "delete_file"):
        monkeypatch.setattr(s3, name, getattr(mocks, name))
    monkeypatch.setattr(
        storage_module.activity_service, "log_activity", AsyncMock(return_value="activity")
    )
    monkeypatch.setattr(
        storage_module.embedding_service,
        "embed_passages",
        MagicMock(side_effect=lambda texts: [[0.1] * 384 for _ in texts]),
    )
    return mocks


@pytest.fixture
def fail_writes(pg_schema_db):
    """Make every ``event`` (e.g. ``UPDATE``) on ``table`` raise in PostgreSQL."""

    def install(table: str, event: str) -> None:
        result = pg_schema_db.psql(
            f"""
            CREATE OR REPLACE FUNCTION test_injected_failure() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION 'injected failure on %', TG_TABLE_NAME;
            END $$;
            CREATE TRIGGER test_injected_failure_{table}
                BEFORE {event} ON {table}
                FOR EACH ROW EXECUTE FUNCTION test_injected_failure();
            """
        )
        assert result.returncode == 0, result.stderr

    return install


@pytest.fixture
def fail_commit(pg_schema_db):
    """Make the COMMIT of a transaction that inserted into ``table`` fail.

    A deferred constraint trigger runs at COMMIT time: the statements and the
    flush succeed, and PostgreSQL rejects the transaction when it commits —
    the "commit failed" case, distinct from a failing statement.
    """

    def install(table: str) -> None:
        result = pg_schema_db.psql(
            f"""
            CREATE OR REPLACE FUNCTION test_injected_commit_failure() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION 'injected commit failure on %', TG_TABLE_NAME;
            END $$;
            CREATE CONSTRAINT TRIGGER test_injected_commit_failure_{table}
                AFTER INSERT ON {table}
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION test_injected_commit_failure();
            """
        )
        assert result.returncode == 0, result.stderr

    return install
