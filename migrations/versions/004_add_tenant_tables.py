"""Add tenant tables for multi-tenancy support

Revision ID: 004_add_tenant_tables
Revises: 003_add_plans_table
Create Date: 2025-12-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '004_tenants'
down_revision: Union[str, None] = '003_plans'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types (check if they exist first)
    conn = op.get_bind()

    # Create tenantrole enum if not exists
    result = conn.execute(sa.text("SELECT 1 FROM pg_type WHERE typname = 'tenantrole'"))
    if not result.fetchone():
        op.execute("CREATE TYPE tenantrole AS ENUM ('owner', 'admin', 'manager', 'member', 'viewer')")

    # Create tenantstatus enum if not exists
    result = conn.execute(sa.text("SELECT 1 FROM pg_type WHERE typname = 'tenantstatus'"))
    if not result.fetchone():
        op.execute("CREATE TYPE tenantstatus AS ENUM ('active', 'suspended', 'trial', 'cancelled')")

    # Add id and email columns to user_quotas if they don't exist
    # First check if the columns exist
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('user_quotas')]

    if 'id' not in columns:
        # Add id column
        op.add_column('user_quotas', sa.Column('id', postgresql.UUID(as_uuid=False), nullable=True))
        # Generate UUIDs for existing rows
        op.execute("UPDATE user_quotas SET id = gen_random_uuid() WHERE id IS NULL")
        # Make id not nullable
        op.alter_column('user_quotas', 'id', nullable=False)
        # Add unique constraint on id for foreign key references
        op.create_unique_constraint('uq_user_quotas_id', 'user_quotas', ['id'])

    if 'email' not in columns:
        op.add_column('user_quotas', sa.Column('email', sa.String(255), nullable=True))

    # Create tenants table
    if not table_exists('tenants'):
        op.create_table(
            'tenants',
            sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('slug', sa.String(100), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('logo_url', sa.String(500), nullable=True),
            sa.Column('email', sa.String(255), nullable=False),
            sa.Column('phone', sa.String(50), nullable=True),
            sa.Column('website', sa.String(255), nullable=True),
            sa.Column('address_line1', sa.String(255), nullable=True),
            sa.Column('address_line2', sa.String(255), nullable=True),
            sa.Column('city', sa.String(100), nullable=True),
            sa.Column('state', sa.String(100), nullable=True),
            sa.Column('postal_code', sa.String(20), nullable=True),
            sa.Column('country', sa.String(2), nullable=True),
            sa.Column('plan_id', postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column('status', postgresql.ENUM('active', 'suspended', 'trial', 'cancelled', name='tenantstatus', create_type=False), nullable=False, server_default='trial'),
            sa.Column('trial_ends_at', sa.DateTime(), nullable=True),
            sa.Column('stripe_customer_id', sa.String(255), nullable=True),
            sa.Column('stripe_subscription_id', sa.String(255), nullable=True),
            sa.Column('storage_limit_bytes', sa.BigInteger(), nullable=False, server_default='5368709120'),
            sa.Column('storage_used_bytes', sa.BigInteger(), nullable=False, server_default='0'),
            sa.Column('max_members', sa.Integer(), nullable=False, server_default='5'),
            sa.Column('allow_member_invites', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('require_2fa', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ondelete='SET NULL'),
            sa.UniqueConstraint('slug'),
            sa.UniqueConstraint('stripe_customer_id'),
        )
        op.create_index('ix_tenants_slug', 'tenants', ['slug'])
        op.create_index('ix_tenants_status', 'tenants', ['status'])
        op.create_index('ix_tenants_created_at', 'tenants', ['created_at'])

    # Create tenant_members table
    if not table_exists('tenant_members'):
        op.create_table(
            'tenant_members',
            sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('user_id', postgresql.UUID(as_uuid=False), nullable=False),
            sa.Column('role', postgresql.ENUM('owner', 'admin', 'manager', 'member', 'viewer', name='tenantrole', create_type=False), nullable=False, server_default='member'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('custom_permissions', sa.Text(), nullable=True),
            sa.Column('joined_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('last_active_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['user_quotas.id'], ondelete='CASCADE'),
            sa.UniqueConstraint('tenant_id', 'user_id', name='uq_tenant_member'),
        )
        op.create_index('ix_tenant_members_tenant_id', 'tenant_members', ['tenant_id'])
        op.create_index('ix_tenant_members_user_id', 'tenant_members', ['user_id'])
        op.create_index('ix_tenant_members_role', 'tenant_members', ['role'])

    # Create tenant_documents table
    if not table_exists('tenant_documents'):
        op.create_table(
            'tenant_documents',
            sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('document_id', postgresql.UUID(as_uuid=False), nullable=False),
            sa.Column('added_by_id', postgresql.UUID(as_uuid=False), nullable=False),
            sa.Column('access_level', sa.String(20), nullable=False, server_default='read'),
            sa.Column('added_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['document_id'], ['stored_documents.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['added_by_id'], ['user_quotas.id'], ondelete='CASCADE'),
            sa.UniqueConstraint('tenant_id', 'document_id', name='uq_tenant_document'),
        )
        op.create_index('ix_tenant_documents_tenant_id', 'tenant_documents', ['tenant_id'])
        op.create_index('ix_tenant_documents_document_id', 'tenant_documents', ['document_id'])

    # Create tenant_invitations table
    if not table_exists('tenant_invitations'):
        op.create_table(
            'tenant_invitations',
            sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('email', sa.String(255), nullable=False),
            sa.Column('role', postgresql.ENUM('owner', 'admin', 'manager', 'member', 'viewer', name='tenantrole', create_type=False), nullable=False, server_default='member'),
            sa.Column('token', sa.String(255), nullable=False),
            sa.Column('invited_by_id', postgresql.UUID(as_uuid=False), nullable=False),
            sa.Column('is_accepted', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('accepted_at', sa.DateTime(), nullable=True),
            sa.Column('accepted_by_id', postgresql.UUID(as_uuid=False), nullable=True),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['invited_by_id'], ['user_quotas.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['accepted_by_id'], ['user_quotas.id'], ondelete='SET NULL'),
            sa.UniqueConstraint('token'),
        )
        op.create_index('ix_tenant_invitations_tenant_id', 'tenant_invitations', ['tenant_id'])
        op.create_index('ix_tenant_invitations_email', 'tenant_invitations', ['email'])
        op.create_index('ix_tenant_invitations_token', 'tenant_invitations', ['token'])


def downgrade() -> None:
    op.drop_table('tenant_invitations')
    op.drop_table('tenant_documents')
    op.drop_table('tenant_members')
    op.drop_table('tenants')

    # Drop columns from user_quotas
    op.drop_column('user_quotas', 'email')
    op.drop_column('user_quotas', 'id')

    # Drop enum types
    op.execute("DROP TYPE IF EXISTS tenantstatus")
    op.execute("DROP TYPE IF EXISTS tenantrole")


def table_exists(table_name: str) -> bool:
    """Check if a table exists in the database."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    return table_name in inspector.get_table_names()
