"""
Notification service for in-app notifications.

Provides methods for creating and managing user notifications,
particularly for document sharing events.
"""

import logging
from typing import Optional

from sqlalchemy import select, and_, func, update
from sqlalchemy.orm import selectinload

from app.core.database import get_db_session
from app.models.database import ShareNotification, StoredDocument
from app.utils.helpers import generate_uuid, now_utc

logger = logging.getLogger(__name__)


class NotificationType:
    """Notification type constants."""

    SHARE_INVITATION = "share_invitation"
    SHARE_ACCEPTED = "share_accepted"
    SHARE_DECLINED = "share_declined"
    SHARE_REVOKED = "share_revoked"
    PERMISSION_CHANGED = "permission_changed"


class NotificationService:
    """Service for managing in-app notifications."""

    @staticmethod
    async def create_notification(
        user_id: str,
        notification_type: str,
        title: str,
        message: Optional[str] = None,
        document_id: Optional[str] = None,
        share_invitation_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> str:
        """
        Create a new notification.

        Args:
            user_id: User ID to notify
            notification_type: Type of notification
            title: Notification title
            message: Optional notification message
            document_id: Optional related document ID
            share_invitation_id: Optional related invitation ID
            metadata: Optional additional data

        Returns:
            str: Notification ID
        """
        async with get_db_session() as session:
            notification_id = generate_uuid()

            notification = ShareNotification(
                id=notification_id,
                user_id=user_id,
                notification_type=notification_type,
                title=title,
                message=message,
                document_id=document_id,
                share_invitation_id=share_invitation_id,
                extra_data=metadata,
                is_read=False,
            )

            session.add(notification)
            await session.commit()

            logger.debug(
                f"Created notification {notification_id} of type {notification_type} for user {user_id}"
            )

            return notification_id

    @staticmethod
    async def get_notifications(
        user_id: str,
        unread_only: bool = False,
        page: int = 1,
        per_page: int = 20,
    ) -> dict:
        """
        Get notifications for a user.

        Args:
            user_id: User ID
            unread_only: If True, only return unread notifications
            page: Page number (1-indexed)
            per_page: Items per page

        Returns:
            dict: Paginated notifications
        """
        async with get_db_session() as session:
            # Build conditions
            conditions = [ShareNotification.user_id == user_id]
            if unread_only:
                conditions.append(ShareNotification.is_read == False)

            # Count total
            count_query = select(func.count(ShareNotification.id)).where(and_(*conditions))
            total_result = await session.execute(count_query)
            total = total_result.scalar() or 0

            # Get notifications
            query = (
                select(ShareNotification)
                .options(selectinload(ShareNotification.document))
                .where(and_(*conditions))
                .order_by(ShareNotification.created_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )

            result = await session.execute(query)
            notifications = result.scalars().all()

            notification_list = [
                {
                    "id": n.id,
                    "type": n.notification_type,
                    "title": n.title,
                    "message": n.message,
                    "document": {
                        "id": n.document.id,
                        "name": n.document.name,
                    } if n.document else None,
                    "metadata": n.extra_data,
                    "is_read": n.is_read,
                    "created_at": n.created_at.isoformat() if n.created_at else None,
                }
                for n in notifications
            ]

            return {
                "notifications": notification_list,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page if total > 0 else 0,
            }

    @staticmethod
    async def get_unread_count(user_id: str) -> int:
        """
        Get count of unread notifications.

        Args:
            user_id: User ID

        Returns:
            int: Count of unread notifications
        """
        async with get_db_session() as session:
            query = select(func.count(ShareNotification.id)).where(
                ShareNotification.user_id == user_id,
                ShareNotification.is_read == False,
            )
            result = await session.execute(query)
            return result.scalar() or 0

    @staticmethod
    async def mark_as_read(notification_id: str, user_id: str) -> bool:
        """
        Mark a notification as read.

        Args:
            notification_id: Notification ID
            user_id: User ID (for authorization)

        Returns:
            bool: True if marked, False if not found
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(ShareNotification).where(
                    ShareNotification.id == notification_id,
                    ShareNotification.user_id == user_id,
                )
            )
            notification = result.scalar_one_or_none()

            if not notification:
                return False

            notification.is_read = True
            await session.commit()

            return True

    @staticmethod
    async def mark_all_as_read(user_id: str) -> int:
        """
        Mark all notifications as read for a user.

        Args:
            user_id: User ID

        Returns:
            int: Number of notifications marked as read
        """
        async with get_db_session() as session:
            stmt = (
                update(ShareNotification)
                .where(
                    ShareNotification.user_id == user_id,
                    ShareNotification.is_read == False,
                )
                .values(is_read=True)
            )

            result = await session.execute(stmt)
            await session.commit()

            count = result.rowcount
            logger.debug(f"Marked {count} notifications as read for user {user_id}")

            return count

    @staticmethod
    async def delete_notification(notification_id: str, user_id: str) -> bool:
        """
        Delete a notification.

        Args:
            notification_id: Notification ID
            user_id: User ID (for authorization)

        Returns:
            bool: True if deleted, False if not found
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(ShareNotification).where(
                    ShareNotification.id == notification_id,
                    ShareNotification.user_id == user_id,
                )
            )
            notification = result.scalar_one_or_none()

            if not notification:
                return False

            await session.delete(notification)
            await session.commit()

            return True

    @staticmethod
    async def delete_old_notifications(user_id: str, days: int = 30) -> int:
        """
        Delete notifications older than specified days.

        Args:
            user_id: User ID
            days: Delete notifications older than this many days

        Returns:
            int: Number of deleted notifications
        """
        from datetime import timedelta

        async with get_db_session() as session:
            cutoff_date = now_utc() - timedelta(days=days)

            # Get notifications to delete
            query = select(ShareNotification).where(
                ShareNotification.user_id == user_id,
                ShareNotification.created_at < cutoff_date,
            )

            result = await session.execute(query)
            notifications = result.scalars().all()

            count = len(notifications)
            for n in notifications:
                await session.delete(n)

            await session.commit()

            if count > 0:
                logger.info(f"Deleted {count} old notifications for user {user_id}")

            return count


# Singleton instance
notification_service = NotificationService()
