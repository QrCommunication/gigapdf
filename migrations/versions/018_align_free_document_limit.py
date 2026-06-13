"""Align free-plan document_limit with the plan definition (100).

Data migration (no schema change — ``document_limit`` has a Python-side
default only, no server_default).

Context: ``UserQuota.document_limit`` defaulted to 1000 in the ORM model
while the free plan (apps/admin/scripts/seed-plans.ts and
app/services/quota_service.PLANS) defines 100. Every quota row created
through the model default therefore carried 1000 instead of 100. The ORM
default is now 100; this migration fixes the rows created with the stale
default.

Idempotent: the UPDATE targets exactly ``plan_type = 'free' AND
document_limit = 1000`` — re-running it matches zero rows. Rows where an
admin manually set a custom limit (anything other than 1000) are left
untouched.

Downgrade is intentionally a NO-OP: restoring 1000 for free users would
corrupt data, because we cannot distinguish rows fixed by this migration
from rows legitimately set to 100 (the correct free-plan value) before or
after it ran. The previous value (1000) was a bug, not a state worth
restoring.

Revision ID: 018_free_doc_limit
Revises: 017_ged_features
Create Date: 2026-06-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "018_free_doc_limit"
down_revision: Union[str, None] = "017_ged_features"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FREE_PLAN_DOCUMENT_LIMIT = 100
_STALE_MODEL_DEFAULT = 1000


def upgrade() -> None:
    """Fix free-plan quota rows created with the stale 1000 model default."""
    op.execute(
        sa.text(
            "UPDATE user_quotas "
            "SET document_limit = :new_limit "
            "WHERE plan_type = 'free' AND document_limit = :stale_default"
        ).bindparams(
            new_limit=_FREE_PLAN_DOCUMENT_LIMIT,
            stale_default=_STALE_MODEL_DEFAULT,
        )
    )


def downgrade() -> None:
    """No-op (documented).

    Reverting would require knowing which rows held 1000 only because of
    the stale ORM default — information not preserved. Re-applying 1000 to
    all free rows at 100 would also clobber rows that were always correct.
    """
    # Intentionally empty — see module docstring.
