"""Convert all timestamp columns to TIMESTAMP WITH TIME ZONE.

This ensures proper timezone handling for accurate datetime tracking
across all tables: creation, modification, deletion times.

Revision ID: 010_convert_timestamps_to_timestamptz
Revises: 009_stripe_product
Create Date: 2024-12-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TIMESTAMP

# revision identifiers
revision = "010_convert_timestamps_to_timestamptz"
down_revision = "009_stripe_product"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    from sqlalchemy import inspect
    bind = op.get_bind()
    inspector = inspect(bind)
    try:
        columns = [col["name"] for col in inspector.get_columns(table_name)]
        return column_name in columns
    except Exception:
        return False


def _table_exists(table_name: str) -> bool:
    """Check if a table exists."""
    from sqlalchemy import inspect
    bind = op.get_bind()
    inspector = inspect(bind)
    return table_name in inspector.get_table_names()


def _alter_column_to_timestamptz(table_name: str, column_name: str) -> None:
    """Safely alter a column to TIMESTAMP WITH TIME ZONE."""
    if _table_exists(table_name) and _column_exists(table_name, column_name):
        op.execute(f"""
            ALTER TABLE {table_name}
            ALTER COLUMN {column_name} TYPE TIMESTAMP WITH TIME ZONE
            USING {column_name} AT TIME ZONE 'UTC'
        """)


def _alter_column_to_timestamp(table_name: str, column_name: str) -> None:
    """Safely alter a column back to TIMESTAMP WITHOUT TIME ZONE."""
    if _table_exists(table_name) and _column_exists(table_name, column_name):
        op.execute(f"""
            ALTER TABLE {table_name}
            ALTER COLUMN {column_name} TYPE TIMESTAMP WITHOUT TIME ZONE
        """)


def upgrade() -> None:
    """Convert TIMESTAMP WITHOUT TIME ZONE to TIMESTAMP WITH TIME ZONE."""

    # stored_documents table
    _alter_column_to_timestamptz("stored_documents", "created_at")
    _alter_column_to_timestamptz("stored_documents", "updated_at")
    _alter_column_to_timestamptz("stored_documents", "deleted_at")

    # document_versions table
    _alter_column_to_timestamptz("document_versions", "created_at")

    # folders table
    _alter_column_to_timestamptz("folders", "created_at")
    _alter_column_to_timestamptz("folders", "updated_at")

    # user_quotas table
    _alter_column_to_timestamptz("user_quotas", "updated_at")
    _alter_column_to_timestamptz("user_quotas", "api_calls_reset_at")
    _alter_column_to_timestamptz("user_quotas", "plan_expires_at")
    _alter_column_to_timestamptz("user_quotas", "current_period_end")
    _alter_column_to_timestamptz("user_quotas", "trial_start_at")
    _alter_column_to_timestamptz("user_quotas", "trial_ends_at")
    _alter_column_to_timestamptz("user_quotas", "suspended_at")
    _alter_column_to_timestamptz("user_quotas", "last_payment_failed_at")

    # async_jobs table
    _alter_column_to_timestamptz("async_jobs", "created_at")
    _alter_column_to_timestamptz("async_jobs", "started_at")
    _alter_column_to_timestamptz("async_jobs", "completed_at")

    # plans table
    _alter_column_to_timestamptz("plans", "created_at")
    _alter_column_to_timestamptz("plans", "updated_at")
    _alter_column_to_timestamptz("plans", "stripe_synced_at")

    # tenants table
    _alter_column_to_timestamptz("tenants", "created_at")
    _alter_column_to_timestamptz("tenants", "updated_at")
    _alter_column_to_timestamptz("tenants", "trial_ends_at")

    # tenant_members table
    _alter_column_to_timestamptz("tenant_members", "joined_at")

    # tenant_documents table
    _alter_column_to_timestamptz("tenant_documents", "shared_at")
    _alter_column_to_timestamptz("tenant_documents", "created_at")
    _alter_column_to_timestamptz("tenant_documents", "updated_at")

    # tenant_quotas table
    _alter_column_to_timestamptz("tenant_quotas", "updated_at")

    # tenant_invitations table
    _alter_column_to_timestamptz("tenant_invitations", "accepted_at")
    _alter_column_to_timestamptz("tenant_invitations", "expires_at")
    _alter_column_to_timestamptz("tenant_invitations", "created_at")

    # collaboration_sessions table
    _alter_column_to_timestamptz("collaboration_sessions", "joined_at")
    _alter_column_to_timestamptz("collaboration_sessions", "last_seen_at")

    # element_locks table
    _alter_column_to_timestamptz("element_locks", "locked_at")
    _alter_column_to_timestamptz("element_locks", "expires_at")

    # document_shares table
    _alter_column_to_timestamptz("document_shares", "expires_at")
    _alter_column_to_timestamptz("document_shares", "created_at")


def downgrade() -> None:
    """Revert TIMESTAMP WITH TIME ZONE back to TIMESTAMP WITHOUT TIME ZONE."""

    # stored_documents table
    _alter_column_to_timestamp("stored_documents", "created_at")
    _alter_column_to_timestamp("stored_documents", "updated_at")
    _alter_column_to_timestamp("stored_documents", "deleted_at")

    # document_versions table
    _alter_column_to_timestamp("document_versions", "created_at")

    # folders table
    _alter_column_to_timestamp("folders", "created_at")
    _alter_column_to_timestamp("folders", "updated_at")

    # user_quotas table
    _alter_column_to_timestamp("user_quotas", "updated_at")
    _alter_column_to_timestamp("user_quotas", "api_calls_reset_at")
    _alter_column_to_timestamp("user_quotas", "plan_expires_at")
    _alter_column_to_timestamp("user_quotas", "current_period_end")
    _alter_column_to_timestamp("user_quotas", "trial_start_at")
    _alter_column_to_timestamp("user_quotas", "trial_ends_at")
    _alter_column_to_timestamp("user_quotas", "suspended_at")
    _alter_column_to_timestamp("user_quotas", "last_payment_failed_at")

    # async_jobs table
    _alter_column_to_timestamp("async_jobs", "created_at")
    _alter_column_to_timestamp("async_jobs", "started_at")
    _alter_column_to_timestamp("async_jobs", "completed_at")

    # plans table
    _alter_column_to_timestamp("plans", "created_at")
    _alter_column_to_timestamp("plans", "updated_at")
    _alter_column_to_timestamp("plans", "stripe_synced_at")

    # tenants table
    _alter_column_to_timestamp("tenants", "created_at")
    _alter_column_to_timestamp("tenants", "updated_at")
    _alter_column_to_timestamp("tenants", "trial_ends_at")

    # tenant_members table
    _alter_column_to_timestamp("tenant_members", "joined_at")

    # tenant_documents table
    _alter_column_to_timestamp("tenant_documents", "shared_at")
    _alter_column_to_timestamp("tenant_documents", "created_at")
    _alter_column_to_timestamp("tenant_documents", "updated_at")

    # tenant_quotas table
    _alter_column_to_timestamp("tenant_quotas", "updated_at")

    # tenant_invitations table
    _alter_column_to_timestamp("tenant_invitations", "accepted_at")
    _alter_column_to_timestamp("tenant_invitations", "expires_at")
    _alter_column_to_timestamp("tenant_invitations", "created_at")

    # collaboration_sessions table
    _alter_column_to_timestamp("collaboration_sessions", "joined_at")
    _alter_column_to_timestamp("collaboration_sessions", "last_seen_at")

    # element_locks table
    _alter_column_to_timestamp("element_locks", "locked_at")
    _alter_column_to_timestamp("element_locks", "expires_at")

    # document_shares table
    _alter_column_to_timestamp("document_shares", "expires_at")
    _alter_column_to_timestamp("document_shares", "created_at")
