"""Add sharing tables for document collaboration.

This migration adds tables for document sharing invitations, notifications,
and extends the existing document_shares table with additional fields.

Revision ID: 013_add_sharing_tables
Revises: 012_encryption_key
Create Date: 2024-12-20

Features:
- Document share invitations with email workflow
- In-app notifications for sharing events
- Enhanced document_shares with status tracking
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision: str = "013_add_sharing_tables"
down_revision: Union[str, None] = "012_encryption_key"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create sharing tables and add columns to document_shares."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # Create document_share_invitations table
    if 'document_share_invitations' not in existing_tables:
        op.create_table(
            'document_share_invitations',
            sa.Column('id', sa.Text(), nullable=False),
            sa.Column('document_id', sa.Text(), nullable=False),
            sa.Column('inviter_id', sa.Text(), nullable=False),
            sa.Column('invitee_email', sa.Text(), nullable=False),
            sa.Column('invitee_user_id', sa.Text(), nullable=True),
            sa.Column('token', sa.Text(), nullable=False),
            sa.Column(
                'permission',
                sa.Text(),
                nullable=False,
                server_default='edit',
                comment='Permission level: view or edit'
            ),
            sa.Column('message', sa.Text(), nullable=True),
            sa.Column(
                'status',
                sa.Text(),
                nullable=False,
                server_default='pending',
                comment='Status: pending, accepted, declined, revoked, expired'
            ),
            sa.Column(
                'created_at',
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text('NOW()')
            ),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(
                ['document_id'],
                ['stored_documents.id'],
                ondelete='CASCADE'
            ),
            sa.UniqueConstraint('token', name='uq_share_invitations_token')
        )

        # Create indexes for document_share_invitations
        op.create_index(
            'ix_share_invitations_document_id',
            'document_share_invitations',
            ['document_id']
        )
        op.create_index(
            'ix_share_invitations_inviter_id',
            'document_share_invitations',
            ['inviter_id']
        )
        op.create_index(
            'ix_share_invitations_invitee_email',
            'document_share_invitations',
            ['invitee_email']
        )
        op.create_index(
            'ix_share_invitations_invitee_user_id',
            'document_share_invitations',
            ['invitee_user_id']
        )
        op.create_index(
            'ix_share_invitations_status',
            'document_share_invitations',
            ['status']
        )

    # Create share_notifications table
    if 'share_notifications' not in existing_tables:
        op.create_table(
            'share_notifications',
            sa.Column('id', sa.Text(), nullable=False),
            sa.Column('user_id', sa.Text(), nullable=False),
            sa.Column(
                'notification_type',
                sa.Text(),
                nullable=False,
                comment='Type: share_invitation, share_accepted, share_declined, share_revoked, permission_changed'
            ),
            sa.Column('document_id', sa.Text(), nullable=True),
            sa.Column('share_invitation_id', sa.Text(), nullable=True),
            sa.Column('title', sa.Text(), nullable=False),
            sa.Column('message', sa.Text(), nullable=True),
            sa.Column(
                'metadata',
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
                comment='Additional notification data'
            ),
            sa.Column(
                'is_read',
                sa.Boolean(),
                nullable=False,
                server_default='false'
            ),
            sa.Column(
                'created_at',
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text('NOW()')
            ),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(
                ['document_id'],
                ['stored_documents.id'],
                ondelete='CASCADE'
            ),
            sa.ForeignKeyConstraint(
                ['share_invitation_id'],
                ['document_share_invitations.id'],
                ondelete='SET NULL'
            )
        )

        # Create indexes for share_notifications
        op.create_index(
            'ix_share_notifications_user_id',
            'share_notifications',
            ['user_id']
        )
        op.create_index(
            'ix_share_notifications_is_read',
            'share_notifications',
            ['is_read']
        )
        op.create_index(
            'ix_share_notifications_created_at',
            'share_notifications',
            ['created_at']
        )
        op.create_index(
            'ix_share_notifications_user_unread',
            'share_notifications',
            ['user_id', 'is_read'],
            postgresql_where=sa.text("is_read = false")
        )

    # Add new columns to document_shares table
    if 'document_shares' in existing_tables:
        columns = [col['name'] for col in inspector.get_columns('document_shares')]

        if 'status' not in columns:
            op.add_column(
                'document_shares',
                sa.Column(
                    'status',
                    sa.Text(),
                    nullable=False,
                    server_default='active',
                    comment='Status: active, revoked'
                )
            )

        if 'invitation_id' not in columns:
            op.add_column(
                'document_shares',
                sa.Column('invitation_id', sa.Text(), nullable=True)
            )
            # Add foreign key constraint
            op.create_foreign_key(
                'fk_document_shares_invitation_id',
                'document_shares',
                'document_share_invitations',
                ['invitation_id'],
                ['id'],
                ondelete='SET NULL'
            )

        if 'revoked_at' not in columns:
            op.add_column(
                'document_shares',
                sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True)
            )

        if 'revoked_by' not in columns:
            op.add_column(
                'document_shares',
                sa.Column('revoked_by', sa.Text(), nullable=True)
            )

        # Create index for status column
        op.create_index(
            'ix_document_shares_status',
            'document_shares',
            ['status']
        )


def downgrade() -> None:
    """Remove sharing tables and columns."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # Remove columns from document_shares
    if 'document_shares' in existing_tables:
        columns = [col['name'] for col in inspector.get_columns('document_shares')]

        # Drop index first
        try:
            op.drop_index('ix_document_shares_status', table_name='document_shares')
        except Exception:
            pass

        if 'revoked_by' in columns:
            op.drop_column('document_shares', 'revoked_by')

        if 'revoked_at' in columns:
            op.drop_column('document_shares', 'revoked_at')

        if 'invitation_id' in columns:
            try:
                op.drop_constraint(
                    'fk_document_shares_invitation_id',
                    'document_shares',
                    type_='foreignkey'
                )
            except Exception:
                pass
            op.drop_column('document_shares', 'invitation_id')

        if 'status' in columns:
            op.drop_column('document_shares', 'status')

    # Drop share_notifications table
    if 'share_notifications' in existing_tables:
        op.drop_table('share_notifications')

    # Drop document_share_invitations table
    if 'document_share_invitations' in existing_tables:
        op.drop_table('document_share_invitations')
