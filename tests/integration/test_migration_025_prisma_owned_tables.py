"""Real tests for migration 025 (tables that only the Prisma schemas define).

Run on throwaway PostgreSQL databases (tests/integration/conftest.py):

* a fresh database migrated to ``head`` has the eleven Prisma-owned tables,
  and Prisma itself finds NO difference between them and the models of
  apps/web and apps/admin (``prisma migrate diff ... --exit-code``);
* a production-shaped database (Better Auth tables created long ago with
  other column types, legacy admin tables with differently named indexes,
  rows everywhere) only gains what it lacks: existing tables, their indexes,
  constraints and rows are left exactly as they were;
* ``upgrade head`` twice, and ``downgrade`` then ``upgrade``, change nothing
  and keep the rows (downgrade is a documented no-op).

The Prisma comparison needs the Prisma CLI of the monorepo
(``node_modules/.bin/prisma``, installed by ``pnpm install``). Without it the
test is skipped with its reason — unless ``REQUIRE_PRISMA_CLI`` is set (CI),
where a missing CLI fails instead of passing silently.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

from tests.integration.conftest import PROJECT_ROOT, run_alembic


def _head_revision() -> str:
    """The head of the migration chain, read from the scripts (not hard-coded)."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(PROJECT_ROOT / "migrations"))
    return ScriptDirectory.from_config(config).get_current_head()

_REV_024 = "024_document_quota_attribution"
_REV_025 = "025_prisma_owned_tables"

_WEB_TABLES = (
    "users",
    "sessions",
    "accounts",
    "verification",
    "jwks",
    "font_cache",
    "user_signatures",
)
_ADMIN_TABLES = ("admin_users", "admin_accounts", "admin_sessions", "admin_verification")
_OWNED = _WEB_TABLES + _ADMIN_TABLES
_OWNED_SQL = ", ".join(f"'{table}'" for table in _OWNED)

_PRISMA_CLI = PROJECT_ROOT / "node_modules" / ".bin" / "prisma"
_WEB_SCHEMA = PROJECT_ROOT / "apps" / "web" / "prisma" / "schema.prisma"
_ADMIN_SCHEMA = PROJECT_ROOT / "apps" / "admin" / "prisma" / "schema.prisma"
# The web config: it reads DATABASE_URL into datasource.url, which
# ``--from-config-datasource`` needs (the admin config does not declare it).
_PRISMA_CONFIG = PROJECT_ROOT / "apps" / "web" / "prisma.config.ts"

# What production had before 025 (read from its catalog on 2026-10-28): the
# Better Auth tables of an old hand-written script — varchar(255),
# timestamptz, FKs without ON UPDATE — and no admin_*, font_cache,
# user_signatures.
_PRODUCTION_BETTER_AUTH = """
CREATE TABLE users (
    id varchar(255) PRIMARY KEY,
    email varchar(255) NOT NULL UNIQUE,
    "emailVerified" boolean NOT NULL DEFAULT false,
    name varchar(255),
    image text,
    locale varchar(10) NOT NULL DEFAULT 'fr',
    is_admin boolean NOT NULL DEFAULT false,
    role varchar(50) NOT NULL DEFAULT 'user',
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accounts (
    id varchar(255) PRIMARY KEY,
    "userId" varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "accountId" varchar(255) NOT NULL,
    "providerId" varchar(255) NOT NULL,
    "accessToken" text, "refreshToken" text,
    "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
    scope text, password text, "idToken" text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_userid_idx ON accounts ("userId");
CREATE TABLE sessions (
    id varchar(255) PRIMARY KEY,
    "userId" varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token varchar(255) NOT NULL UNIQUE,
    "expiresAt" timestamptz NOT NULL,
    "ipAddress" varchar(255), "userAgent" text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_userid_idx ON sessions ("userId");
CREATE TABLE verification (
    id varchar(255) PRIMARY KEY,
    identifier varchar(255) NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamptz NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON verification (identifier);
CREATE TABLE jwks (
    id varchar(255) PRIMARY KEY,
    "publicKey" text NOT NULL,
    "privateKey" text NOT NULL,
    "createdAt" timestamptz NOT NULL,
    "expiresAt" timestamptz
);
INSERT INTO users (id, email, name) VALUES ('u1', 'u1@example.com', 'User One');
INSERT INTO accounts (id, "userId", "accountId", "providerId", password)
    VALUES ('a1', 'u1', 'u1', 'credential', 'hash');
INSERT INTO sessions (id, "userId", token, "expiresAt")
    VALUES ('s1', 'u1', 'tok-1', now() + interval '1 day');
INSERT INTO verification (id, identifier, value, "expiresAt")
    VALUES ('v1', 'u1@example.com', '123456', now());
INSERT INTO jwks (id, "publicKey", "privateKey", "createdAt") VALUES ('k1', 'pub', 'priv', now());
"""

# What the retired apps/admin/prisma/migrations/init_admin_tables.sql created:
# same columns as Prisma, but camelCase index names ("admin_accounts_userId_idx"
# where Prisma says "admin_accounts_userid_idx").
_LEGACY_ADMIN = """
CREATE TABLE admin_users (
    id text NOT NULL, email text NOT NULL, "emailVerified" boolean NOT NULL DEFAULT false,
    name text, image text, role text NOT NULL DEFAULT 'admin',
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT admin_users_pkey PRIMARY KEY (id)
);
CREATE TABLE admin_accounts (
    id text NOT NULL, "userId" text NOT NULL, "accountId" text NOT NULL,
    "providerId" text NOT NULL, "accessToken" text, "refreshToken" text,
    "accessTokenExpiresAt" timestamp(3), "refreshTokenExpiresAt" timestamp(3),
    scope text, password text, "idToken" text,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT admin_accounts_pkey PRIMARY KEY (id)
);
CREATE TABLE admin_sessions (
    id text NOT NULL, "userId" text NOT NULL, token text NOT NULL,
    "expiresAt" timestamp(3) NOT NULL, "ipAddress" text, "userAgent" text,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT admin_sessions_pkey PRIMARY KEY (id)
);
CREATE TABLE admin_verification (
    id text NOT NULL, identifier text NOT NULL, value text NOT NULL,
    "expiresAt" timestamp(3) NOT NULL,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT admin_verification_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "admin_users_email_key" ON admin_users (email);
CREATE UNIQUE INDEX "admin_sessions_token_key" ON admin_sessions (token);
CREATE INDEX "admin_accounts_userId_idx" ON admin_accounts ("userId");
CREATE INDEX "admin_sessions_userId_idx" ON admin_sessions ("userId");
CREATE INDEX "admin_verification_identifier_idx" ON admin_verification (identifier);
ALTER TABLE admin_accounts ADD CONSTRAINT "admin_accounts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES admin_users (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE admin_sessions ADD CONSTRAINT "admin_sessions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES admin_users (id) ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO admin_users (id, email, role) VALUES ('adm1', 'admin@example.com', 'super_admin');
INSERT INTO admin_accounts (id, "userId", "accountId", "providerId", password)
    VALUES ('aa1', 'adm1', 'adm1', 'credential', 'hash');
"""

_ROWS = {
    "users": 1,
    "accounts": 1,
    "sessions": 1,
    "verification": 1,
    "jwks": 1,
    "admin_users": 1,
    "admin_accounts": 1,
}


def _sql(db, sql: str) -> str:
    result = db.psql(sql)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def _alembic_ok(db, *args: str) -> None:
    result = run_alembic(db, *args)
    assert result.returncode == 0, result.stderr


def _snapshot(db, tables: tuple[str, ...] = _OWNED) -> dict[str, str]:
    """Columns, indexes and constraints of *tables*, in comparable text form."""
    names = ", ".join(f"'{table}'" for table in tables)
    return {
        "tables": _sql(
            db,
            "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables "
            f"WHERE table_schema = 'public' AND table_name IN ({names})",
        ),
        "columns": _sql(
            db,
            "SELECT table_name, column_name, data_type, character_maximum_length, "
            "datetime_precision, is_nullable, column_default FROM information_schema.columns "
            f"WHERE table_schema = 'public' AND table_name IN ({names}) "
            "ORDER BY table_name, ordinal_position",
        ),
        "indexes": _sql(
            db,
            "SELECT tablename, indexname, indexdef FROM pg_indexes "
            f"WHERE schemaname = 'public' AND tablename IN ({names}) ORDER BY 1, 2",
        ),
        "constraints": _sql(
            db,
            "SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) "
            f"FROM pg_constraint WHERE conrelid::regclass::text IN ({names}) ORDER BY 1, 2",
        ),
    }


def _row_counts(db) -> dict[str, int]:
    return {table: int(_sql(db, f"SELECT count(*) FROM {table}")) for table in _ROWS}


def _existing_tables(db) -> set[str]:
    rows = _sql(
        db,
        "SELECT table_name FROM information_schema.tables "
        f"WHERE table_schema = 'public' AND table_name IN ({_OWNED_SQL})",
    )
    return set(rows.splitlines())


# ---------------------------------------------------------------------------
# Fresh database
# ---------------------------------------------------------------------------


def test_fresh_upgrade_creates_every_prisma_owned_table(migrated_pg):
    assert _existing_tables(migrated_pg) == set(_OWNED)
    assert _sql(migrated_pg, "SELECT version_num FROM alembic_version") == _head_revision()

    cascades = _sql(
        migrated_pg,
        "SELECT conrelid::regclass::text, pg_get_constraintdef(oid) FROM pg_constraint "
        f"WHERE contype = 'f' AND conrelid::regclass::text IN ({_OWNED_SQL}) ORDER BY 1",
    ).splitlines()
    assert cascades == [
        'accounts|FOREIGN KEY ("userId") REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE',
        'admin_accounts|FOREIGN KEY ("userId") REFERENCES admin_users(id) '
        "ON UPDATE CASCADE ON DELETE CASCADE",
        'admin_sessions|FOREIGN KEY ("userId") REFERENCES admin_users(id) '
        "ON UPDATE CASCADE ON DELETE CASCADE",
        'sessions|FOREIGN KEY ("userId") REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE',
    ]

    # Deleting a user removes its Better Auth identity; signatures are erased
    # explicitly by the account erasure (no FK by design).
    _sql(
        migrated_pg,
        """
        INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com');
        INSERT INTO accounts (id, "userId", "accountId", "providerId") VALUES ('a1', 'u1', 'u1', 'x');
        INSERT INTO sessions (id, "userId", token, "expiresAt") VALUES ('s1', 'u1', 't', now());
        DELETE FROM users WHERE id = 'u1';
        """,
    )
    assert _sql(migrated_pg, "SELECT count(*) FROM accounts") == "0"
    assert _sql(migrated_pg, "SELECT count(*) FROM sessions") == "0"


def _model_blocks(schema: Path) -> dict[str, str]:
    """``table name -> model block`` of a Prisma schema, verbatim."""
    blocks: dict[str, str] = {}
    for match in re.finditer(r"^model (\w+) \{\n.*?^\}", schema.read_text(), re.M | re.S):
        mapped = re.search(r'@@map\("(\w+)"\)', match.group(0))
        blocks[mapped.group(1) if mapped else match.group(1)] = match.group(0)
    return blocks


def _owned_models_schema(destination: Path) -> Path:
    """A Prisma schema holding only the owned models, copied from their owner.

    The web schema owns the Better Auth ``users``…, ``font_cache`` and
    ``user_signatures``; the admin schema owns ``admin_*`` (its ``users`` model
    is an introspected subset, the web one is authoritative).
    """
    web, admin = _model_blocks(_WEB_SCHEMA), _model_blocks(_ADMIN_SCHEMA)
    header = _WEB_SCHEMA.read_text().split("\nmodel ", 1)[0]
    models = [web[table] for table in _WEB_TABLES] + [admin[table] for table in _ADMIN_TABLES]
    destination.write_text(header + "\n" + "\n\n".join(models) + "\n")
    return destination


def _prune_to_owned_tables(db) -> None:
    """Leave only the owned tables, so Prisma compares exactly those."""
    _sql(
        db,
        f"""
        DO $$
        DECLARE item record;
        BEGIN
            FOR item IN SELECT tablename FROM pg_tables
                        WHERE schemaname = 'public' AND tablename NOT IN ({_OWNED_SQL})
            LOOP
                EXECUTE format('DROP TABLE %I CASCADE', item.tablename);
            END LOOP;
            FOR item IN SELECT t.typname FROM pg_type t
                        JOIN pg_namespace n ON n.oid = t.typnamespace
                        WHERE n.nspname = 'public' AND t.typtype = 'e'
            LOOP
                EXECUTE format('DROP TYPE %I CASCADE', item.typname);
            END LOOP;
        END $$;
        """,
    )


def _prisma_url(dsn: str) -> str:
    """Prisma rejects an empty host: give unix-socket URLs a nominal one.

    The socket directory stays in the ``host`` query parameter, which wins.
    """
    from sqlalchemy.engine import make_url

    url = make_url(dsn)
    if not url.host:
        url = url.set(host="localhost")
    return url.render_as_string(hide_password=False)


def test_fresh_schema_is_exactly_what_prisma_expects(migrated_pg, tmp_path):
    if not _PRISMA_CLI.exists():
        message = f"Prisma CLI not installed ({_PRISMA_CLI}); run pnpm install"
        if os.environ.get("REQUIRE_PRISMA_CLI"):
            pytest.fail(message, pytrace=False)
        pytest.skip(message)

    _prune_to_owned_tables(migrated_pg)
    assert _existing_tables(migrated_pg) == set(_OWNED)
    schema = _owned_models_schema(tmp_path / "owned.prisma")

    env = dict(os.environ)
    env["DATABASE_URL"] = _prisma_url(migrated_pg.dsn)
    result = subprocess.run(
        [
            str(_PRISMA_CLI),
            "migrate",
            "diff",
            "--config",
            str(_PRISMA_CONFIG),
            "--from-config-datasource",
            "--to-schema",
            str(schema),
            "--script",
            "--exit-code",
        ],
        cwd=str(PROJECT_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    # 0 = no difference, 2 = differences (printed), 1 = error.
    assert result.returncode == 0, (
        f"prisma migrate diff exit {result.returncode}\n{result.stdout}\n{result.stderr}"
    )


# ---------------------------------------------------------------------------
# Production-shaped database
# ---------------------------------------------------------------------------


def test_production_shaped_database_only_gains_missing_tables(throwaway_pg):
    _alembic_ok(throwaway_pg, "upgrade", _REV_024)
    _sql(throwaway_pg, _PRODUCTION_BETTER_AUTH)
    _sql(throwaway_pg, _LEGACY_ADMIN)
    existing = (*_WEB_TABLES[:5], *_ADMIN_TABLES)
    before = _snapshot(throwaway_pg, existing)
    rows_before = _row_counts(throwaway_pg)

    # 025 alone (026 then adds jwks columns: test_migration_026_jwks_key_algorithm.py).
    _alembic_ok(throwaway_pg, "upgrade", _REV_025)

    assert _snapshot(throwaway_pg, existing) == before
    assert _row_counts(throwaway_pg) == rows_before
    assert _existing_tables(throwaway_pg) == set(_OWNED)
    # The legacy admin index under another name was recognised, not doubled.
    assert _sql(
        throwaway_pg,
        "SELECT count(*) FROM pg_indexes WHERE tablename = 'admin_accounts' "
        "AND indexdef LIKE '%(\"userId\")'",
    ) == "1"
    # What was missing is there, with its indexes.
    assert _sql(
        throwaway_pg,
        "SELECT string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes "
        "WHERE tablename IN ('font_cache', 'user_signatures')",
    ) == (
        "font_cache_pkey,font_cache_sha256_key,idx_font_cache_last_used,"
        "idx_user_signatures_user_id,user_signatures_pkey"
    )


# ---------------------------------------------------------------------------
# Re-runs
# ---------------------------------------------------------------------------


def test_upgrade_twice_and_downgrade_then_upgrade_change_nothing(migrated_pg):
    _sql(
        migrated_pg,
        """
        INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com');
        INSERT INTO accounts (id, "userId", "accountId", "providerId") VALUES ('a1', 'u1', 'u1', 'x');
        INSERT INTO sessions (id, "userId", token, "expiresAt") VALUES ('s1', 'u1', 't', now());
        INSERT INTO verification (id, identifier, value, "expiresAt") VALUES ('v1', 'i', 'v', now());
        INSERT INTO jwks (id, "publicKey", "privateKey", "createdAt") VALUES ('k1', 'p', 'q', now());
        INSERT INTO admin_users (id, email) VALUES ('adm1', 'admin@example.com');
        INSERT INTO admin_accounts (id, "userId", "accountId", "providerId")
            VALUES ('aa1', 'adm1', 'adm1', 'credential');
        """,
    )
    # This test is about 025 alone: step back to it, so later revisions
    # (026 adds columns to jwks) do not enter the round trip.
    _alembic_ok(migrated_pg, "downgrade", _REV_025)
    before, rows_before = _snapshot(migrated_pg), _row_counts(migrated_pg)

    _alembic_ok(migrated_pg, "upgrade", _REV_025)
    assert _snapshot(migrated_pg) == before

    # Downgrade keeps every table and row (documented no-op)…
    _alembic_ok(migrated_pg, "downgrade", _REV_024)
    assert _sql(migrated_pg, "SELECT version_num FROM alembic_version") == _REV_024
    assert _snapshot(migrated_pg) == before
    assert _row_counts(migrated_pg) == rows_before

    # …and upgrading again is a no-op on them.
    _alembic_ok(migrated_pg, "upgrade", _REV_025)
    assert _sql(migrated_pg, "SELECT version_num FROM alembic_version") == _REV_025
    assert _snapshot(migrated_pg) == before
    assert _row_counts(migrated_pg) == rows_before
