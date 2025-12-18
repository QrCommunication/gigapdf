"""Add trial fields to user_quotas table.

Adds fields for tracking trial period start and end dates.

Revision ID: 008_trial_fields
Revises: 007_stripe_fields
Create Date: 2025-01-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '008_trial_fields'
down_revision: Union[str, None] = '007_stripe_fields'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add trial_start_at column
    if not column_exists('user_quotas', 'trial_start_at'):
        op.add_column(
            'user_quotas',
            sa.Column('trial_start_at', sa.DateTime, nullable=True)
        )

    # Add trial_ends_at column
    if not column_exists('user_quotas', 'trial_ends_at'):
        op.add_column(
            'user_quotas',
            sa.Column('trial_ends_at', sa.DateTime, nullable=True)
        )

    # Add has_used_trial column (to track if user already used their free trial)
    if not column_exists('user_quotas', 'has_used_trial'):
        op.add_column(
            'user_quotas',
            sa.Column('has_used_trial', sa.Boolean, nullable=False, server_default='false')
        )

    # Add trial_start_at to tenants if not exists
    if not column_exists('tenants', 'trial_start_at'):
        op.add_column(
            'tenants',
            sa.Column('trial_start_at', sa.DateTime, nullable=True)
        )

    # Add has_used_trial to tenants if not exists
    if not column_exists('tenants', 'has_used_trial'):
        op.add_column(
            'tenants',
            sa.Column('has_used_trial', sa.Boolean, nullable=False, server_default='false')
        )


def downgrade() -> None:
    op.drop_column('user_quotas', 'trial_start_at')
    op.drop_column('user_quotas', 'trial_ends_at')
    op.drop_column('user_quotas', 'has_used_trial')
    op.drop_column('tenants', 'trial_start_at')
    op.drop_column('tenants', 'has_used_trial')


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    from sqlalchemy import inspect
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns
