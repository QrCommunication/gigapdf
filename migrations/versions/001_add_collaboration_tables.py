"""Add collaboration tables

Revision ID: 001_collaboration
Revises:
Create Date: 2025-12-18

This migration adds tables for real-time collaboration features:
- collaboration_sessions: Track active users in documents
- element_locks: Manage element locks for concurrent editing
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic
revision: str = "001_collaboration"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create collaboration tables.

    Creates:
    - collaboration_sessions table for tracking active users
    - element_locks table for managing edit locks
    """
    # Create collaboration_sessions table if not exists
    if not op.get_bind().dialect.has_table(op.get_bind(), "collaboration_sessions"):
        op.create_table(
            "collaboration_sessions",
            sa.Column(
                "id",
                UUID(as_uuid=False),
                nullable=False,
                primary_key=True,
            ),
            sa.Column("document_id", UUID(as_uuid=False), nullable=False),
            sa.Column("user_id", sa.String(255), nullable=False),
            sa.Column("user_name", sa.String(255), nullable=False),
            sa.Column("user_color", sa.String(7), nullable=False, default="#3B82F6"),
            sa.Column("socket_id", sa.String(255), nullable=True),
            sa.Column("cursor_page", sa.Integer(), nullable=True),
            sa.Column("cursor_x", sa.Float(), nullable=True),
            sa.Column("cursor_y", sa.Float(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, default=True),
            sa.Column(
                "joined_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "last_seen_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

        # Create indexes for collaboration_sessions
        op.create_index(
            "idx_collab_sessions_document",
            "collaboration_sessions",
            ["document_id"],
        )
        op.create_index(
            "idx_collab_sessions_active",
            "collaboration_sessions",
            ["document_id", "is_active"],
        )

    # Create element_locks table if not exists
    if not op.get_bind().dialect.has_table(op.get_bind(), "element_locks"):
        op.create_table(
            "element_locks",
            sa.Column(
                "id",
                UUID(as_uuid=False),
                nullable=False,
                primary_key=True,
            ),
            sa.Column("document_id", UUID(as_uuid=False), nullable=False),
            sa.Column("element_id", UUID(as_uuid=False), nullable=False),
            sa.Column("locked_by_user_id", sa.String(255), nullable=False),
            sa.Column("locked_by_session_id", UUID(as_uuid=False), nullable=False),
            sa.Column(
                "locked_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
        )

        # Create indexes for element_locks
        op.create_index(
            "idx_element_locks_document",
            "element_locks",
            ["document_id"],
        )
        op.create_index(
            "idx_element_locks_element",
            "element_locks",
            ["document_id", "element_id"],
            unique=True,
        )


def downgrade() -> None:
    """
    Drop collaboration tables.

    Removes:
    - element_locks table
    - collaboration_sessions table
    """
    # Drop element_locks table if exists
    if op.get_bind().dialect.has_table(op.get_bind(), "element_locks"):
        op.drop_index("idx_element_locks_element", table_name="element_locks")
        op.drop_index("idx_element_locks_document", table_name="element_locks")
        op.drop_table("element_locks")

    # Drop collaboration_sessions table if exists
    if op.get_bind().dialect.has_table(op.get_bind(), "collaboration_sessions"):
        op.drop_index("idx_collab_sessions_active", table_name="collaboration_sessions")
        op.drop_index("idx_collab_sessions_document", table_name="collaboration_sessions")
        op.drop_table("collaboration_sessions")
