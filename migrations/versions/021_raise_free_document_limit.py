"""Raise free-plan document_limit from 100 to 1000.

Data migration (no schema change — ``document_limit`` has a Python-side
default only, no server_default).

Context: the free-plan document allowance is raised from 100 to 1000
(apps/admin/scripts/seed-plans.ts and app/services/quota_service.PLANS).
Existing ``user_quotas`` rows for free users still carry the old 100 limit
frozen at creation time, so they must be bumped to match the new plan
definition.

Scoped by ``plan_type = 'free'`` (robust) AND ``document_limit = 100`` (the
old, unique free-plan value — starter=500 / pro=2000 / enterprise=-1 are
never 100). This double guard makes the UPDATE safe and idempotent:
re-running it matches zero rows once applied, and rows where an admin set a
custom free-plan limit (anything other than 100) are left untouched.

Idempotent: re-running matches no rows after the first apply.

Revision ID: 021_free_doc_1000
Revises: 020_original_format
Create Date: 2026-06-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "021_free_doc_1000"
down_revision: Union[str, None] = "020_original_format"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_FREE_DOCUMENT_LIMIT = 100
_NEW_FREE_DOCUMENT_LIMIT = 1000


def upgrade() -> None:
    """Bump free-plan quota rows from the old 100 limit to 1000."""
    op.execute(
        sa.text(
            "UPDATE user_quotas "
            "SET document_limit = :new_limit "
            "WHERE plan_type = 'free' AND document_limit = :old_limit"
        ).bindparams(
            new_limit=_NEW_FREE_DOCUMENT_LIMIT,
            old_limit=_OLD_FREE_DOCUMENT_LIMIT,
        )
    )


def downgrade() -> None:
    """Restore the old 100 limit for free-plan rows bumped to 1000.

    Idempotent inverse of ``upgrade()``: targets exactly
    ``plan_type = 'free' AND document_limit = 1000``. Free is the only plan
    whose document_limit was 1000 here, so this does not clobber other plans
    (starter=500 / pro=2000 / enterprise=-1).
    """
    op.execute(
        sa.text(
            "UPDATE user_quotas "
            "SET document_limit = :old_limit "
            "WHERE plan_type = 'free' AND document_limit = :new_limit"
        ).bindparams(
            old_limit=_OLD_FREE_DOCUMENT_LIMIT,
            new_limit=_NEW_FREE_DOCUMENT_LIMIT,
        )
    )
