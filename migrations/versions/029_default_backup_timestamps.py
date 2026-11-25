"""Default operation timestamps to the database clock.

Revision ID: 029_default_backup_timestamps
Revises: 028_add_backup_runs
Create Date: 2026-11-25
"""

from collections.abc import Sequence

from alembic import op

revision: str = "029_default_backup_timestamps"
down_revision: str | None = "028_add_backup_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table, column in (
        ("backup_runs", "started_at"),
        ("s3_bandwidth_months", "updated_at"),
        ("s3_bandwidth_user_months", "updated_at"),
        ("s3_access_log_files", "processed_at"),
    ):
        op.execute(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" SET DEFAULT CURRENT_TIMESTAMP')


def downgrade() -> None:
    for table, column in (
        ("backup_runs", "started_at"),
        ("s3_bandwidth_months", "updated_at"),
        ("s3_bandwidth_user_months", "updated_at"),
        ("s3_access_log_files", "processed_at"),
    ):
        op.execute(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" DROP DEFAULT')
