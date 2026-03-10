"""Add activity_logs table for document audit trail.

This table tracks all actions performed on documents for audit purposes.
Only users with access to the document can view its activity history.

Revision ID: 011_add_activity_logs_table
Revises: 010_convert_timestamps_to_timestamptz
Create Date: 2024-12-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "011_add_activity_logs_table"
down_revision = "010_convert_timestamps_to_timestamptz"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create activity_logs table."""
    # Check if table already exists
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'activity_logs')"
        )
    )
    if result.scalar():
        return

    op.create_table(
        "activity_logs",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "document_id",
            UUID(as_uuid=False),
            sa.ForeignKey("stored_documents.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column("user_email", sa.String(255), nullable=True),
        sa.Column("user_name", sa.String(255), nullable=True),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("resource_type", sa.String(50), default="document"),
        sa.Column("extra_data", sa.JSON, nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("tenant_id", UUID(as_uuid=False), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # Create indexes
    op.create_index("idx_activity_logs_document", "activity_logs", ["document_id"])
    op.create_index("idx_activity_logs_user", "activity_logs", ["user_id"])
    op.create_index("idx_activity_logs_action", "activity_logs", ["action"])
    op.create_index("idx_activity_logs_created", "activity_logs", ["created_at"])
    op.create_index("idx_activity_logs_tenant", "activity_logs", ["tenant_id"])
    op.create_index(
        "idx_activity_logs_document_created",
        "activity_logs",
        ["document_id", "created_at"],
    )


def downgrade() -> None:
    """Drop activity_logs table."""
    op.drop_index("idx_activity_logs_document_created", table_name="activity_logs")
    op.drop_index("idx_activity_logs_tenant", table_name="activity_logs")
    op.drop_index("idx_activity_logs_created", table_name="activity_logs")
    op.drop_index("idx_activity_logs_action", table_name="activity_logs")
    op.drop_index("idx_activity_logs_user", table_name="activity_logs")
    op.drop_index("idx_activity_logs_document", table_name="activity_logs")
    op.drop_table("activity_logs")
