"""Add stripe_product_id to plans table.

Revision ID: 009
Revises: 008
Create Date: 2025-01-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "009_stripe_product"
down_revision: Union[str, None] = "008_trial_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add stripe_product_id to plans table
    if not _column_exists("plans", "stripe_product_id"):
        op.add_column(
            "plans",
            sa.Column("stripe_product_id", sa.String(255), nullable=True)
        )

    # Add last_synced_at to track when plan was last synced with Stripe
    if not _column_exists("plans", "stripe_synced_at"):
        op.add_column(
            "plans",
            sa.Column("stripe_synced_at", sa.DateTime, nullable=True)
        )

    # Add account_suspended field to user_quotas for payment failures
    if not _column_exists("user_quotas", "is_suspended"):
        op.add_column(
            "user_quotas",
            sa.Column("is_suspended", sa.Boolean, default=False, nullable=False, server_default="false")
        )

    if not _column_exists("user_quotas", "suspended_at"):
        op.add_column(
            "user_quotas",
            sa.Column("suspended_at", sa.DateTime, nullable=True)
        )

    if not _column_exists("user_quotas", "suspension_reason"):
        op.add_column(
            "user_quotas",
            sa.Column("suspension_reason", sa.String(255), nullable=True)
        )

    # Add payment failure tracking
    if not _column_exists("user_quotas", "payment_failed_count"):
        op.add_column(
            "user_quotas",
            sa.Column("payment_failed_count", sa.Integer, default=0, nullable=False, server_default="0")
        )

    if not _column_exists("user_quotas", "last_payment_failed_at"):
        op.add_column(
            "user_quotas",
            sa.Column("last_payment_failed_at", sa.DateTime, nullable=True)
        )


def downgrade() -> None:
    op.drop_column("user_quotas", "last_payment_failed_at")
    op.drop_column("user_quotas", "payment_failed_count")
    op.drop_column("user_quotas", "suspension_reason")
    op.drop_column("user_quotas", "suspended_at")
    op.drop_column("user_quotas", "is_suspended")
    op.drop_column("plans", "stripe_synced_at")
    op.drop_column("plans", "stripe_product_id")


def _column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    from sqlalchemy import inspect
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col["name"] for col in inspector.get_columns(table_name)]
    return column_name in columns
