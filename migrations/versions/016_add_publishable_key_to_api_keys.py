"""Add publishable_key columns to api_keys table.

Adds a publishable key (giga_pub_*) alongside the existing secret key
(giga_pk_*). The publishable key is safe to expose in client-side code
and is used by the embed widget SDK.

Revision ID: 016_publishable_key
Revises: 015_api_keys
Create Date: 2026-03-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "016_publishable_key"
down_revision: Union[str, None] = "015_api_keys"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add publishable_key_hash and publishable_key_prefix columns."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = [c["name"] for c in inspector.get_columns("api_keys")]

    if "publishable_key_hash" not in existing_columns:
        op.add_column(
            "api_keys",
            sa.Column(
                "publishable_key_hash",
                sa.String(128),
                nullable=True,
                comment="SHA-256 hash of the publishable key (giga_pub_*)",
            ),
        )

    if "publishable_key_prefix" not in existing_columns:
        op.add_column(
            "api_keys",
            sa.Column(
                "publishable_key_prefix",
                sa.String(20),
                nullable=True,
                comment="First chars of the publishable key for display",
            ),
        )

    # Create unique index on publishable_key_hash
    existing_indexes = [idx["name"] for idx in inspector.get_indexes("api_keys")]
    if "idx_api_keys_pub_key_hash" not in existing_indexes:
        op.create_index(
            "idx_api_keys_pub_key_hash",
            "api_keys",
            ["publishable_key_hash"],
            unique=True,
        )


def downgrade() -> None:
    """Remove publishable key columns."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_indexes = [idx["name"] for idx in inspector.get_indexes("api_keys")]

    if "idx_api_keys_pub_key_hash" in existing_indexes:
        op.drop_index("idx_api_keys_pub_key_hash", table_name="api_keys")

    existing_columns = [c["name"] for c in inspector.get_columns("api_keys")]

    if "publishable_key_prefix" in existing_columns:
        op.drop_column("api_keys", "publishable_key_prefix")
    if "publishable_key_hash" in existing_columns:
        op.drop_column("api_keys", "publishable_key_hash")
