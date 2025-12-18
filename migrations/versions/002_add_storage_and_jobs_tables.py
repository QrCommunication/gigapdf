"""Add storage and jobs tables

Revision ID: 002_storage_jobs
Revises: 001_collaboration
Create Date: 2025-12-18

This migration adds tables for document storage and async jobs:
- folders: Document folder hierarchy
- stored_documents: Persistent document storage
- document_versions: Document version history
- user_quotas: Storage quota tracking
- document_shares: Document sharing permissions
- async_jobs: Async job tracking
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON, UUID

# revision identifiers, used by Alembic
revision: str = "002_storage_jobs"
down_revision: Union[str, None] = "001_collaboration"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create storage and jobs tables.
    """
    # Create folders table if not exists
    if not op.get_bind().dialect.has_table(op.get_bind(), "folders"):
        op.create_table(
            "folders",
            sa.Column(
                "id",
                UUID(as_uuid=False),
                nullable=False,
                primary_key=True,
            ),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("owner_id", sa.String(255), nullable=False),
            sa.Column("parent_id", UUID(as_uuid=False), nullable=True),
            sa.Column("path", sa.String(1000), nullable=False, default="/"),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["parent_id"],
                ["folders.id"],
                ondelete="CASCADE",
            ),
        )

        op.create_index("idx_folders_owner", "folders", ["owner_id"])
        op.create_index("idx_folders_parent", "folders", ["parent_id"])

    # Create stored_documents table if not exists
    if not op.get_bind().dialect.has_table(op.get_bind(), "stored_documents"):
        op.create_table(
            "stored_documents",
            sa.Column(
                "id",
                UUID(as_uuid=False),
                nullable=False,
                primary_key=True,
            ),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("owner_id", sa.String(255), nullable=False),
            sa.Column("folder_id", UUID(as_uuid=False), nullable=True),
            sa.Column("page_count", sa.Integer(), nullable=False, default=0),
            sa.Column("current_version", sa.Integer(), nullable=False, default=1),
            sa.Column("file_size_bytes", sa.Integer(), nullable=False, default=0),
            sa.Column("mime_type", sa.String(100), nullable=False, default="application/pdf"),
            sa.Column("tags", JSON, nullable=True),
            sa.Column("metadata_cache", JSON, nullable=True),
            sa.Column("thumbnail_path", sa.String(500), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, default=False),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["folder_id"],
                ["folders.id"],
                ondelete="SET NULL",
            ),
        )

        op.create_index("idx_stored_documents_owner", "stored_documents", ["owner_id"])
        op.create_index("idx_stored_documents_folder", "stored_documents", ["folder_id"])
        op.create_index("idx_stored_documents_deleted", "stored_documents", ["is_deleted"])

    # Create document_versions table if not exists
    if not op.get_bind().dialect.has_table(op.get_bind(), "document_versions"):
        op.create_table(
            "document_versions",
            sa.Column(
                "id",
                UUID(as_uuid=False),
                nullable=False,
                primary_key=True,
            ),
            sa.Column("document_id", UUID(as_uuid=False), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("file_path", sa.String(500), nullable=False),
            sa.Column("file_size_bytes", sa.Integer(), nullable=False, default=0),
            sa.Column("file_hash", sa.String(64), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(255), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["document_id"],
                ["stored_documents.id"],
                ondelete="CASCADE",
            ),
        )

        op.create_index("idx_document_versions_document", "document_versions", ["document_id"])
        op.create_index(
            "idx_document_versions_number",
            "document_versions",
            ["document_id", "version_number"],
            unique=True,
        )

    # Create user_quotas table if not exists
    if not op.get_bind().dialect.has_table(op.get_bind(), "user_quotas"):
        op.create_table(
            "user_quotas",
            sa.Column("user_id", sa.String(255), nullable=False, primary_key=True),
            # Storage quotas
            sa.Column("storage_used_bytes", sa.BigInteger(), nullable=False, default=0),
            sa.Column(
                "storage_limit_bytes",
                sa.BigInteger(),
                nullable=False,
                default=5 * 1024 * 1024 * 1024,  # 5GB free tier
            ),
            sa.Column("document_count", sa.Integer(), nullable=False, default=0),
            sa.Column("document_limit", sa.Integer(), nullable=False, default=1000),
            # API call quotas (monthly)
            sa.Column("api_calls_used", sa.Integer(), nullable=False, default=0),
            sa.Column("api_calls_limit", sa.Integer(), nullable=False, default=1000),  # 1000/month free
            sa.Column(
                "api_calls_reset_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            # Plan info
            sa.Column("plan_type", sa.String(20), nullable=False, default="free"),
            sa.Column("plan_expires_at", sa.DateTime(), nullable=True),
            sa.Column(
                "updated_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    # Create document_shares table if not exists
    if not op.get_bind().dialect.has_table(op.get_bind(), "document_shares"):
        op.create_table(
            "document_shares",
            sa.Column(
                "id",
                UUID(as_uuid=False),
                nullable=False,
                primary_key=True,
            ),
            sa.Column("document_id", UUID(as_uuid=False), nullable=False),
            sa.Column("shared_with_user_id", sa.String(255), nullable=True),
            sa.Column("share_token", sa.String(64), nullable=True, unique=True),
            sa.Column("permission", sa.String(20), nullable=False, default="view"),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.Column("created_by", sa.String(255), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["document_id"],
                ["stored_documents.id"],
                ondelete="CASCADE",
            ),
        )

        op.create_index("idx_document_shares_document", "document_shares", ["document_id"])
        op.create_index("idx_document_shares_user", "document_shares", ["shared_with_user_id"])
        op.create_index("idx_document_shares_token", "document_shares", ["share_token"])

    # Create async_jobs table if not exists
    if not op.get_bind().dialect.has_table(op.get_bind(), "async_jobs"):
        op.create_table(
            "async_jobs",
            sa.Column(
                "id",
                UUID(as_uuid=False),
                nullable=False,
                primary_key=True,
            ),
            sa.Column("celery_task_id", sa.String(255), nullable=True),
            sa.Column("job_type", sa.String(50), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, default="pending"),
            sa.Column("progress", sa.Float(), nullable=False, default=0.0),
            sa.Column("document_id", UUID(as_uuid=False), nullable=True),
            sa.Column("owner_id", sa.String(255), nullable=False),
            sa.Column("input_params", JSON, nullable=True),
            sa.Column("result", JSON, nullable=True),
            sa.Column("error_code", sa.String(50), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

        op.create_index("idx_async_jobs_owner", "async_jobs", ["owner_id"])
        op.create_index("idx_async_jobs_status", "async_jobs", ["status"])
        op.create_index("idx_async_jobs_type", "async_jobs", ["job_type"])


def downgrade() -> None:
    """
    Drop storage and jobs tables.
    """
    tables = [
        "async_jobs",
        "document_shares",
        "user_quotas",
        "document_versions",
        "stored_documents",
        "folders",
    ]

    for table in tables:
        if op.get_bind().dialect.has_table(op.get_bind(), table):
            op.drop_table(table)
