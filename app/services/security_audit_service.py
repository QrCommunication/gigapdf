"""
Security Audit Service - Logging for security-relevant events.

This module provides comprehensive audit logging for security events
to support compliance requirements (SOC 2, GDPR, etc.).

Tracked Events:
- Document encryption/decryption operations
- Access control changes (shares, permissions)
- Authentication events
- Key rotation events
- Failed access attempts
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Any
from enum import Enum

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class SecurityEventType(str, Enum):
    """Types of security events to audit."""
    # Encryption events
    DOCUMENT_ENCRYPTED = "document.encrypted"
    DOCUMENT_DECRYPTED = "document.decrypted"
    KEY_ROTATED = "key.rotated"
    ENCRYPTION_FAILED = "encryption.failed"
    DECRYPTION_FAILED = "decryption.failed"

    # Access events
    DOCUMENT_ACCESSED = "document.accessed"
    DOCUMENT_DOWNLOADED = "document.downloaded"
    ACCESS_DENIED = "access.denied"
    SHARE_CREATED = "share.created"
    SHARE_REVOKED = "share.revoked"

    # Authentication events
    LOGIN_SUCCESS = "auth.login.success"
    LOGIN_FAILED = "auth.login.failed"
    LOGOUT = "auth.logout"
    TOKEN_REFRESHED = "auth.token.refreshed"

    # Admin events
    SETTINGS_CHANGED = "settings.changed"
    USER_CREATED = "user.created"
    USER_DELETED = "user.deleted"
    PERMISSIONS_CHANGED = "permissions.changed"


class SecurityAuditService:
    """
    Service for logging security-relevant events.

    All events are stored in the activity_logs table with
    additional security-specific metadata.
    """

    def __init__(self, db: AsyncSession):
        """
        Initialize the audit service.

        Args:
            db: Async database session.
        """
        self.db = db

    async def log_event(
        self,
        event_type: SecurityEventType,
        user_id: str,
        document_id: Optional[str] = None,
        user_email: Optional[str] = None,
        user_name: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        tenant_id: Optional[str] = None,
        extra_data: Optional[dict] = None,
    ) -> str:
        """
        Log a security event.

        Args:
            event_type: Type of security event.
            user_id: ID of the user performing the action.
            document_id: Optional document ID if applicable.
            user_email: Optional user email.
            user_name: Optional user display name.
            ip_address: Client IP address.
            user_agent: Client user agent string.
            tenant_id: Optional tenant ID for multi-tenant.
            extra_data: Additional event-specific data.

        Returns:
            The event ID.
        """
        event_id = str(uuid.uuid4())

        # Add security metadata to extra_data
        security_data = {
            "event_category": "security",
            "event_type": event_type.value,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        }

        if extra_data:
            security_data.update(extra_data)

        query = text("""
            INSERT INTO activity_logs (
                id, document_id, user_id, user_email, user_name,
                action, resource_type, extra_data,
                ip_address, user_agent, tenant_id, created_at
            ) VALUES (
                :id, :document_id, :user_id, :user_email, :user_name,
                :action, :resource_type, :extra_data::jsonb,
                :ip_address, :user_agent, :tenant_id, NOW()
            )
        """)

        import json
        await self.db.execute(
            query,
            {
                "id": event_id,
                "document_id": document_id,
                "user_id": user_id,
                "user_email": user_email,
                "user_name": user_name,
                "action": event_type.value,
                "resource_type": "security",
                "extra_data": json.dumps(security_data),
                "ip_address": ip_address,
                "user_agent": user_agent,
                "tenant_id": tenant_id,
            }
        )
        await self.db.commit()

        logger.info(
            f"Security event logged: {event_type.value} "
            f"(user={user_id[:8]}..., doc={document_id[:8] if document_id else 'N/A'}...)"
        )

        return event_id

    async def log_encryption_event(
        self,
        user_id: str,
        document_id: str,
        success: bool,
        operation: str = "encrypt",
        **kwargs
    ) -> str:
        """
        Log a document encryption/decryption event.

        Args:
            user_id: User performing the operation.
            document_id: Document being encrypted/decrypted.
            success: Whether the operation succeeded.
            operation: 'encrypt' or 'decrypt'.
            **kwargs: Additional event metadata.

        Returns:
            Event ID.
        """
        if operation == "encrypt":
            event_type = (
                SecurityEventType.DOCUMENT_ENCRYPTED if success
                else SecurityEventType.ENCRYPTION_FAILED
            )
        else:
            event_type = (
                SecurityEventType.DOCUMENT_DECRYPTED if success
                else SecurityEventType.DECRYPTION_FAILED
            )

        extra_data = {
            "operation": operation,
            "success": success,
            "algorithm": "AES-256-GCM",
            **kwargs
        }

        return await self.log_event(
            event_type=event_type,
            user_id=user_id,
            document_id=document_id,
            extra_data=extra_data,
            **{k: v for k, v in kwargs.items() if k in [
                'ip_address', 'user_agent', 'tenant_id', 'user_email', 'user_name'
            ]}
        )

    async def log_access_event(
        self,
        user_id: str,
        document_id: str,
        granted: bool,
        access_type: str = "read",
        reason: Optional[str] = None,
        **kwargs
    ) -> str:
        """
        Log a document access event.

        Args:
            user_id: User attempting access.
            document_id: Document being accessed.
            granted: Whether access was granted.
            access_type: Type of access (read, write, download).
            reason: Reason for denial if applicable.
            **kwargs: Additional event metadata.

        Returns:
            Event ID.
        """
        if granted:
            event_type = (
                SecurityEventType.DOCUMENT_DOWNLOADED
                if access_type == "download"
                else SecurityEventType.DOCUMENT_ACCESSED
            )
        else:
            event_type = SecurityEventType.ACCESS_DENIED

        extra_data = {
            "access_type": access_type,
            "granted": granted,
        }
        if reason:
            extra_data["denial_reason"] = reason

        return await self.log_event(
            event_type=event_type,
            user_id=user_id,
            document_id=document_id,
            extra_data=extra_data,
            **{k: v for k, v in kwargs.items() if k in [
                'ip_address', 'user_agent', 'tenant_id', 'user_email', 'user_name'
            ]}
        )

    async def log_share_event(
        self,
        user_id: str,
        document_id: str,
        shared_with: Optional[str],
        permission: str,
        created: bool = True,
        **kwargs
    ) -> str:
        """
        Log a document share event.

        Args:
            user_id: User creating/revoking the share.
            document_id: Document being shared.
            shared_with: User ID or 'public' for public links.
            permission: Permission level granted.
            created: True for create, False for revoke.
            **kwargs: Additional event metadata.

        Returns:
            Event ID.
        """
        event_type = (
            SecurityEventType.SHARE_CREATED if created
            else SecurityEventType.SHARE_REVOKED
        )

        extra_data = {
            "shared_with": shared_with,
            "permission": permission,
            "is_public": shared_with == "public",
        }

        return await self.log_event(
            event_type=event_type,
            user_id=user_id,
            document_id=document_id,
            extra_data=extra_data,
            **{k: v for k, v in kwargs.items() if k in [
                'ip_address', 'user_agent', 'tenant_id', 'user_email', 'user_name'
            ]}
        )

    async def log_key_rotation(
        self,
        user_id: str,
        document_id: str,
        success: bool,
        **kwargs
    ) -> str:
        """
        Log a key rotation event.

        Args:
            user_id: User/system performing rotation.
            document_id: Document whose key was rotated.
            success: Whether rotation succeeded.
            **kwargs: Additional event metadata.

        Returns:
            Event ID.
        """
        extra_data = {
            "success": success,
            "algorithm": "AES-256-GCM",
        }

        return await self.log_event(
            event_type=SecurityEventType.KEY_ROTATED,
            user_id=user_id,
            document_id=document_id,
            extra_data=extra_data,
            **{k: v for k, v in kwargs.items() if k in [
                'ip_address', 'user_agent', 'tenant_id', 'user_email', 'user_name'
            ]}
        )


async def get_security_events(
    db: AsyncSession,
    document_id: Optional[str] = None,
    user_id: Optional[str] = None,
    event_types: Optional[list[SecurityEventType]] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """
    Retrieve security events with filtering.

    Args:
        db: Database session.
        document_id: Filter by document.
        user_id: Filter by user.
        event_types: Filter by event types.
        start_date: Filter events after this date.
        end_date: Filter events before this date.
        limit: Maximum results to return.
        offset: Pagination offset.

    Returns:
        List of security event records.
    """
    conditions = ["resource_type = 'security'"]
    params = {"limit": limit, "offset": offset}

    if document_id:
        conditions.append("document_id = :document_id")
        params["document_id"] = document_id

    if user_id:
        conditions.append("user_id = :user_id")
        params["user_id"] = user_id

    if event_types:
        conditions.append("action = ANY(:event_types)")
        params["event_types"] = [e.value for e in event_types]

    if start_date:
        conditions.append("created_at >= :start_date")
        params["start_date"] = start_date

    if end_date:
        conditions.append("created_at <= :end_date")
        params["end_date"] = end_date

    where_clause = " AND ".join(conditions)

    query = text(f"""
        SELECT
            id, document_id, user_id, user_email, user_name,
            action, extra_data, ip_address, user_agent,
            tenant_id, created_at
        FROM activity_logs
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT :limit OFFSET :offset
    """)

    result = await db.execute(query, params)
    rows = result.fetchall()

    return [
        {
            "id": row.id,
            "document_id": row.document_id,
            "user_id": row.user_id,
            "user_email": row.user_email,
            "user_name": row.user_name,
            "action": row.action,
            "extra_data": row.extra_data,
            "ip_address": row.ip_address,
            "user_agent": row.user_agent,
            "tenant_id": row.tenant_id,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]
