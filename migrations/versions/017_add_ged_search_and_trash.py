"""Add GED features: full-text search columns and trash index.

Adds to ``stored_documents``:
- ``extracted_text`` (TEXT, nullable): plain text extracted from the PDF,
  provided by the frontend on create/update (truncated server-side to
  500k characters). Used as full-text search material.
- ``search_vector`` (tsvector, GENERATED ALWAYS ... STORED): computed from
  ``name`` + ``extracted_text`` with the ``simple`` configuration
  (multilingual content — no language-specific stemming).
- GIN index on ``search_vector`` for fast ``@@`` queries.
- Simple index on the pre-existing ``deleted_at`` column to speed up
  trash listing and the daily purge task.

Revision ID: 017_ged_features
Revises: 016_publishable_key
Create Date: 2026-06-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "017_ged_features"
down_revision: Union[str, None] = "016_publishable_key"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "stored_documents"

_SEARCH_VECTOR_EXPR = (
    "to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(extracted_text, ''))"
)


def _existing_columns(conn) -> list[str]:
    inspector = sa.inspect(conn)
    return [c["name"] for c in inspector.get_columns(_TABLE)]


def _existing_indexes(conn) -> list[str]:
    inspector = sa.inspect(conn)
    return [i["name"] for i in inspector.get_indexes(_TABLE)]


def upgrade() -> None:
    """Add extracted_text, generated search_vector + indexes (idempotent)."""
    conn = op.get_bind()
    columns = _existing_columns(conn)
    indexes = _existing_indexes(conn)

    # 1. extracted_text — raw text material for full-text search
    if "extracted_text" not in columns:
        op.add_column(
            _TABLE,
            sa.Column(
                "extracted_text",
                sa.Text(),
                nullable=True,
                comment="Plain text extracted from the PDF (search material, max 500k chars)",
            ),
        )

    # 2. search_vector — PostgreSQL generated column (STORED).
    #    'simple' config: content is multilingual, no stemming wanted.
    if "search_vector" not in columns:
        op.execute(
            f"ALTER TABLE {_TABLE} ADD COLUMN search_vector tsvector "
            f"GENERATED ALWAYS AS ({_SEARCH_VECTOR_EXPR}) STORED"
        )

    # 3. GIN index for tsquery matching
    if "idx_stored_documents_search_vector" not in indexes:
        op.create_index(
            "idx_stored_documents_search_vector",
            _TABLE,
            ["search_vector"],
            postgresql_using="gin",
        )

    # 4. Simple index on deleted_at (column exists since 002_storage_jobs,
    #    timestamptz since 010) — used by trash listing + daily purge.
    if "idx_stored_documents_deleted_at" not in indexes:
        op.create_index(
            "idx_stored_documents_deleted_at",
            _TABLE,
            ["deleted_at"],
        )


def downgrade() -> None:
    """Remove the GED search columns and indexes added by this revision.

    Note: the ``deleted_at`` COLUMN itself predates this migration
    (002_storage_jobs) and is intentionally NOT dropped — only its index.
    """
    conn = op.get_bind()
    columns = _existing_columns(conn)
    indexes = _existing_indexes(conn)

    if "idx_stored_documents_deleted_at" in indexes:
        op.drop_index("idx_stored_documents_deleted_at", table_name=_TABLE)

    if "idx_stored_documents_search_vector" in indexes:
        op.drop_index("idx_stored_documents_search_vector", table_name=_TABLE)

    if "search_vector" in columns:
        op.drop_column(_TABLE, "search_vector")

    if "extracted_text" in columns:
        op.drop_column(_TABLE, "extracted_text")
