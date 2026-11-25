"""Store backup and restore-test execution history.

Revision ID: 028_add_backup_runs
Revises: 027_add_s3_bandwidth_accounting
Create Date: 2026-11-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "028_add_backup_runs"
down_revision: str | None = "027_add_s3_bandwidth_accounting"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "backup_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_type", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("destination", sa.String(length=1024), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_backup_runs_type", "backup_runs", ["run_type"])
    op.create_index("idx_backup_runs_status", "backup_runs", ["status"])


def downgrade() -> None:
    op.drop_index("idx_backup_runs_status", table_name="backup_runs")
    op.drop_index("idx_backup_runs_type", table_name="backup_runs")
    op.drop_table("backup_runs")
