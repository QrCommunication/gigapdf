"""Add encryption_key column to document_versions.

This migration adds the encrypted Data Encryption Key (DEK) column
to store the per-document encryption key encrypted with the master KEK.

Revision ID: 012_encryption_key
Revises: 011_activity_logs
Create Date: 2024-12-18

Security:
- Each document has a unique DEK for AES-256-GCM encryption
- DEK is encrypted with the master KEK (Key Encryption Key)
- Stored as base64-encoded string (~100 chars)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "012_encryption_key"
down_revision: Union[str, None] = "011_activity_logs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add encryption_key column to document_versions table."""
    # Check if column already exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('document_versions')]

    if 'encryption_key' not in columns:
        op.add_column(
            'document_versions',
            sa.Column(
                'encryption_key',
                sa.Text(),
                nullable=True,  # Nullable for backward compatibility with unencrypted docs
                comment='Base64-encoded encrypted DEK for this document version'
            )
        )

    # Add is_encrypted column to track encryption status
    if 'is_encrypted' not in columns:
        op.add_column(
            'document_versions',
            sa.Column(
                'is_encrypted',
                sa.Boolean(),
                nullable=False,
                server_default='false',
                comment='Whether this document version is encrypted at rest'
            )
        )


def downgrade() -> None:
    """Remove encryption columns from document_versions table."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('document_versions')]

    if 'is_encrypted' in columns:
        op.drop_column('document_versions', 'is_encrypted')

    if 'encryption_key' in columns:
        op.drop_column('document_versions', 'encryption_key')
