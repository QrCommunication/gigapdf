"""Add Stripe fields to user_quotas table.

Adds fields for Stripe customer and subscription tracking.

Revision ID: 007_stripe_fields
Revises: 006_plan_linked_tenant
Create Date: 2025-01-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '007_stripe_fields'
down_revision: Union[str, None] = '006_plan_linked_tenant'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add stripe_customer_id column
    if not column_exists('user_quotas', 'stripe_customer_id'):
        op.add_column(
            'user_quotas',
            sa.Column('stripe_customer_id', sa.String(255), nullable=True)
        )
        op.create_index(
            'ix_user_quotas_stripe_customer_id',
            'user_quotas',
            ['stripe_customer_id'],
            unique=True
        )

    # Add stripe_subscription_id column
    if not column_exists('user_quotas', 'stripe_subscription_id'):
        op.add_column(
            'user_quotas',
            sa.Column('stripe_subscription_id', sa.String(255), nullable=True)
        )

    # Add subscription_status column
    if not column_exists('user_quotas', 'subscription_status'):
        op.add_column(
            'user_quotas',
            sa.Column('subscription_status', sa.String(50), nullable=False, server_default='none')
        )

    # Add current_period_end column
    if not column_exists('user_quotas', 'current_period_end'):
        op.add_column(
            'user_quotas',
            sa.Column('current_period_end', sa.DateTime, nullable=True)
        )

    # Add cancel_at_period_end column
    if not column_exists('user_quotas', 'cancel_at_period_end'):
        op.add_column(
            'user_quotas',
            sa.Column('cancel_at_period_end', sa.Boolean, nullable=False, server_default='false')
        )


def downgrade() -> None:
    op.drop_index('ix_user_quotas_stripe_customer_id', table_name='user_quotas')
    op.drop_column('user_quotas', 'stripe_customer_id')
    op.drop_column('user_quotas', 'stripe_subscription_id')
    op.drop_column('user_quotas', 'subscription_status')
    op.drop_column('user_quotas', 'current_period_end')
    op.drop_column('user_quotas', 'cancel_at_period_end')


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    from sqlalchemy import inspect
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns
