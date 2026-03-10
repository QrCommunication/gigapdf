"""
Tenant (Organization) models for multi-tenancy support.

Tenants allow users to belong to organizations and share documents,
storage, and collaborate with defined permissions.
"""

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.models.database import Base


class TenantRole(str, Enum):
    """Roles within a tenant organization."""
    OWNER = "owner"           # Full control, can delete tenant
    ADMIN = "admin"           # Manage members, settings, all documents
    MANAGER = "manager"       # Manage documents, view members
    MEMBER = "member"         # Access shared documents
    VIEWER = "viewer"         # Read-only access


class TenantPermission(str, Enum):
    """Granular permissions for tenant members."""
    # Document permissions
    VIEW_DOCUMENTS = "view_documents"
    CREATE_DOCUMENTS = "create_documents"
    EDIT_DOCUMENTS = "edit_documents"
    DELETE_DOCUMENTS = "delete_documents"
    SHARE_DOCUMENTS = "share_documents"

    # Member permissions
    VIEW_MEMBERS = "view_members"
    INVITE_MEMBERS = "invite_members"
    REMOVE_MEMBERS = "remove_members"
    CHANGE_ROLES = "change_roles"

    # Settings permissions
    VIEW_SETTINGS = "view_settings"
    EDIT_SETTINGS = "edit_settings"
    VIEW_BILLING = "view_billing"
    MANAGE_BILLING = "manage_billing"

    # Storage permissions
    VIEW_STORAGE = "view_storage"
    MANAGE_STORAGE = "manage_storage"


# Default permissions per role
ROLE_PERMISSIONS = {
    TenantRole.OWNER: list(TenantPermission),  # All permissions
    TenantRole.ADMIN: [
        TenantPermission.VIEW_DOCUMENTS,
        TenantPermission.CREATE_DOCUMENTS,
        TenantPermission.EDIT_DOCUMENTS,
        TenantPermission.DELETE_DOCUMENTS,
        TenantPermission.SHARE_DOCUMENTS,
        TenantPermission.VIEW_MEMBERS,
        TenantPermission.INVITE_MEMBERS,
        TenantPermission.REMOVE_MEMBERS,
        TenantPermission.CHANGE_ROLES,
        TenantPermission.VIEW_SETTINGS,
        TenantPermission.EDIT_SETTINGS,
        TenantPermission.VIEW_BILLING,
        TenantPermission.VIEW_STORAGE,
        TenantPermission.MANAGE_STORAGE,
    ],
    TenantRole.MANAGER: [
        TenantPermission.VIEW_DOCUMENTS,
        TenantPermission.CREATE_DOCUMENTS,
        TenantPermission.EDIT_DOCUMENTS,
        TenantPermission.DELETE_DOCUMENTS,
        TenantPermission.SHARE_DOCUMENTS,
        TenantPermission.VIEW_MEMBERS,
        TenantPermission.VIEW_SETTINGS,
        TenantPermission.VIEW_STORAGE,
    ],
    TenantRole.MEMBER: [
        TenantPermission.VIEW_DOCUMENTS,
        TenantPermission.CREATE_DOCUMENTS,
        TenantPermission.EDIT_DOCUMENTS,
        TenantPermission.VIEW_MEMBERS,
        TenantPermission.VIEW_STORAGE,
    ],
    TenantRole.VIEWER: [
        TenantPermission.VIEW_DOCUMENTS,
        TenantPermission.VIEW_MEMBERS,
        TenantPermission.VIEW_STORAGE,
    ],
}


class TenantStatus(str, Enum):
    """Tenant account status."""
    ACTIVE = "active"
    SUSPENDED = "suspended"
    TRIAL = "trial"
    CANCELLED = "cancelled"


class Tenant(Base):
    """
    Tenant (Organization) model.

    Represents an organization that can have multiple members
    who share documents and storage.
    """
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Basic info
    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    logo_url = Column(String(500), nullable=True)

    # Contact info
    email = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=True)
    website = Column(String(255), nullable=True)

    # Address
    address_line1 = Column(String(255), nullable=True)
    address_line2 = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    postal_code = Column(String(20), nullable=True)
    country = Column(String(2), nullable=True)  # ISO 3166-1 alpha-2

    # Plan and billing
    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id"), nullable=True)
    status = Column(
        SQLEnum(TenantStatus, values_callable=lambda x: [e.value for e in x]),
        default=TenantStatus.TRIAL,
        nullable=False
    )
    trial_start_at = Column(DateTime(timezone=True), nullable=True)
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)
    has_used_trial = Column(Boolean, default=False, nullable=False)

    # Stripe integration
    stripe_customer_id = Column(String(255), nullable=True, unique=True)
    stripe_subscription_id = Column(String(255), nullable=True)

    # Storage limits and usage
    storage_limit_bytes = Column(BigInteger, default=5 * 1024 * 1024 * 1024)  # 5GB default
    storage_used_bytes = Column(BigInteger, default=0)

    # API and document limits (inherited from plan or custom)
    api_calls_limit = Column(Integer, default=10000)  # API calls per month for entire tenant
    api_calls_used = Column(Integer, default=0)
    api_calls_reset_at = Column(DateTime(timezone=True), nullable=True)
    document_limit = Column(Integer, default=1000)  # Max documents for entire tenant
    document_count = Column(Integer, default=0)

    # Member limits
    max_members = Column(Integer, default=5)

    # Settings (JSON would be better but keeping it simple)
    allow_member_invites = Column(Boolean, default=True)
    require_2fa = Column(Boolean, default=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    plan = relationship("Plan", back_populates="tenants", foreign_keys=[plan_id])
    members = relationship("TenantMember", back_populates="tenant", cascade="all, delete-orphan")
    documents = relationship("TenantDocument", back_populates="tenant", cascade="all, delete-orphan")
    invitations = relationship("TenantInvitation", back_populates="tenant", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_tenants_status", "status"),
        Index("ix_tenants_created_at", "created_at"),
    )

    @property
    def storage_used_formatted(self) -> str:
        """Format storage used as human-readable string."""
        return self._format_bytes(self.storage_used_bytes)

    @property
    def storage_limit_formatted(self) -> str:
        """Format storage limit as human-readable string."""
        return self._format_bytes(self.storage_limit_bytes)

    @property
    def storage_percentage(self) -> float:
        """Get storage usage as percentage."""
        if self.storage_limit_bytes == 0:
            return 0
        return (self.storage_used_bytes / self.storage_limit_bytes) * 100

    @staticmethod
    def _format_bytes(bytes_value: int) -> str:
        """Format bytes as human-readable string."""
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if abs(bytes_value) < 1024:
                return f"{bytes_value:.1f} {unit}"
            bytes_value /= 1024
        return f"{bytes_value:.1f} PB"


class TenantMember(Base):
    """
    Tenant member model.

    Represents a user's membership in a tenant organization
    with their role and permissions.
    """
    __tablename__ = "tenant_members"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    # Note: user_quotas.id uses as_uuid=False, so we match that here
    user_id = Column(UUID(as_uuid=False), ForeignKey("user_quotas.id", ondelete="CASCADE"), nullable=False)

    # Role and status
    role = Column(
        SQLEnum(TenantRole, values_callable=lambda x: [e.value for e in x]),
        default=TenantRole.MEMBER,
        nullable=False
    )
    is_active = Column(Boolean, default=True, nullable=False)

    # Custom permissions override (comma-separated list of TenantPermission values)
    custom_permissions = Column(Text, nullable=True)

    # Timestamps
    joined_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=func.now(), onupdate=func.now(), nullable=False)
    last_active_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    tenant = relationship("Tenant", back_populates="members")
    user = relationship("UserQuota", back_populates="tenant_memberships")

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_tenant_member"),
        Index("ix_tenant_members_user_id", "user_id"),
        Index("ix_tenant_members_tenant_id", "tenant_id"),
        Index("ix_tenant_members_role", "role"),
    )

    def has_permission(self, permission: TenantPermission) -> bool:
        """Check if member has a specific permission."""
        # Check custom permissions first
        if self.custom_permissions:
            custom_perms = self.custom_permissions.split(",")
            if permission.value in custom_perms:
                return True
            # If custom permissions are set, only use those
            return False

        # Fall back to role-based permissions
        role_perms = ROLE_PERMISSIONS.get(self.role, [])
        return permission in role_perms

    def get_permissions(self) -> list[TenantPermission]:
        """Get all permissions for this member."""
        if self.custom_permissions:
            return [
                TenantPermission(p)
                for p in self.custom_permissions.split(",")
                if p in [e.value for e in TenantPermission]
            ]
        return ROLE_PERMISSIONS.get(self.role, [])


class TenantDocument(Base):
    """
    Tenant document model.

    Links documents to tenants for shared access within the organization.
    """
    __tablename__ = "tenant_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    # stored_documents.id uses as_uuid=False
    document_id = Column(UUID(as_uuid=False), ForeignKey("stored_documents.id", ondelete="CASCADE"), nullable=False)

    # Who shared/added this document (user_quotas.id uses as_uuid=False)
    added_by_id = Column(UUID(as_uuid=False), ForeignKey("user_quotas.id"), nullable=False)

    # Access level for the document within the tenant
    access_level = Column(String(20), default="read", nullable=False)  # read, write, admin

    # Timestamps
    added_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)

    # Relationships
    tenant = relationship("Tenant", back_populates="documents")
    document = relationship("StoredDocument", back_populates="tenant_shares")
    added_by = relationship("UserQuota")

    __table_args__ = (
        UniqueConstraint("tenant_id", "document_id", name="uq_tenant_document"),
        Index("ix_tenant_documents_tenant_id", "tenant_id"),
        Index("ix_tenant_documents_document_id", "document_id"),
    )


class TenantInvitation(Base):
    """
    Tenant invitation model.

    Handles pending invitations to join a tenant organization.
    """
    __tablename__ = "tenant_invitations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)

    # Invitation details
    email = Column(String(255), nullable=False)
    role = Column(
        SQLEnum(TenantRole, values_callable=lambda x: [e.value for e in x]),
        default=TenantRole.MEMBER,
        nullable=False
    )

    # Token for accepting invitation
    token = Column(String(255), unique=True, nullable=False)

    # Invited by (user_quotas.id uses as_uuid=False)
    invited_by_id = Column(UUID(as_uuid=False), ForeignKey("user_quotas.id"), nullable=False)

    # Status
    is_accepted = Column(Boolean, default=False, nullable=False)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    accepted_by_id = Column(UUID(as_uuid=False), ForeignKey("user_quotas.id"), nullable=True)

    # Expiration
    expires_at = Column(DateTime(timezone=True), nullable=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)

    # Relationships
    tenant = relationship("Tenant", back_populates="invitations")
    invited_by = relationship("UserQuota", foreign_keys=[invited_by_id])
    accepted_by = relationship("UserQuota", foreign_keys=[accepted_by_id])

    __table_args__ = (
        Index("ix_tenant_invitations_email", "email"),
        Index("ix_tenant_invitations_token", "token"),
        Index("ix_tenant_invitations_tenant_id", "tenant_id"),
    )

    @property
    def is_expired(self) -> bool:
        """Check if invitation has expired."""
        from datetime import timezone
        return datetime.now(timezone.utc) > self.expires_at
