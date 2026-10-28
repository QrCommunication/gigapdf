"""Real up/down test for migration 024 (``stored_documents.quota_tenant_id``).

The alembic chain is run to ``023_document_layers`` on an EMPTY throwaway
database (``throwaway_pg``, tests/integration/conftest.py), documents and
memberships are seeded with plain SQL, then 024 is applied. Checked:

* the backfill attributes each ACTIVE document to the counter the previous
  code would have freed: the owner's active membership of an active
  organization, a tenant-plan organization first, then the highest role;
  owners without such a membership, and trashed documents, stay NULL;
* the FK is ON DELETE RESTRICT and the column is indexed;
* downgrade removes it; re-upgrading recreates and backfills it; a second
  ``upgrade head`` on an upgraded database changes nothing (the backfill only
  runs with the column creation — it must not re-attribute personal
  documents later).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_REV_023 = "023_document_layers"
_REV_024 = "024_document_quota_attribution"

# Organizations: T_PLAN on a tenant plan, T_PLAIN without, T_TRIAL not active.
T_PLAN = "11111111-1111-1111-1111-111111111111"
T_PLAIN = "22222222-2222-2222-2222-222222222222"
T_TRIAL = "33333333-3333-3333-3333-333333333333"
PLAN_ID = "44444444-4444-4444-4444-444444444444"

_SEED = f"""
INSERT INTO plans (id, slug, name, is_tenant_plan, price, currency, interval, cta_text,
                   display_order, is_active, is_popular, storage_limit_bytes,
                   api_calls_limit, document_limit)
VALUES ('{PLAN_ID}', 'enterprise-x', 'Enterprise X', true, 0, 'EUR', 'month', 'Go',
        1, true, false, -1, -1, -1);

INSERT INTO tenants (id, name, slug, email, status, plan_id) VALUES
    ('{T_PLAN}', 'Plan', 'plan', 'p@example.com', 'active', '{PLAN_ID}'),
    ('{T_PLAIN}', 'Plain', 'plain', 'q@example.com', 'active', NULL),
    ('{T_TRIAL}', 'Trial', 'trial', 't@example.com', 'trial', NULL);

INSERT INTO user_quotas (id, user_id, plan_type, storage_used_bytes, storage_limit_bytes,
                         document_count, document_limit, api_calls_used, api_calls_limit)
SELECT id::uuid, user_id, 'free', 0, 1000000, 0, 100, 0, 1000
FROM (VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', 'u-both'),
    ('aaaaaaaa-0000-0000-0000-000000000002', 'u-plain'),
    ('aaaaaaaa-0000-0000-0000-000000000003', 'u-left'),
    ('aaaaaaaa-0000-0000-0000-000000000004', 'u-trial'),
    ('aaaaaaaa-0000-0000-0000-000000000005', 'u-alone')
) AS q (id, user_id);

-- u-both: owner of the plain org, member of the plan org -> the plan org wins.
INSERT INTO tenant_members (id, tenant_id, user_id, role, is_active) VALUES
    (gen_random_uuid(), '{T_PLAIN}', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner', true),
    (gen_random_uuid(), '{T_PLAN}', 'aaaaaaaa-0000-0000-0000-000000000001', 'member', true),
    (gen_random_uuid(), '{T_PLAIN}', 'aaaaaaaa-0000-0000-0000-000000000002', 'member', true),
    (gen_random_uuid(), '{T_PLAN}', 'aaaaaaaa-0000-0000-0000-000000000003', 'member', false),
    (gen_random_uuid(), '{T_TRIAL}', 'aaaaaaaa-0000-0000-0000-000000000004', 'owner', true);

INSERT INTO stored_documents (id, name, owner_id, file_size_bytes, is_deleted,
                              current_version, page_count, mime_type)
SELECT id::uuid, name, owner_id, 10, is_deleted, 1, 1, 'application/pdf'
FROM (VALUES
    ('dddddddd-0000-0000-0000-000000000001', 'a', 'u-both', false),
    ('dddddddd-0000-0000-0000-000000000002', 'b', 'u-plain', false),
    ('dddddddd-0000-0000-0000-000000000003', 'c', 'u-left', false),
    ('dddddddd-0000-0000-0000-000000000004', 'd', 'u-trial', false),
    ('dddddddd-0000-0000-0000-000000000005', 'e', 'u-alone', false),
    ('dddddddd-0000-0000-0000-000000000006', 'f', 'u-plain', true),
    ('dddddddd-0000-0000-0000-000000000007', 'g', 'no-quota-row', false)
) AS d (id, name, owner_id, is_deleted);
"""

_EXPECTED = {
    "a": T_PLAN,
    "b": T_PLAIN,
    "c": "",  # inactive membership
    "d": "",  # organization not active
    "e": "",  # no membership
    "f": "",  # trashed: attributed when restored
    "g": "",  # no quota row, so no membership
}


def _alembic(db, *args: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["DATABASE_URL"] = db.dsn
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(_PROJECT_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )


def _sql(db, sql: str) -> str:
    result = db.psql(sql)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def _attributions(db) -> dict[str, str]:
    rows = _sql(db, "SELECT name, quota_tenant_id FROM stored_documents ORDER BY name")
    return dict(line.split("|") for line in rows.splitlines())


def _has_column(db) -> bool:
    return _sql(
        db,
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'stored_documents' AND column_name = 'quota_tenant_id'",
    ) == "1"


def test_migration_024_backfills_the_counting_organisation(throwaway_pg):
    db = throwaway_pg
    up = _alembic(db, "upgrade", _REV_023)
    assert up.returncode == 0, f"upgrade to 023 failed:\n{up.stderr}"
    _sql(db, _SEED)

    up = _alembic(db, "upgrade", _REV_024)
    assert up.returncode == 0, f"upgrade to 024 failed:\n{up.stderr}"
    assert _sql(db, "SELECT version_num FROM alembic_version") == _REV_024
    assert _attributions(db) == _EXPECTED

    # RESTRICT foreign key ('r') + index on the column.
    assert _sql(
        db,
        "SELECT confdeltype FROM pg_constraint "
        "WHERE conname = 'stored_documents_quota_tenant_id_fkey'",
    ) == "r"
    assert _sql(
        db,
        "SELECT count(*) FROM pg_indexes WHERE tablename = 'stored_documents' "
        "AND indexname = 'ix_stored_documents_quota_tenant_id'",
    ) == "1"
    refused = db.psql(f"DELETE FROM tenants WHERE id = '{T_PLAN}'")
    assert refused.returncode != 0
    assert "stored_documents_quota_tenant_id_fkey" in refused.stderr

    # A later run must not re-attribute: u-alone's personal document stays
    # personal even once u-alone joins the plain organization.
    _sql(
        db,
        "INSERT INTO tenant_members (id, tenant_id, user_id, role, is_active) VALUES "
        f"(gen_random_uuid(), '{T_PLAIN}', 'aaaaaaaa-0000-0000-0000-000000000005', "
        "'member', true)",
    )
    again = _alembic(db, "upgrade", "head")
    assert again.returncode == 0, again.stderr
    assert _attributions(db)["e"] == ""

    down = _alembic(db, "downgrade", _REV_023)
    assert down.returncode == 0, f"downgrade failed:\n{down.stderr}"
    assert _sql(db, "SELECT version_num FROM alembic_version") == _REV_023
    assert not _has_column(db)

    up = _alembic(db, "upgrade", _REV_024)
    assert up.returncode == 0, f"re-upgrade failed:\n{up.stderr}"
    assert _attributions(db)["a"] == T_PLAN
    assert _attributions(db)["e"] == T_PLAIN  # backfilled again, with the new membership
