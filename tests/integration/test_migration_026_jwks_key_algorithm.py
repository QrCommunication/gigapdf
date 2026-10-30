"""Real up/down test for migration 026 (``jwks.alg`` / ``jwks.crv``, Better Auth 1.7).

Run on throwaway PostgreSQL databases (tests/integration/conftest.py):

* a fresh database migrated to ``head`` has both columns, nullable TEXT, and
  accepts the row Better Auth 1.7 writes when it creates a key;
* a database at 025 holding a key created by Better Auth 1.6 keeps it intact,
  with ``alg``/``crv`` NULL (read by Better Auth as the configured RS256);
* ``upgrade head`` twice changes nothing, and ``downgrade`` to 025 removes
  the two columns without touching the key, then ``upgrade`` adds them back.

The parity with apps/web/prisma/schema.prisma is checked by
test_migration_025_prisma_owned_tables.py (``prisma migrate diff`` on head).
"""

from __future__ import annotations

from tests.integration.conftest import run_alembic

_REV_025 = "025_prisma_owned_tables"

_COLUMNS_SQL = """
SELECT column_name || ':' || data_type || ':' || is_nullable
FROM information_schema.columns
WHERE table_name = 'jwks' AND column_name IN ('alg', 'crv')
ORDER BY column_name
"""


def _sql(db, sql: str) -> str:
    result = db.psql(sql)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def _alembic_ok(db, *args: str) -> None:
    result = run_alembic(db, *args)
    assert result.returncode == 0, result.stderr


def _jwks_rows(db) -> str:
    return _sql(db, 'SELECT id, "publicKey", "privateKey" FROM jwks ORDER BY id')


def test_fresh_database_has_both_nullable_text_columns(migrated_pg):
    assert _sql(migrated_pg, _COLUMNS_SQL).splitlines() == ["alg:text:YES", "crv:text:YES"]

    # The insert Better Auth 1.7's createJwk issues for a new key.
    _sql(
        migrated_pg,
        """INSERT INTO jwks (id, "publicKey", "privateKey", "createdAt", alg, crv)
           VALUES ('k-new', 'pub', 'priv', now(), 'RS256', NULL)""",
    )
    assert _sql(migrated_pg, "SELECT alg FROM jwks WHERE id = 'k-new'") == "RS256"


def test_existing_key_is_kept_and_reads_as_the_configured_algorithm(throwaway_pg):
    _alembic_ok(throwaway_pg, "upgrade", _REV_025)
    _sql(
        throwaway_pg,
        """INSERT INTO jwks (id, "publicKey", "privateKey", "createdAt")
           VALUES ('k-1.6', 'pub-1.6', 'priv-1.6', now())""",
    )
    rows_before = _jwks_rows(throwaway_pg)

    _alembic_ok(throwaway_pg, "upgrade", "head")

    assert _jwks_rows(throwaway_pg) == rows_before
    # NULL alg/crv: Better Auth falls back to keyPairConfig.alg (RS256).
    assert _sql(throwaway_pg, "SELECT count(*) FROM jwks WHERE alg IS NULL AND crv IS NULL") == "1"


def test_upgrade_twice_then_downgrade_and_upgrade_keep_the_keys(migrated_pg):
    _sql(
        migrated_pg,
        """INSERT INTO jwks (id, "publicKey", "privateKey", "createdAt", alg)
           VALUES ('k1', 'p', 'q', now(), 'RS256')""",
    )
    rows_before = _jwks_rows(migrated_pg)

    _alembic_ok(migrated_pg, "upgrade", "head")
    assert _sql(migrated_pg, _COLUMNS_SQL).splitlines() == ["alg:text:YES", "crv:text:YES"]

    _alembic_ok(migrated_pg, "downgrade", _REV_025)
    assert _sql(migrated_pg, "SELECT version_num FROM alembic_version") == _REV_025
    assert _sql(migrated_pg, _COLUMNS_SQL) == ""
    assert _jwks_rows(migrated_pg) == rows_before

    _alembic_ok(migrated_pg, "upgrade", "head")
    assert _sql(migrated_pg, _COLUMNS_SQL).splitlines() == ["alg:text:YES", "crv:text:YES"]
    assert _jwks_rows(migrated_pg) == rows_before
