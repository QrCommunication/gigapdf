"""
SQLAlchemy database models for persistent storage.

Provides database models for documents, versions, users, and quotas.
"""

from datetime import datetime
from typing import Optional
from uuid import uuid4

from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all database models."""

    pass


class StoredDocument(Base):
    """
    Persistent document storage.

    Stores documents that users save for later access,
    with versioning support.
    """

    __tablename__ = "stored_documents"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    folder_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), ForeignKey("folders.id", ondelete="SET NULL"), nullable=True
    )
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    file_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    mime_type: Mapped[str] = mapped_column(String(100), default="application/pdf")
    tags: Mapped[Optional[dict]] = mapped_column(JSON, default=list)
    metadata_cache: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    thumbnail_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    versions: Mapped[list["DocumentVersion"]] = relationship(
        "DocumentVersion", back_populates="document", cascade="all, delete-orphan"
    )
    folder: Mapped[Optional["Folder"]] = relationship("Folder", back_populates="documents")
    tenant_shares: Mapped[list["TenantDocument"]] = relationship(
        "TenantDocument", back_populates="document", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_stored_documents_owner", "owner_id"),
        Index("idx_stored_documents_folder", "folder_id"),
        Index("idx_stored_documents_deleted", "is_deleted"),
    )


class DocumentVersion(Base):
    """
    Document version for history tracking.

    Each save creates a new version, allowing rollback.
    """

    __tablename__ = "document_versions"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    document_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("stored_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)  # SHA-256
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )

    # Encryption fields for AES-256-GCM at rest encryption
    encryption_key: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="Base64-encoded encrypted DEK for this version"
    )
    is_encrypted: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, comment="Whether document is encrypted at rest"
    )

    # Relationships
    document: Mapped["StoredDocument"] = relationship(
        "StoredDocument", back_populates="versions"
    )

    __table_args__ = (
        Index("idx_document_versions_document", "document_id"),
        Index("idx_document_versions_number", "document_id", "version_number", unique=True),
    )


class Folder(Base):
    """
    Folder for organizing documents.

    Supports nested folder hierarchy.
    """

    __tablename__ = "folders"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    parent_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), ForeignKey("folders.id", ondelete="CASCADE"), nullable=True
    )
    path: Mapped[str] = mapped_column(String(1000), default="/")  # Materialized path
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    documents: Mapped[list["StoredDocument"]] = relationship(
        "StoredDocument", back_populates="folder"
    )
    children: Mapped[list["Folder"]] = relationship(
        "Folder", back_populates="parent", cascade="all, delete-orphan"
    )
    parent: Mapped[Optional["Folder"]] = relationship(
        "Folder", back_populates="children", remote_side=[id]
    )

    __table_args__ = (
        Index("idx_folders_owner", "owner_id"),
        Index("idx_folders_parent", "parent_id"),
    )


class UserQuota(Base):
    """
    Storage and API quota tracking per user.

    Free tier:
    - Storage: 5GB
    - API calls: 1000/month
    """

    __tablename__ = "user_quotas"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Storage quotas
    storage_used_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    storage_limit_bytes: Mapped[int] = mapped_column(
        BigInteger, default=5 * 1024 * 1024 * 1024  # 5GB free tier
    )
    document_count: Mapped[int] = mapped_column(Integer, default=0)
    document_limit: Mapped[int] = mapped_column(Integer, default=1000)

    # API call quotas (monthly)
    api_calls_used: Mapped[int] = mapped_column(Integer, default=0)
    api_calls_limit: Mapped[int] = mapped_column(Integer, default=1000)  # 1000/month free
    api_calls_reset_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )

    # Plan info
    plan_type: Mapped[str] = mapped_column(
        String(20), default="free"  # free, pro, enterprise
    )
    plan_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Stripe subscription fields
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, unique=True, index=True
    )
    stripe_subscription_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    subscription_status: Mapped[str] = mapped_column(
        String(50), default="none"  # none, active, canceled, past_due, trialing, incomplete
    )
    current_period_end: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)

    # Trial period fields
    trial_start_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    trial_ends_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    has_used_trial: Mapped[bool] = mapped_column(Boolean, default=False)

    # Account suspension (for payment failures)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    suspended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    suspension_reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Payment failure tracking
    payment_failed_count: Mapped[int] = mapped_column(Integer, default=0)
    last_payment_failed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    tenant_memberships: Mapped[list["TenantMember"]] = relationship(
        "TenantMember", back_populates="user", cascade="all, delete-orphan"
    )


class DocumentShareInvitation(Base):
    """
    Document share invitation for email-based sharing workflow.

    When a user shares a document by email, an invitation is created.
    The invitee can accept or decline the invitation.
    """

    __tablename__ = "document_share_invitations"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    document_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("stored_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    inviter_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    invitee_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    invitee_user_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, index=True  # Populated when user accepts/is found
    )
    token: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    permission: Mapped[str] = mapped_column(
        String(20), default="edit"  # view, edit (default is edit per user request)
    )
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), default="pending"  # pending, accepted, declined, revoked, expired
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    responded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )

    # Relationships
    document: Mapped["StoredDocument"] = relationship(
        "StoredDocument", backref="share_invitations"
    )
    shares: Mapped[list["DocumentShare"]] = relationship(
        "DocumentShare", back_populates="invitation"
    )

    __table_args__ = (
        Index("idx_share_invitations_document", "document_id"),
        Index("idx_share_invitations_inviter", "inviter_id"),
        Index("idx_share_invitations_invitee_email", "invitee_email"),
        Index("idx_share_invitations_invitee_user", "invitee_user_id"),
        Index("idx_share_invitations_status", "status"),
        Index("idx_share_invitations_token", "token", unique=True),
    )


class ShareNotification(Base):
    """
    In-app notifications for sharing events.

    Notifies users about share invitations, acceptances, revocations, etc.
    """

    __tablename__ = "share_notifications"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    notification_type: Mapped[str] = mapped_column(
        String(50), nullable=False
        # Types: share_invitation, share_accepted, share_declined, share_revoked, permission_changed
    )
    document_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("stored_documents.id", ondelete="CASCADE"),
        nullable=True,
    )
    share_invitation_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("document_share_invitations.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extra_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )

    # Relationships
    document: Mapped[Optional["StoredDocument"]] = relationship(
        "StoredDocument", backref="share_notifications"
    )
    invitation: Mapped[Optional["DocumentShareInvitation"]] = relationship(
        "DocumentShareInvitation", backref="notifications"
    )

    __table_args__ = (
        Index("idx_share_notifications_user", "user_id"),
        Index("idx_share_notifications_read", "is_read"),
        Index("idx_share_notifications_created", "created_at"),
        Index("idx_share_notifications_user_unread", "user_id", "is_read"),
    )


class DocumentShare(Base):
    """
    Document sharing permissions.

    Allows sharing documents with other users.
    Supports both direct shares and shares created via invitation workflow.
    """

    __tablename__ = "document_shares"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    document_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("stored_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    shared_with_user_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True  # NULL for public link
    )
    share_token: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, unique=True  # For public links
    )
    permission: Mapped[str] = mapped_column(
        String(20), default="edit"  # view, edit (default changed to edit)
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )

    # New fields for enhanced sharing workflow
    status: Mapped[str] = mapped_column(
        String(20), default="active"  # active, revoked
    )
    invitation_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("document_share_invitations.id", ondelete="SET NULL"),
        nullable=True,
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Relationships
    invitation: Mapped[Optional["DocumentShareInvitation"]] = relationship(
        "DocumentShareInvitation", back_populates="shares"
    )

    __table_args__ = (
        Index("idx_document_shares_document", "document_id"),
        Index("idx_document_shares_user", "shared_with_user_id"),
        Index("idx_document_shares_token", "share_token"),
        Index("idx_document_shares_status", "status"),
    )


class AsyncJob(Base):
    """
    Async job tracking for long-running operations.

    Tracks OCR, export, merge, split jobs.
    """

    __tablename__ = "async_jobs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    celery_task_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    job_type: Mapped[str] = mapped_column(
        String(50), nullable=False  # ocr, export, merge, split, upload
    )
    status: Mapped[str] = mapped_column(
        String(20), default="pending"  # pending, processing, completed, failed, cancelled
    )
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    document_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    owner_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    input_params: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    result: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    error_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_async_jobs_owner", "owner_id"),
        Index("idx_async_jobs_status", "status"),
        Index("idx_async_jobs_type", "job_type"),
    )


class CollaborationSession(Base):
    """
    Real-time collaboration session tracking.
    """

    __tablename__ = "collaboration_sessions"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    document_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    user_name: Mapped[str] = mapped_column(String(255), nullable=False)
    user_color: Mapped[str] = mapped_column(String(7), default="#3B82F6")  # Hex color
    socket_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cursor_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cursor_x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cursor_y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_collab_sessions_document", "document_id"),
        Index("idx_collab_sessions_active", "document_id", "is_active"),
    )


class ElementLock(Base):
    """
    Element lock for collaborative editing.

    Prevents concurrent edits to the same element.
    """

    __tablename__ = "element_locks"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    document_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    element_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    locked_by_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    locked_by_session_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    locked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("idx_element_locks_document", "document_id"),
        Index("idx_element_locks_element", "document_id", "element_id", unique=True),
    )


class Plan(Base):
    """
    Subscription plan definition.

    Stores all plan configurations including pricing, limits, and features.
    Allows dynamic plan management via admin panel.
    """

    __tablename__ = "plans"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Pricing
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    interval: Mapped[str] = mapped_column(String(10), default="month")  # month, year
    stripe_product_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    stripe_price_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    stripe_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Limits
    storage_limit_bytes: Mapped[int] = mapped_column(
        BigInteger, default=5 * 1024 * 1024 * 1024  # 5GB
    )
    api_calls_limit: Mapped[int] = mapped_column(Integer, default=1000)
    document_limit: Mapped[int] = mapped_column(Integer, default=100)

    # Tenant/Enterprise plan settings
    is_tenant_plan: Mapped[bool] = mapped_column(Boolean, default=False)
    max_members: Mapped[int] = mapped_column(Integer, default=1)  # For tenant plans
    linked_tenant_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True, index=True
    )  # If set, plan is exclusive to this tenant (private plan)

    # Features (JSON for flexibility)
    features: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Status and display
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_popular: Mapped[bool] = mapped_column(Boolean, default=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    cta_text: Mapped[str] = mapped_column(String(50), default="Get Started")

    # Trial settings
    trial_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    tenants: Mapped[list["Tenant"]] = relationship(
        "Tenant", back_populates="plan", foreign_keys="Tenant.plan_id"
    )

    __table_args__ = (
        Index("idx_plans_slug", "slug", unique=True),
        Index("idx_plans_active", "is_active"),
        Index("idx_plans_order", "display_order"),
        Index("idx_plans_tenant", "is_tenant_plan"),
        Index("idx_plans_linked_tenant", "linked_tenant_id"),
    )


class ActivityLog(Base):
    """
    Activity log for document audit trail.

    Tracks all actions performed on documents for audit purposes.
    Only users with access to the document can view its activity history.
    """

    __tablename__ = "activity_logs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )

    # Document reference (nullable for tenant-level actions)
    document_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("stored_documents.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Who performed the action
    user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    user_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    user_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Action details
    action: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # create, view, download, edit, rename, delete, share, unshare, export, restore

    # Resource type
    resource_type: Mapped[str] = mapped_column(
        String(50), default="document"
    )  # document, folder, tenant, user

    # Additional data (JSON for flexibility)
    extra_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # Examples:
    # - rename: {"old_name": "...", "new_name": "..."}
    # - share: {"shared_with": "email@...", "permission": "view"}
    # - export: {"format": "pdf", "pages": "1-5"}
    # - edit: {"changes": [...], "version": 2}

    # IP and user agent for security audits
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Tenant context (for tenant-level audit)
    tenant_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True, index=True
    )

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )

    # Relationships
    document: Mapped[Optional["StoredDocument"]] = relationship(
        "StoredDocument", backref="activity_logs"
    )

    __table_args__ = (
        Index("idx_activity_logs_document", "document_id"),
        Index("idx_activity_logs_user", "user_id"),
        Index("idx_activity_logs_action", "action"),
        Index("idx_activity_logs_created", "created_at"),
        Index("idx_activity_logs_tenant", "tenant_id"),
        Index("idx_activity_logs_document_created", "document_id", "created_at"),
    )


# Import tenant models at the end to resolve forward references
# This ensures TenantDocument is registered when the mapper is configured
from app.models.tenant import TenantDocument, Tenant, TenantMember  # noqa: E402, F401
