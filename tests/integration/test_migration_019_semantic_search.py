"""Real up/down test for migration 019 (pgvector + ocr_blocks) (#85).

This runs the FULL alembic chain (base → head) against a throwaway PostgreSQL
database, then downgrades one step, asserting:
  - ``alembic_version`` advances/recedes correctly (guards the env.py
    silent-rollback trap),
  - the ``vector`` extension and ``ocr_blocks`` table really exist,
  - the FK is ON DELETE CASCADE and the HNSW + composite indexes are present,
  - downgrade drops the table (and the now-unused extension),
  - re-upgrade is idempotent.

It is SKIPPED cleanly when no local PostgreSQL (with pgvector) is reachable —
e.g. offline CI — so the suite stays green there.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

import pytest

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_SOCKET_DIR = "/var/run/postgresql"


def _socket_dsn(dbname: str) -> str:
    """Peer-auth DSN over the unix socket (psycopg2 form)."""
    user = os.environ.get("USER", "postgres")
    return f"postgresql://{user}@/{dbname}?host={_SOCKET_DIR}"


def _psql(dbname: str, sql: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["psql", "-d", dbname, "-h", _SOCKET_DIR, "-tAqc", sql],
        capture_output=True,
        text=True,
    )


def _pg_with_pgvector_available() -> bool:
    """True iff we can reach a local PG over the socket AND pgvector exists."""
    if not Path(_SOCKET_DIR).exists():
        return False
    try:
        import psycopg2  # noqa: F401
    except ImportError:
        return False
    probe = _psql(
        "postgres",
        "SELECT 1 FROM pg_available_extensions WHERE name='vector'",
    )
    return probe.returncode == 0 and probe.stdout.strip() == "1"


pytestmark = pytest.mark.skipif(
    not _pg_with_pgvector_available(),
    reason="local PostgreSQL with pgvector not reachable (socket peer auth)",
)


@pytest.fixture
def throwaway_db():
    """Create a uniquely-named DB, yield its name, drop it afterwards."""
    name = f"gigapdf_mig_test_{uuid.uuid4().hex[:12]}"
    create = _psql("postgres", f'CREATE DATABASE "{name}"')
    assert create.returncode == 0, create.stderr
    try:
        yield name
    finally:
        # Terminate stragglers then drop.
        _psql(
            "postgres",
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            f"WHERE datname='{name}' AND pid<>pg_backend_pid()",
        )
        _psql("postgres", f'DROP DATABASE IF EXISTS "{name}"')


def _alembic(dbname: str, *args: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["DATABASE_URL"] = _socket_dsn(dbname)
    return subprocess.run(
        ["alembic", *args],
        cwd=str(_PROJECT_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )


def test_migration_019_up_down_against_real_db(throwaway_db):
    db = throwaway_db

    # ---- UP to head -----------------------------------------------------
    up = _alembic(db, "upgrade", "head")
    assert up.returncode == 0, f"upgrade failed:\n{up.stderr}"

    version = _psql(db, "SELECT version_num FROM alembic_version").stdout.strip()
    assert version == "019_semantic_search", f"alembic_version={version!r}"

    # vector extension really installed
    assert _psql(db, "SELECT 1 FROM pg_extension WHERE extname='vector'").stdout.strip() == "1"

    # ocr_blocks table + the embedding vector column
    udt = _psql(
        db,
        "SELECT udt_name FROM information_schema.columns "
        "WHERE table_name='ocr_blocks' AND column_name='embedding'",
    ).stdout.strip()
    assert udt == "vector"

    # FK ON DELETE CASCADE (confdeltype 'c')
    cascade = _psql(
        db,
        "SELECT confdeltype FROM pg_constraint "
        "WHERE conrelid='ocr_blocks'::regclass AND contype='f'",
    ).stdout.strip()
    assert cascade == "c"

    # both indexes present (HNSW + composite)
    indexes = set(
        _psql(
            db, "SELECT indexname FROM pg_indexes WHERE tablename='ocr_blocks'"
        ).stdout.split()
    )
    assert "idx_ocr_blocks_embedding_hnsw" in indexes
    assert "idx_ocr_blocks_document_page" in indexes

    # ---- DOWN one step --------------------------------------------------
    down = _alembic(db, "downgrade", "-1")
    assert down.returncode == 0, f"downgrade failed:\n{down.stderr}"

    version = _psql(db, "SELECT version_num FROM alembic_version").stdout.strip()
    assert version == "018_free_doc_limit"

    # table gone; extension dropped (nothing else depends on it)
    assert _psql(db, "SELECT to_regclass('public.ocr_blocks')").stdout.strip() == ""
    assert _psql(db, "SELECT 1 FROM pg_extension WHERE extname='vector'").stdout.strip() == ""
    # untouched sibling table still there
    assert _psql(db, "SELECT to_regclass('public.stored_documents')").stdout.strip() == "stored_documents"

    # ---- RE-UP is idempotent -------------------------------------------
    reup = _alembic(db, "upgrade", "head")
    assert reup.returncode == 0, f"re-upgrade failed:\n{reup.stderr}"
    version = _psql(db, "SELECT version_num FROM alembic_version").stdout.strip()
    assert version == "019_semantic_search"


def test_async_engine_round_trips_pgvector_value(throwaway_db):
    """Regression: a real embedding must INSERT through the app's async engine.

    Layering pgvector's *binary* asyncpg codec on top of the SQLAlchemy
    ``Vector`` type made every embedding write raise
    ``asyncpg.DataError: could not convert string to float`` (the type already
    binds the value as the textual ``'[...]'`` form). That silently left
    ``ocr_blocks`` empty in production — semantic-search writes never worked.
    ``create_engine()`` must NOT register that codec; this asserts a vector value
    round-trips (INSERT + SELECT) through it.
    """
    import asyncio
    from unittest.mock import patch

    from pgvector.sqlalchemy import Vector
    from sqlalchemy import Column, MetaData, Table
    from sqlalchemy import select as sa_select

    from app.core.database import create_engine

    assert _psql(throwaway_db, "CREATE EXTENSION IF NOT EXISTS vector").returncode == 0
    assert _psql(throwaway_db, "CREATE TABLE vec_probe (v vector(3))").returncode == 0

    asyncpg_dsn = _socket_dsn(throwaway_db).replace(
        "postgresql://", "postgresql+asyncpg://", 1
    )

    async def _run() -> list[float]:
        with patch("app.core.database.get_database_url", return_value=asyncpg_dsn):
            engine = create_engine()
        probe = Table("vec_probe", MetaData(), Column("v", Vector(3)))
        try:
            async with engine.begin() as conn:
                await conn.execute(probe.insert().values(v=[1.5, 2.5, 3.5]))
                value = (await conn.execute(sa_select(probe.c.v))).scalar_one()
            return [round(float(x), 1) for x in value]
        finally:
            await engine.dispose()

    assert asyncio.run(_run()) == [1.5, 2.5, 3.5]
