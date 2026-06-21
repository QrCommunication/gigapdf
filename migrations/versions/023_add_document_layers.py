"""Add document_layers: per-document editor layer metadata (cross-session).

Adds a 1:1 ``document_layers`` table keyed by ``stored_document_id`` that
persists an **opaque** editor-layers blob so the web editor can restore user
layers and the element→layer membership map across reloads. The table follows
the same ownership model as ``stored_documents`` (owner-scoped via the API
guard — these tables are NOT RLS/tenant-scoped, ownership is enforced in the
endpoints), so no ``tenant_id`` / RLS policy is created.

Columns:
- ``id`` (UUID PK)
- ``stored_document_id`` (UUID, FK → stored_documents.id ON DELETE CASCADE,
  UNIQUE → enforces the 1:1 relationship)
- ``data`` (JSONB NOT NULL DEFAULT '{}'): opaque blob
  ``{"layers": [...], "membership": {"<elementId>": "<layerId>"}}`` — the API
  stores it verbatim and does not enforce its internal schema.
- ``created_at`` / ``updated_at`` (timestamptz)

Idempotent (IF NOT EXISTS guards) so a re-run is a no-op.

Revision ID: 023_document_layers
Revises: 022_starter_pro_docs
Create Date: 2026-06-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision: str = "023_document_layers"
down_revision: Union[str, None] = "022_starter_pro_docs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "document_layers"


def _table_exists(conn) -> bool:
    inspector = sa.inspect(conn)
    return _TABLE in inspector.get_table_names()


def _existing_indexes(conn) -> list[str]:
    inspector = sa.inspect(conn)
    return [i["name"] for i in inspector.get_indexes(_TABLE)]


def upgrade() -> None:
    """Create the document_layers table + index (idempotent)."""
    conn = op.get_bind()

    if not _table_exists(conn):
        op.create_table(
            _TABLE,
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=False),
                primary_key=True,
                nullable=False,
            ),
            sa.Column(
                "stored_document_id",
                postgresql.UUID(as_uuid=False),
                sa.ForeignKey("stored_documents.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "data",
                postgresql.JSONB(astext_type=sa.Text()),
                server_default=sa.text("'{}'::jsonb"),
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            # 1:1 with the stored document.
            sa.UniqueConstraint(
                "stored_document_id", name="uq_document_layers_stored_document"
            ),
        )

    # Index on the FK / unique lookup column. The UNIQUE constraint already
    # creates a backing index in PostgreSQL, so this is only added when absent
    # (keeps the migration idempotent without duplicating the unique index).
    indexes = _existing_indexes(conn)
    if "idx_document_layers_stored_document" not in indexes:
        op.create_index(
            "idx_document_layers_stored_document",
            _TABLE,
            ["stored_document_id"],
        )


def downgrade() -> None:
    """Drop the document_layers table (idempotent)."""
    conn = op.get_bind()
    if _table_exists(conn):
        if "idx_document_layers_stored_document" in _existing_indexes(conn):
            op.drop_index(
                "idx_document_layers_stored_document", table_name=_TABLE
            )
        op.drop_table(_TABLE)
