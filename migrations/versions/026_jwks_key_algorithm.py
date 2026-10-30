"""Better Auth 1.7: record each JWKS key's algorithm and curve.

Better Auth 1.7 (plugin ``jwt``) stores, next to each signing key, the
algorithm it was created with (``alg``) and, for elliptic-curve keys, its
curve (``crv``). Two consequences for a database that only has the 1.6
columns:

* at start-up, 1.7 compares the Prisma data model with the fields it writes;
  apps/web/prisma/schema.prisma declares both columns, so the database must
  have them too (tests/integration/test_migration_025_prisma_owned_tables.py
  diffs the two);
* the next key it creates (rotation or expiry) is written with both fields,
  and the insert fails on a table without them — signing in would fail.

Both columns are nullable and need no backfill: Better Auth reads a NULL
``alg`` as the configured algorithm (RS256 here), which is what every existing
key was created with.

Downgrade drops the two columns: Better Auth 1.6 never reads them, and their
values are derived from the configuration, so nothing is lost.

Revision ID: 026_jwks_key_algorithm
Revises: 025_prisma_owned_tables
Create Date: 2026-10-29
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic
revision: str = "026_jwks_key_algorithm"
down_revision: str | None = "025_prisma_owned_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Columns Better Auth 1.7 writes on ``jwks``; TEXT like Prisma's ``String?``.
JWKS_ALGORITHM_COLUMNS: tuple[str, ...] = ("alg", "crv")


def upgrade() -> None:
    for column in JWKS_ALGORITHM_COLUMNS:
        op.execute(f'ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "{column}" TEXT')


def downgrade() -> None:
    for column in JWKS_ALGORITHM_COLUMNS:
        op.execute(f'ALTER TABLE "jwks" DROP COLUMN IF EXISTS "{column}"')
