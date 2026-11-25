"""Track monthly S3 download volume and processed access-log objects.

Revision ID: 027_add_s3_bandwidth_accounting
Revises: 026_jwks_key_algorithm
Create Date: 2026-11-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "027_add_s3_bandwidth_accounting"
down_revision: str | None = "026_jwks_key_algorithm"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "s3_bandwidth_months",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("storage_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("downloaded_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("period"),
    )
    op.create_index("idx_s3_bandwidth_period", "s3_bandwidth_months", ["period"], unique=True)

    op.create_table(
        "s3_bandwidth_user_months",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("user_id", sa.String(length=255), nullable=False),
        sa.Column("downloaded_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("period", "user_id", name="uq_s3_bandwidth_user_period"),
    )
    op.create_index(
        "idx_s3_bandwidth_user_period",
        "s3_bandwidth_user_months",
        ["period", "user_id"],
        unique=True,
    )

    op.create_table(
        "s3_access_log_files",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("object_key", sa.String(length=1024), nullable=False),
        sa.Column("downloaded_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key"),
    )
    op.create_index(
        "idx_s3_access_log_object_key",
        "s3_access_log_files",
        ["object_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("idx_s3_access_log_object_key", table_name="s3_access_log_files")
    op.drop_table("s3_access_log_files")
    op.drop_index("idx_s3_bandwidth_user_period", table_name="s3_bandwidth_user_months")
    op.drop_table("s3_bandwidth_user_months")
    op.drop_table("s3_access_log_files")
    op.drop_index("idx_s3_bandwidth_period", table_name="s3_bandwidth_months")
    op.drop_table("s3_bandwidth_months")
