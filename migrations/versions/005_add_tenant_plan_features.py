"""Add tenant plan features - enterprise plans and tenant limits

Revision ID: 005_tenant_plan_features
Revises: 004_tenants
Create Date: 2025-12-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '005_tenant_plan_features'
down_revision: Union[str, None] = '004_tenants'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # Add columns to plans table
    plan_columns = [col['name'] for col in inspector.get_columns('plans')]

    if 'is_tenant_plan' not in plan_columns:
        op.add_column('plans', sa.Column('is_tenant_plan', sa.Boolean(), nullable=False, server_default='false'))

    if 'max_members' not in plan_columns:
        op.add_column('plans', sa.Column('max_members', sa.Integer(), nullable=False, server_default='1'))

    # Create index for is_tenant_plan if not exists
    indexes = [idx['name'] for idx in inspector.get_indexes('plans')]
    if 'idx_plans_tenant' not in indexes:
        op.create_index('idx_plans_tenant', 'plans', ['is_tenant_plan'])

    # Add columns to tenants table
    tenant_columns = [col['name'] for col in inspector.get_columns('tenants')]

    if 'api_calls_limit' not in tenant_columns:
        op.add_column('tenants', sa.Column('api_calls_limit', sa.Integer(), nullable=False, server_default='10000'))

    if 'api_calls_used' not in tenant_columns:
        op.add_column('tenants', sa.Column('api_calls_used', sa.Integer(), nullable=False, server_default='0'))

    if 'api_calls_reset_at' not in tenant_columns:
        op.add_column('tenants', sa.Column('api_calls_reset_at', sa.DateTime(), nullable=True))

    if 'document_limit' not in tenant_columns:
        op.add_column('tenants', sa.Column('document_limit', sa.Integer(), nullable=False, server_default='1000'))

    if 'document_count' not in tenant_columns:
        op.add_column('tenants', sa.Column('document_count', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    # Remove columns from tenants table
    op.drop_column('tenants', 'document_count')
    op.drop_column('tenants', 'document_limit')
    op.drop_column('tenants', 'api_calls_reset_at')
    op.drop_column('tenants', 'api_calls_used')
    op.drop_column('tenants', 'api_calls_limit')

    # Remove columns from plans table
    op.drop_index('idx_plans_tenant', table_name='plans')
    op.drop_column('plans', 'max_members')
    op.drop_column('plans', 'is_tenant_plan')
