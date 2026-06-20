"""Raise starter document_limit to 5000 and make pro unlimited (-1).

Data migration (no schema change — ``document_limit`` has a Python-side
default only, no server_default).

Context: the paid-plan document allowances are revised
(apps/admin/scripts/seed-plans.ts and app/services/quota_service.PLANS):
- starter ("Démarrage"): 500 -> 5000
- pro:                    2000 -> -1 (unlimited, like enterprise)

Existing ``user_quotas`` rows for starter/pro users still carry the old
limits frozen at creation time, so they must be bumped to match the new
plan definitions.

Each UPDATE is scoped by ``plan_type`` AND the old value (double guard).
This makes the migration safe and idempotent: re-running matches zero rows
once applied, and rows where an admin set a custom limit (anything other
than the old default) are left untouched. The free plan (1000) and the
enterprise plan (-1) are never matched.

Idempotent: re-running matches no rows after the first apply.

Revision ID: 022_starter_pro_docs
Revises: 021_free_doc_1000
Create Date: 2026-06-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "022_starter_pro_docs"
down_revision: Union[str, None] = "021_free_doc_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_STARTER_DOCUMENT_LIMIT = 500
_NEW_STARTER_DOCUMENT_LIMIT = 5000
_OLD_PRO_DOCUMENT_LIMIT = 2000
_NEW_PRO_DOCUMENT_LIMIT = -1  # unlimited


def upgrade() -> None:
    """Bump starter rows 500 -> 5000 and pro rows 2000 -> -1 (unlimited)."""
    op.execute(
        sa.text(
            "UPDATE user_quotas "
            "SET document_limit = :new_limit "
            "WHERE plan_type = 'starter' AND document_limit = :old_limit"
        ).bindparams(
            new_limit=_NEW_STARTER_DOCUMENT_LIMIT,
            old_limit=_OLD_STARTER_DOCUMENT_LIMIT,
        )
    )
    op.execute(
        sa.text(
            "UPDATE user_quotas "
            "SET document_limit = :new_limit "
            "WHERE plan_type = 'pro' AND document_limit = :old_limit"
        ).bindparams(
            new_limit=_NEW_PRO_DOCUMENT_LIMIT,
            old_limit=_OLD_PRO_DOCUMENT_LIMIT,
        )
    )


def downgrade() -> None:
    """Restore the old starter (5000 -> 500) and pro (-1 -> 2000) limits.

    Idempotent inverse of ``upgrade()``: each UPDATE targets exactly the
    plan_type and the value set by ``upgrade()``. Scoped by ``plan_type`` so
    it never clobbers free (1000) or enterprise (-1).

    Note: pro's restored value (2000) and the -1 sentinel are matched by
    ``plan_type = 'pro'`` only, so the enterprise -1 rows are untouched.
    """
    op.execute(
        sa.text(
            "UPDATE user_quotas "
            "SET document_limit = :old_limit "
            "WHERE plan_type = 'starter' AND document_limit = :new_limit"
        ).bindparams(
            old_limit=_OLD_STARTER_DOCUMENT_LIMIT,
            new_limit=_NEW_STARTER_DOCUMENT_LIMIT,
        )
    )
    op.execute(
        sa.text(
            "UPDATE user_quotas "
            "SET document_limit = :old_limit "
            "WHERE plan_type = 'pro' AND document_limit = :new_limit"
        ).bindparams(
            old_limit=_OLD_PRO_DOCUMENT_LIMIT,
            new_limit=_NEW_PRO_DOCUMENT_LIMIT,
        )
    )
