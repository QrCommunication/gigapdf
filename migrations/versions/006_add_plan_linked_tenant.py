"""Add linked_tenant_id to plans table.

Allows plans to be exclusive to a specific tenant (private plans).

Revision ID: 006_plan_linked_tenant
Revises: 005_tenant_plan_features
Create Date: 2025-01-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '006_plan_linked_tenant'
down_revision: Union[str, None] = '005_tenant_plan_features'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add linked_tenant_id column to plans table
    if not column_exists('plans', 'linked_tenant_id'):
        op.add_column(
            'plans',
            sa.Column('linked_tenant_id', postgresql.UUID(as_uuid=False), nullable=True)
        )
        op.create_index(
            'idx_plans_linked_tenant',
            'plans',
            ['linked_tenant_id'],
            unique=False
        )


def downgrade() -> None:
    op.drop_index('idx_plans_linked_tenant', table_name='plans')
    op.drop_column('plans', 'linked_tenant_id')


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    from sqlalchemy import inspect
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns
