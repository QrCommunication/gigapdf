"""Record on each document which storage counter holds it.

Adds ``stored_documents.quota_tenant_id`` (UUID, nullable, FK → tenants.id
ON DELETE RESTRICT, indexed): the organization whose counters were charged
when the document entered the active set, NULL = the owner's personal quota.

Why: the counter to free (delete) or resize (new version) was resolved from
the owner's membership AT THE TIME OF THE OPERATION. A document charged to an
organization and deleted after its owner left it was freed on the personal
quota, so the organization kept counting it forever while the personal
counter lost a document it never had (and the reverse for an owner who
joined an organization). Frees and resizes now move the counter recorded
here (app/services/quota_service.py); charges (upload, duplicate, restore)
still go to the owner's current counter and record it.

RESTRICT, not SET NULL: NULL means "personal", so a vanished organization
must not silently turn its documents into personal ones. Code deleting an
organization hands them over first (``quota_service.hand_over_tenant_documents``).

Backfill (active documents only — a trashed document is charged again, and
its attribution recorded, when it is restored): the counter the previous code
WOULD have freed, i.e. the owner's current counting organization — an active
membership of an active organization, organizations on a tenant plan first,
then the highest role (the rule of ``QuotaService._get_active_tenant_membership``).
Historical drift between those counters and their documents is corrected by
``scripts/reconcile_quota_counters.py``, which recomputes the counters from
this column.

Idempotent: the column, FK and index are created only when missing, and the
backfill runs only in the run that adds the column — re-running it later
would re-attribute personal documents of owners who joined an organization
since.

Revision ID: 024_document_quota_attribution
Revises: 023_document_layers
Create Date: 2026-10-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision: str = "024_document_quota_attribution"
down_revision: str | None = "023_document_layers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "stored_documents"
_COLUMN = "quota_tenant_id"
_FK = "stored_documents_quota_tenant_id_fkey"
_INDEX = "ix_stored_documents_quota_tenant_id"

_BACKFILL = sa.text(
    """
    UPDATE stored_documents AS d
    SET quota_tenant_id = counting.tenant_id
    FROM (
        SELECT DISTINCT ON (q.user_id) q.user_id AS owner_id, m.tenant_id
        FROM user_quotas AS q
        JOIN tenant_members AS m ON m.user_id = q.id AND m.is_active
        JOIN tenants AS t ON t.id = m.tenant_id AND t.status = 'active'
        LEFT JOIN plans AS p ON p.id = t.plan_id
        ORDER BY q.user_id, COALESCE(p.is_tenant_plan, false) DESC, m.role, m.tenant_id
    ) AS counting
    WHERE d.owner_id = counting.owner_id
      AND NOT d.is_deleted
    """
)


def _columns(conn) -> set[str]:
    return {column["name"] for column in sa.inspect(conn).get_columns(_TABLE)}


def upgrade() -> None:
    """Add the attribution column (+ FK, index) and backfill it once."""
    conn = op.get_bind()
    if _COLUMN in _columns(conn):
        return
    op.add_column(
        _TABLE,
        sa.Column(
            _COLUMN,
            postgresql.UUID(as_uuid=False),
            nullable=True,
            comment="Organization whose storage counter holds the document; NULL = personal quota",
        ),
    )
    op.create_foreign_key(_FK, _TABLE, "tenants", [_COLUMN], ["id"], ondelete="RESTRICT")
    op.create_index(_INDEX, _TABLE, [_COLUMN])
    op.execute(_BACKFILL)


def downgrade() -> None:
    """Drop the attribution (frees fall back to the owner's current membership)."""
    conn = op.get_bind()
    if _COLUMN not in _columns(conn):
        return
    op.drop_index(_INDEX, table_name=_TABLE)
    op.drop_constraint(_FK, _TABLE, type_="foreignkey")
    op.drop_column(_TABLE, _COLUMN)
