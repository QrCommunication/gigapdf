"""Add api_keys table for external API access.

Stores hashed API keys that allow users to authenticate programmatically.
The full key is shown only once at creation; only the SHA-256 hash is
persisted. The prefix column lets users identify a key without exposing
the secret value.

Revision ID: 015_api_keys
Revises: 8d9fceebf9cd
Create Date: 2026-03-12

Features:
- Named API keys per user with human-readable labels
- SHA-256 hash storage only (plaintext never persisted)
- Short prefix for identification without exposing the secret
- Comma-separated scope control (read, write, admin, ...)
- Optional CORS domain restriction via allowed_domains
- Configurable per-key rate limit (requests per minute)
- Optional expiration date
- Soft-disable via is_active flag
- last_used_at tracking for audit and cleanup
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "015_api_keys"
down_revision: Union[str, None] = "8d9fceebf9cd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create api_keys table."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "api_keys" not in existing_tables:
        op.create_table(
            "api_keys",
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.String(255), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column(
                "key_prefix",
                sa.String(16),
                nullable=False,
                comment="First 16 chars of the key for identification without exposing the secret",
            ),
            sa.Column(
                "key_hash",
                sa.String(128),
                nullable=False,
                comment="SHA-256 hash of the full API key — plaintext is never stored",
            ),
            sa.Column(
                "scopes",
                sa.Text(),
                nullable=False,
                server_default="read,write",
                comment="Comma-separated list of authorised scopes",
            ),
            sa.Column(
                "allowed_domains",
                sa.Text(),
                nullable=True,
                comment="Comma-separated allowed origins for CORS; NULL means unrestricted",
            ),
            sa.Column(
                "rate_limit",
                sa.Integer(),
                nullable=False,
                server_default="60",
                comment="Maximum requests per minute for this key",
            ),
            sa.Column(
                "is_active",
                sa.Boolean(),
                nullable=False,
                server_default="true",
            ),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("key_hash", name="uq_api_keys_key_hash"),
        )

        op.create_index("idx_api_keys_user_id", "api_keys", ["user_id"])
        op.create_index(
            "idx_api_keys_key_hash", "api_keys", ["key_hash"], unique=True
        )
        op.create_index("idx_api_keys_is_active", "api_keys", ["is_active"])
        op.create_index(
            "idx_api_keys_user_active", "api_keys", ["user_id", "is_active"]
        )


def downgrade() -> None:
    """Drop api_keys table."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "api_keys" in existing_tables:
        op.drop_index("idx_api_keys_user_active", table_name="api_keys")
        op.drop_index("idx_api_keys_is_active", table_name="api_keys")
        op.drop_index("idx_api_keys_key_hash", table_name="api_keys")
        op.drop_index("idx_api_keys_user_id", table_name="api_keys")
        op.drop_table("api_keys")
