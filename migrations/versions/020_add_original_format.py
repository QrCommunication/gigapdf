"""Add original_format to stored_documents (keep imported files as-is).

Imports are no longer forced to PDF: a document keeps its original format
(docx, xlsx, png, …) on S3, with PDF still the default. To remember what the
stored bytes actually are we add:

- ``original_format`` (VARCHAR(32), nullable): the lowercase extension /
  short format token of the originally uploaded file (e.g. ``"pdf"``,
  ``"docx"``, ``"png"``). ``NULL`` / ``"pdf"`` means a regular PDF document
  (back-compatible with every pre-existing row). ``mime_type`` (already
  present since 002) carries the precise content type.

Idempotent: re-running is a no-op if the column already exists.

Revision ID: 020_original_format
Revises: 019_semantic_search
Create Date: 2026-06-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "020_original_format"
down_revision: Union[str, None] = "019_semantic_search"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "stored_documents"
_COLUMN = "original_format"


def _existing_columns(conn) -> list[str]:
    inspector = sa.inspect(conn)
    return [c["name"] for c in inspector.get_columns(_TABLE)]


def upgrade() -> None:
    """Add original_format (idempotent)."""
    conn = op.get_bind()
    if _COLUMN not in _existing_columns(conn):
        op.add_column(
            _TABLE,
            sa.Column(
                _COLUMN,
                sa.String(length=32),
                nullable=True,
                comment=(
                    "Original uploaded file format/extension (lowercase, e.g. "
                    "'pdf', 'docx', 'png'). NULL/'pdf' = regular PDF document."
                ),
            ),
        )


def downgrade() -> None:
    """Drop original_format (idempotent)."""
    conn = op.get_bind()
    if _COLUMN in _existing_columns(conn):
        op.drop_column(_TABLE, _COLUMN)
