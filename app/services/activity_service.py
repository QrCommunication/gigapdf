"""
Activity logging service for document audit trail.

Provides methods to log and retrieve document activities.
"""

import logging

from sqlalchemy import and_, select

from app.core.database import get_db_session
from app.models.database import ActivityLog, StoredDocument
from app.utils.helpers import generate_uuid

logger = logging.getLogger(__name__)


class ActivityAction:
    """Standard activity action types."""

    CREATE = "create"
    VIEW = "view"
    DOWNLOAD = "download"
    EDIT = "edit"
    RENAME = "rename"
    DELETE = "delete"
    RESTORE = "restore"
    SHARE = "share"
    UNSHARE = "unshare"
    EXPORT = "export"
    UPLOAD = "upload"
    MOVE = "move"
    COPY = "copy"
    LOCK = "lock"
    UNLOCK = "unlock"


class ActivityService:
    """Service for managing activity logs."""

    @staticmethod
    async def log_activity(
        user_id: str,
        action: str,
        document_id: str | None = None,
        user_email: str | None = None,
        user_name: str | None = None,
        resource_type: str = "document",
        extra_data: dict | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        tenant_id: str | None = None,
    ) -> str | None:
        """
        Log an activity.

        Args:
            user_id: ID of the user performing the action
            action: Type of action (create, view, download, etc.)
            document_id: Optional document ID
            user_email: Optional user email
            user_name: Optional user display name
            resource_type: Type of resource (document, folder, tenant)
            extra_data: Additional data about the action
            ip_address: Client IP address
            user_agent: Client user agent
            tenant_id: Optional tenant ID for organization context

        Returns:
            Activity log ID if successful, None otherwise
        """
        try:
            async with get_db_session() as session:
                activity_id = generate_uuid()

                activity = ActivityLog(
                    id=activity_id,
                    document_id=document_id,
                    user_id=user_id,
                    user_email=user_email,
                    user_name=user_name,
                    action=action,
                    resource_type=resource_type,
                    extra_data=extra_data,
                    ip_address=ip_address,
                    user_agent=user_agent,
                    tenant_id=tenant_id,
                )

                session.add(activity)
                await session.commit()

                logger.debug(
                    f"Activity logged: {action} on {resource_type} "
                    f"by user {user_id}"
                )

                return activity_id

        except Exception as e:
            logger.error(f"Failed to log activity: {e}", exc_info=True)
            return None

    @staticmethod
    async def get_document_history(
        document_id: str,
        user_id: str,
        limit: int = 50,
        offset: int = 0,
        action_filter: str | None = None,
    ) -> tuple[list[dict], int]:
        """
        Get activity history for a document.

        Only returns activities if the user has access to the document.

        Args:
            document_id: Document ID
            user_id: Requesting user ID (for access check)
            limit: Maximum number of activities to return
            offset: Number of activities to skip
            action_filter: Optional filter by action type

        Returns:
            Tuple of (list of activities, total count)
        """
        try:
            async with get_db_session() as session:
                # First, verify user has access to the document
                doc_result = await session.execute(
                    select(StoredDocument).where(
                        StoredDocument.id == document_id,
                        StoredDocument.owner_id == user_id,
                        not StoredDocument.is_deleted,
                    )
                )
                document = doc_result.scalar_one_or_none()

                if not document:
                    # TODO: Also check tenant access and share access
                    return [], 0

                # Build query
                conditions = [ActivityLog.document_id == document_id]
                if action_filter:
                    conditions.append(ActivityLog.action == action_filter)

                # Get total count
                count_query = select(ActivityLog).where(and_(*conditions))
                count_result = await session.execute(count_query)
                total = len(count_result.scalars().all())

                # Get activities
                query = (
                    select(ActivityLog)
                    .where(and_(*conditions))
                    .order_by(ActivityLog.created_at.desc())
                    .offset(offset)
                    .limit(limit)
                )

                result = await session.execute(query)
                activities = result.scalars().all()

                # Format response
                activity_list = [
                    {
                        "id": str(activity.id),
                        "action": activity.action,
                        "user_id": activity.user_id,
                        "user_email": activity.user_email,
                        "user_name": activity.user_name,
                        "resource_type": activity.resource_type,
                        "extra_data": activity.extra_data,
                        "ip_address": activity.ip_address,
                        "created_at": activity.created_at.isoformat()
                        if activity.created_at
                        else None,
                    }
                    for activity in activities
                ]

                return activity_list, total

        except Exception as e:
            logger.error(f"Failed to get document history: {e}", exc_info=True)
            return [], 0

    @staticmethod
    async def get_user_activity(
        user_id: str,
        limit: int = 50,
        offset: int = 0,
        action_filter: str | None = None,
        resource_type_filter: str | None = None,
    ) -> tuple[list[dict], int]:
        """
        Get activity history for a user (their own actions).

        Args:
            user_id: User ID
            limit: Maximum number of activities to return
            offset: Number of activities to skip
            action_filter: Optional filter by action type
            resource_type_filter: Optional filter by resource type

        Returns:
            Tuple of (list of activities, total count)
        """
        try:
            async with get_db_session() as session:
                # Build query
                conditions = [ActivityLog.user_id == user_id]
                if action_filter:
                    conditions.append(ActivityLog.action == action_filter)
                if resource_type_filter:
                    conditions.append(ActivityLog.resource_type == resource_type_filter)

                # Get total count
                count_query = select(ActivityLog).where(and_(*conditions))
                count_result = await session.execute(count_query)
                total = len(count_result.scalars().all())

                # Get activities with document info
                query = (
                    select(ActivityLog)
                    .where(and_(*conditions))
                    .order_by(ActivityLog.created_at.desc())
                    .offset(offset)
                    .limit(limit)
                )

                result = await session.execute(query)
                activities = result.scalars().all()

                # Format response
                activity_list = [
                    {
                        "id": str(activity.id),
                        "action": activity.action,
                        "document_id": str(activity.document_id)
                        if activity.document_id
                        else None,
                        "resource_type": activity.resource_type,
                        "extra_data": activity.extra_data,
                        "created_at": activity.created_at.isoformat()
                        if activity.created_at
                        else None,
                    }
                    for activity in activities
                ]

                return activity_list, total

        except Exception as e:
            logger.error(f"Failed to get user activity: {e}", exc_info=True)
            return [], 0


# Singleton instance
activity_service = ActivityService()
