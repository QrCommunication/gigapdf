"""
Document sharing service.

Provides methods for sharing documents with other users,
managing invitations, and checking access permissions.
"""

import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional, Literal

from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db_session
from app.models.database import (
    DocumentShare,
    DocumentShareInvitation,
    ShareNotification,
    StoredDocument,
    UserQuota,
)
from app.models.tenant import TenantDocument, TenantMember
from app.utils.helpers import generate_uuid, now_utc

logger = logging.getLogger(__name__)


class SharePermission:
    """Share permission levels."""

    VIEW = "view"
    EDIT = "edit"


class InvitationStatus:
    """Invitation status values."""

    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    REVOKED = "revoked"
    EXPIRED = "expired"


class ShareStatus:
    """Share status values."""

    ACTIVE = "active"
    REVOKED = "revoked"


class ShareService:
    """Service for managing document sharing."""

    @staticmethod
    def _generate_token() -> str:
        """Generate a secure random token for invitations and public links."""
        return secrets.token_urlsafe(32)

    @staticmethod
    async def share_document(
        document_id: str,
        inviter_id: str,
        invitee_email: str,
        permission: str = SharePermission.EDIT,
        message: Optional[str] = None,
        expires_in_days: int = 7,
    ) -> dict:
        """
        Share a document by creating an invitation.

        If the invitee is already a registered user, the share is activated immediately.
        Otherwise, an invitation email should be sent.

        Args:
            document_id: Document ID to share
            inviter_id: User ID of the person sharing
            invitee_email: Email of the person to share with
            permission: Permission level (view or edit)
            message: Optional message to include in invitation
            expires_in_days: Days until invitation expires

        Returns:
            dict: Invitation details
        """
        async with get_db_session() as session:
            # Verify document exists and user owns it
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    StoredDocument.owner_id == inviter_id,
                    StoredDocument.is_deleted == False,
                )
            )
            document = doc_result.scalar_one_or_none()

            if not document:
                raise ValueError("Document not found or you don't have permission to share it")

            # Check if already shared with this email
            existing_check = await session.execute(
                select(DocumentShareInvitation).where(
                    DocumentShareInvitation.document_id == document_id,
                    DocumentShareInvitation.invitee_email == invitee_email,
                    DocumentShareInvitation.status.in_([InvitationStatus.PENDING, InvitationStatus.ACCEPTED]),
                )
            )
            existing_invitation = existing_check.scalar_one_or_none()

            if existing_invitation:
                if existing_invitation.status == InvitationStatus.ACCEPTED:
                    raise ValueError("Document is already shared with this user")
                elif existing_invitation.status == InvitationStatus.PENDING:
                    raise ValueError("An invitation is already pending for this email")

            # Check if invitee is a registered user
            user_result = await session.execute(
                select(UserQuota).where(UserQuota.email == invitee_email)
            )
            existing_user = user_result.scalar_one_or_none()

            # Create invitation
            invitation_id = generate_uuid()
            token = ShareService._generate_token()
            expires_at = now_utc() + timedelta(days=expires_in_days)

            invitation = DocumentShareInvitation(
                id=invitation_id,
                document_id=document_id,
                inviter_id=inviter_id,
                invitee_email=invitee_email,
                invitee_user_id=existing_user.user_id if existing_user else None,
                token=token,
                permission=permission,
                message=message,
                status=InvitationStatus.PENDING,
                expires_at=expires_at,
            )
            session.add(invitation)

            # If user exists, create notification
            if existing_user:
                notification = ShareNotification(
                    id=generate_uuid(),
                    user_id=existing_user.user_id,
                    notification_type="share_invitation",
                    document_id=document_id,
                    share_invitation_id=invitation_id,
                    title=f"Document shared with you",
                    message=f"You have been invited to access '{document.name}'",
                    metadata={
                        "document_name": document.name,
                        "inviter_id": inviter_id,
                        "permission": permission,
                    },
                )
                session.add(notification)

            await session.commit()

            logger.info(
                f"Created share invitation {invitation_id} for document {document_id} "
                f"from {inviter_id} to {invitee_email}"
            )

            return {
                "invitation_id": invitation_id,
                "token": token,
                "invitee_email": invitee_email,
                "invitee_user_exists": existing_user is not None,
                "permission": permission,
                "expires_at": expires_at.isoformat(),
                "document_name": document.name,
            }

    @staticmethod
    async def accept_invitation(token: str, user_id: str, user_email: str) -> dict:
        """
        Accept a share invitation.

        Args:
            token: Invitation token
            user_id: User ID accepting the invitation
            user_email: Email of the user accepting

        Returns:
            dict: Share details
        """
        async with get_db_session() as session:
            # Find invitation
            result = await session.execute(
                select(DocumentShareInvitation)
                .options(selectinload(DocumentShareInvitation.document))
                .where(DocumentShareInvitation.token == token)
            )
            invitation = result.scalar_one_or_none()

            if not invitation:
                raise ValueError("Invitation not found")

            if invitation.status != InvitationStatus.PENDING:
                raise ValueError(f"Invitation is {invitation.status}")

            if invitation.expires_at < now_utc():
                invitation.status = InvitationStatus.EXPIRED
                await session.commit()
                raise ValueError("Invitation has expired")

            # Verify email matches (case-insensitive)
            if invitation.invitee_email.lower() != user_email.lower():
                raise ValueError("This invitation is for a different email address")

            # Update invitation
            invitation.status = InvitationStatus.ACCEPTED
            invitation.invitee_user_id = user_id
            invitation.responded_at = now_utc()

            # Create share
            share_id = generate_uuid()
            share = DocumentShare(
                id=share_id,
                document_id=invitation.document_id,
                shared_with_user_id=user_id,
                permission=invitation.permission,
                created_by=invitation.inviter_id,
                status=ShareStatus.ACTIVE,
                invitation_id=invitation.id,
            )
            session.add(share)

            # Notify inviter
            inviter_notification = ShareNotification(
                id=generate_uuid(),
                user_id=invitation.inviter_id,
                notification_type="share_accepted",
                document_id=invitation.document_id,
                share_invitation_id=invitation.id,
                title="Invitation accepted",
                message=f"{user_email} accepted your invitation to access '{invitation.document.name}'",
                metadata={
                    "document_name": invitation.document.name,
                    "accepter_email": user_email,
                    "accepter_id": user_id,
                },
            )
            session.add(inviter_notification)

            await session.commit()

            logger.info(
                f"User {user_id} accepted invitation {invitation.id} for document {invitation.document_id}"
            )

            return {
                "share_id": share_id,
                "document_id": invitation.document_id,
                "document_name": invitation.document.name,
                "permission": invitation.permission,
            }

    @staticmethod
    async def decline_invitation(token: str, user_id: str) -> dict:
        """
        Decline a share invitation.

        Args:
            token: Invitation token
            user_id: User ID declining

        Returns:
            dict: Confirmation details
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(DocumentShareInvitation)
                .options(selectinload(DocumentShareInvitation.document))
                .where(DocumentShareInvitation.token == token)
            )
            invitation = result.scalar_one_or_none()

            if not invitation:
                raise ValueError("Invitation not found")

            if invitation.status != InvitationStatus.PENDING:
                raise ValueError(f"Invitation is {invitation.status}")

            invitation.status = InvitationStatus.DECLINED
            invitation.responded_at = now_utc()

            # Notify inviter
            inviter_notification = ShareNotification(
                id=generate_uuid(),
                user_id=invitation.inviter_id,
                notification_type="share_declined",
                document_id=invitation.document_id,
                share_invitation_id=invitation.id,
                title="Invitation declined",
                message=f"Your invitation to share '{invitation.document.name}' was declined",
                metadata={
                    "document_name": invitation.document.name,
                },
            )
            session.add(inviter_notification)

            await session.commit()

            logger.info(f"User {user_id} declined invitation {invitation.id}")

            return {
                "invitation_id": invitation.id,
                "status": InvitationStatus.DECLINED,
            }

    @staticmethod
    async def revoke_share(share_id: str, revoker_id: str) -> dict:
        """
        Revoke a document share.

        Args:
            share_id: Share ID to revoke
            revoker_id: User ID revoking the share (must be document owner)

        Returns:
            dict: Confirmation details
        """
        async with get_db_session() as session:
            # Get share with document
            result = await session.execute(
                select(DocumentShare)
                .options(selectinload(DocumentShare.invitation))
                .where(DocumentShare.id == share_id)
            )
            share = result.scalar_one_or_none()

            if not share:
                raise ValueError("Share not found")

            # Verify revoker is document owner
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == share.document_id,
                    StoredDocument.owner_id == revoker_id,
                )
            )
            document = doc_result.scalar_one_or_none()

            if not document:
                raise ValueError("You don't have permission to revoke this share")

            if share.status == ShareStatus.REVOKED:
                raise ValueError("Share is already revoked")

            # Revoke share
            share.status = ShareStatus.REVOKED
            share.revoked_at = now_utc()
            share.revoked_by = revoker_id

            # If there's an invitation, mark it as revoked too
            if share.invitation:
                share.invitation.status = InvitationStatus.REVOKED

            # Notify the shared user
            if share.shared_with_user_id:
                notification = ShareNotification(
                    id=generate_uuid(),
                    user_id=share.shared_with_user_id,
                    notification_type="share_revoked",
                    document_id=share.document_id,
                    title="Access revoked",
                    message=f"Your access to '{document.name}' has been revoked",
                    metadata={
                        "document_name": document.name,
                        "revoker_id": revoker_id,
                    },
                )
                session.add(notification)

            await session.commit()

            logger.info(f"Share {share_id} revoked by {revoker_id}")

            return {
                "share_id": share_id,
                "status": ShareStatus.REVOKED,
            }

    @staticmethod
    async def update_permission(
        share_id: str,
        owner_id: str,
        new_permission: str,
    ) -> dict:
        """
        Update permission level for a share.

        Args:
            share_id: Share ID
            owner_id: Document owner ID (for authorization)
            new_permission: New permission level

        Returns:
            dict: Updated share details
        """
        if new_permission not in [SharePermission.VIEW, SharePermission.EDIT]:
            raise ValueError("Invalid permission level")

        async with get_db_session() as session:
            # Get share
            result = await session.execute(
                select(DocumentShare).where(DocumentShare.id == share_id)
            )
            share = result.scalar_one_or_none()

            if not share:
                raise ValueError("Share not found")

            # Verify owner
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == share.document_id,
                    StoredDocument.owner_id == owner_id,
                )
            )
            document = doc_result.scalar_one_or_none()

            if not document:
                raise ValueError("You don't have permission to modify this share")

            old_permission = share.permission
            share.permission = new_permission

            # Notify user of permission change
            if share.shared_with_user_id:
                notification = ShareNotification(
                    id=generate_uuid(),
                    user_id=share.shared_with_user_id,
                    notification_type="permission_changed",
                    document_id=share.document_id,
                    title="Permission updated",
                    message=f"Your access to '{document.name}' changed from {old_permission} to {new_permission}",
                    metadata={
                        "document_name": document.name,
                        "old_permission": old_permission,
                        "new_permission": new_permission,
                    },
                )
                session.add(notification)

            await session.commit()

            return {
                "share_id": share_id,
                "permission": new_permission,
                "old_permission": old_permission,
            }

    @staticmethod
    async def get_shared_with_me(
        user_id: str,
        user_email: str,
        user_quota_id: Optional[str] = None,
        page: int = 1,
        per_page: int = 20,
        source_filter: Optional[Literal["direct", "organization", "all"]] = "all",
    ) -> dict:
        """
        Get documents shared with the current user.

        Combines direct shares (DocumentShare) and organization shares (TenantDocument).

        Args:
            user_id: User ID
            user_email: User email
            user_quota_id: Optional quota ID for tenant lookups
            page: Page number (1-indexed)
            per_page: Items per page
            source_filter: Filter by share source

        Returns:
            dict: Paginated list of shared documents
        """
        async with get_db_session() as session:
            shared_documents = []

            # Get direct shares
            if source_filter in ["direct", "all"]:
                direct_query = (
                    select(DocumentShare, StoredDocument)
                    .join(StoredDocument, DocumentShare.document_id == StoredDocument.id)
                    .where(
                        DocumentShare.shared_with_user_id == user_id,
                        DocumentShare.status == ShareStatus.ACTIVE,
                        StoredDocument.is_deleted == False,
                    )
                    .order_by(DocumentShare.created_at.desc())
                )

                direct_result = await session.execute(direct_query)
                direct_shares = direct_result.all()

                for share, doc in direct_shares:
                    # Get owner info
                    owner_result = await session.execute(
                        select(UserQuota).where(UserQuota.user_id == doc.owner_id)
                    )
                    owner = owner_result.scalar_one_or_none()

                    shared_documents.append({
                        "id": doc.id,
                        "name": doc.name,
                        "page_count": doc.page_count,
                        "file_size_bytes": doc.file_size_bytes,
                        "thumbnail_path": doc.thumbnail_path,
                        "created_at": doc.created_at.isoformat() if doc.created_at else None,
                        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
                        "share_source": "direct",
                        "share_id": share.id,
                        "permission": share.permission,
                        "shared_at": share.created_at.isoformat() if share.created_at else None,
                        "owner": {
                            "user_id": doc.owner_id,
                            "email": owner.email if owner else None,
                        },
                    })

            # Get organization shares (via TenantDocument)
            if source_filter in ["organization", "all"] and user_quota_id:
                # Find user's tenant memberships
                membership_result = await session.execute(
                    select(TenantMember).where(
                        TenantMember.user_id == user_quota_id,
                        TenantMember.is_active == True,
                    )
                )
                memberships = membership_result.scalars().all()

                for membership in memberships:
                    # Get tenant documents
                    tenant_docs_query = (
                        select(TenantDocument, StoredDocument)
                        .join(StoredDocument, TenantDocument.document_id == StoredDocument.id)
                        .where(
                            TenantDocument.tenant_id == membership.tenant_id,
                            StoredDocument.is_deleted == False,
                            StoredDocument.owner_id != user_id,  # Exclude own documents
                        )
                    )

                    tenant_result = await session.execute(tenant_docs_query)
                    tenant_docs = tenant_result.all()

                    for tenant_doc, doc in tenant_docs:
                        # Get owner info
                        owner_result = await session.execute(
                            select(UserQuota).where(UserQuota.user_id == doc.owner_id)
                        )
                        owner = owner_result.scalar_one_or_none()

                        # Determine permission based on tenant role
                        permission = "edit" if membership.role in ["owner", "admin", "manager"] else "view"

                        shared_documents.append({
                            "id": doc.id,
                            "name": doc.name,
                            "page_count": doc.page_count,
                            "file_size_bytes": doc.file_size_bytes,
                            "thumbnail_path": doc.thumbnail_path,
                            "created_at": doc.created_at.isoformat() if doc.created_at else None,
                            "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
                            "share_source": "organization",
                            "tenant_id": membership.tenant_id,
                            "permission": permission,
                            "shared_at": tenant_doc.added_at.isoformat() if tenant_doc.added_at else None,
                            "owner": {
                                "user_id": doc.owner_id,
                                "email": owner.email if owner else None,
                            },
                        })

            # Sort by shared_at descending
            shared_documents.sort(
                key=lambda x: x.get("shared_at") or "",
                reverse=True
            )

            # Pagination
            total = len(shared_documents)
            start_idx = (page - 1) * per_page
            end_idx = start_idx + per_page
            paginated_docs = shared_documents[start_idx:end_idx]

            return {
                "documents": paginated_docs,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page if total > 0 else 0,
            }

    @staticmethod
    async def get_shared_by_me(
        user_id: str,
        page: int = 1,
        per_page: int = 20,
    ) -> dict:
        """
        Get documents that the user has shared with others.

        Args:
            user_id: User ID
            page: Page number
            per_page: Items per page

        Returns:
            dict: Paginated list of shares
        """
        async with get_db_session() as session:
            # Count total
            count_query = (
                select(func.count(DocumentShare.id))
                .join(StoredDocument, DocumentShare.document_id == StoredDocument.id)
                .where(
                    StoredDocument.owner_id == user_id,
                    DocumentShare.status == ShareStatus.ACTIVE,
                    StoredDocument.is_deleted == False,
                )
            )
            total_result = await session.execute(count_query)
            total = total_result.scalar() or 0

            # Get shares
            query = (
                select(DocumentShare, StoredDocument)
                .join(StoredDocument, DocumentShare.document_id == StoredDocument.id)
                .where(
                    StoredDocument.owner_id == user_id,
                    DocumentShare.status == ShareStatus.ACTIVE,
                    StoredDocument.is_deleted == False,
                )
                .order_by(DocumentShare.created_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )

            result = await session.execute(query)
            shares = result.all()

            share_list = []
            for share, doc in shares:
                # Get shared user info
                shared_user = None
                if share.shared_with_user_id:
                    user_result = await session.execute(
                        select(UserQuota).where(UserQuota.user_id == share.shared_with_user_id)
                    )
                    shared_user = user_result.scalar_one_or_none()

                share_list.append({
                    "share_id": share.id,
                    "document": {
                        "id": doc.id,
                        "name": doc.name,
                        "page_count": doc.page_count,
                        "thumbnail_path": doc.thumbnail_path,
                    },
                    "shared_with": {
                        "user_id": share.shared_with_user_id,
                        "email": shared_user.email if shared_user else None,
                    } if share.shared_with_user_id else None,
                    "is_public_link": share.share_token is not None,
                    "permission": share.permission,
                    "created_at": share.created_at.isoformat() if share.created_at else None,
                    "expires_at": share.expires_at.isoformat() if share.expires_at else None,
                })

            return {
                "shares": share_list,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page if total > 0 else 0,
            }

    @staticmethod
    async def get_document_shares(document_id: str, owner_id: str) -> list[dict]:
        """
        Get all active shares for a document.

        Args:
            document_id: Document ID
            owner_id: Owner ID (for authorization)

        Returns:
            list: List of shares
        """
        async with get_db_session() as session:
            # Verify ownership
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    StoredDocument.owner_id == owner_id,
                )
            )
            if not doc_result.scalar_one_or_none():
                raise ValueError("Document not found or you don't have access")

            # Get active shares
            query = (
                select(DocumentShare)
                .where(
                    DocumentShare.document_id == document_id,
                    DocumentShare.status == ShareStatus.ACTIVE,
                )
                .order_by(DocumentShare.created_at.desc())
            )

            result = await session.execute(query)
            shares = result.scalars().all()

            share_list = []
            for share in shares:
                shared_user = None
                if share.shared_with_user_id:
                    user_result = await session.execute(
                        select(UserQuota).where(UserQuota.user_id == share.shared_with_user_id)
                    )
                    shared_user = user_result.scalar_one_or_none()

                share_list.append({
                    "share_id": share.id,
                    "shared_with": {
                        "user_id": share.shared_with_user_id,
                        "email": shared_user.email if shared_user else None,
                    } if share.shared_with_user_id else None,
                    "is_public_link": share.share_token is not None,
                    "share_token": share.share_token,
                    "permission": share.permission,
                    "created_at": share.created_at.isoformat() if share.created_at else None,
                    "expires_at": share.expires_at.isoformat() if share.expires_at else None,
                })

            # Also get pending invitations
            inv_query = (
                select(DocumentShareInvitation)
                .where(
                    DocumentShareInvitation.document_id == document_id,
                    DocumentShareInvitation.status == InvitationStatus.PENDING,
                )
            )
            inv_result = await session.execute(inv_query)
            invitations = inv_result.scalars().all()

            for inv in invitations:
                share_list.append({
                    "invitation_id": inv.id,
                    "invitee_email": inv.invitee_email,
                    "permission": inv.permission,
                    "status": "pending",
                    "created_at": inv.created_at.isoformat() if inv.created_at else None,
                    "expires_at": inv.expires_at.isoformat() if inv.expires_at else None,
                })

            return share_list

    @staticmethod
    async def check_access(
        document_id: str,
        user_id: str,
        user_email: Optional[str] = None,
        user_quota_id: Optional[str] = None,
    ) -> dict:
        """
        Check if a user has access to a document and at what permission level.

        Checks:
        1. Direct ownership
        2. Direct share
        3. Organization share (via tenant)
        4. Public link (requires token)

        Args:
            document_id: Document ID
            user_id: User ID
            user_email: User email (for invitation lookup)
            user_quota_id: User quota ID (for tenant lookup)

        Returns:
            dict: Access info with permission level
        """
        async with get_db_session() as session:
            # Check ownership first
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    StoredDocument.is_deleted == False,
                )
            )
            document = doc_result.scalar_one_or_none()

            if not document:
                return {"has_access": False, "reason": "document_not_found"}

            if document.owner_id == user_id:
                return {
                    "has_access": True,
                    "permission": "owner",
                    "source": "ownership",
                }

            # Check direct share
            share_result = await session.execute(
                select(DocumentShare).where(
                    DocumentShare.document_id == document_id,
                    DocumentShare.shared_with_user_id == user_id,
                    DocumentShare.status == ShareStatus.ACTIVE,
                )
            )
            share = share_result.scalar_one_or_none()

            if share:
                # Check expiration
                if share.expires_at and share.expires_at < now_utc():
                    return {"has_access": False, "reason": "share_expired"}

                return {
                    "has_access": True,
                    "permission": share.permission,
                    "source": "direct_share",
                    "share_id": share.id,
                }

            # Check organization share
            if user_quota_id:
                # Find user's tenant memberships
                membership_result = await session.execute(
                    select(TenantMember).where(
                        TenantMember.user_id == user_quota_id,
                        TenantMember.is_active == True,
                    )
                )
                memberships = membership_result.scalars().all()

                for membership in memberships:
                    # Check if document is in this tenant
                    tenant_doc_result = await session.execute(
                        select(TenantDocument).where(
                            TenantDocument.tenant_id == membership.tenant_id,
                            TenantDocument.document_id == document_id,
                        )
                    )
                    tenant_doc = tenant_doc_result.scalar_one_or_none()

                    if tenant_doc:
                        permission = "edit" if membership.role in ["owner", "admin", "manager"] else "view"
                        return {
                            "has_access": True,
                            "permission": permission,
                            "source": "organization",
                            "tenant_id": membership.tenant_id,
                            "role": membership.role,
                        }

            return {"has_access": False, "reason": "no_access"}

    @staticmethod
    async def get_pending_invitations(user_email: str) -> list[dict]:
        """
        Get pending invitations for a user.

        Args:
            user_email: User email

        Returns:
            list: List of pending invitations
        """
        async with get_db_session() as session:
            query = (
                select(DocumentShareInvitation, StoredDocument)
                .join(StoredDocument, DocumentShareInvitation.document_id == StoredDocument.id)
                .where(
                    DocumentShareInvitation.invitee_email == user_email,
                    DocumentShareInvitation.status == InvitationStatus.PENDING,
                    DocumentShareInvitation.expires_at > now_utc(),
                    StoredDocument.is_deleted == False,
                )
                .order_by(DocumentShareInvitation.created_at.desc())
            )

            result = await session.execute(query)
            invitations = result.all()

            invitation_list = []
            for inv, doc in invitations:
                # Get inviter info
                inviter_result = await session.execute(
                    select(UserQuota).where(UserQuota.user_id == inv.inviter_id)
                )
                inviter = inviter_result.scalar_one_or_none()

                invitation_list.append({
                    "invitation_id": inv.id,
                    "token": inv.token,
                    "document": {
                        "id": doc.id,
                        "name": doc.name,
                        "page_count": doc.page_count,
                        "thumbnail_path": doc.thumbnail_path,
                    },
                    "inviter": {
                        "user_id": inv.inviter_id,
                        "email": inviter.email if inviter else None,
                    },
                    "permission": inv.permission,
                    "message": inv.message,
                    "created_at": inv.created_at.isoformat() if inv.created_at else None,
                    "expires_at": inv.expires_at.isoformat() if inv.expires_at else None,
                })

            return invitation_list

    @staticmethod
    async def create_public_link(
        document_id: str,
        owner_id: str,
        expires_in_days: Optional[int] = None,
    ) -> dict:
        """
        Create a public view-only link for a document.

        Args:
            document_id: Document ID
            owner_id: Owner ID
            expires_in_days: Optional expiration in days

        Returns:
            dict: Public link details
        """
        async with get_db_session() as session:
            # Verify ownership
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    StoredDocument.owner_id == owner_id,
                    StoredDocument.is_deleted == False,
                )
            )
            document = doc_result.scalar_one_or_none()

            if not document:
                raise ValueError("Document not found or you don't have permission")

            # Check for existing public link
            existing_result = await session.execute(
                select(DocumentShare).where(
                    DocumentShare.document_id == document_id,
                    DocumentShare.share_token.isnot(None),
                    DocumentShare.status == ShareStatus.ACTIVE,
                )
            )
            existing = existing_result.scalar_one_or_none()

            if existing:
                return {
                    "share_id": existing.id,
                    "token": existing.share_token,
                    "permission": existing.permission,
                    "expires_at": existing.expires_at.isoformat() if existing.expires_at else None,
                    "already_existed": True,
                }

            # Create new public link
            token = ShareService._generate_token()
            expires_at = None
            if expires_in_days:
                expires_at = now_utc() + timedelta(days=expires_in_days)

            share_id = generate_uuid()
            share = DocumentShare(
                id=share_id,
                document_id=document_id,
                share_token=token,
                permission=SharePermission.VIEW,  # Public links are view-only
                expires_at=expires_at,
                created_by=owner_id,
                status=ShareStatus.ACTIVE,
            )
            session.add(share)
            await session.commit()

            logger.info(f"Created public link {share_id} for document {document_id}")

            return {
                "share_id": share_id,
                "token": token,
                "permission": SharePermission.VIEW,
                "expires_at": expires_at.isoformat() if expires_at else None,
                "already_existed": False,
            }

    @staticmethod
    async def revoke_public_link(document_id: str, owner_id: str) -> dict:
        """
        Revoke the public link for a document.

        Args:
            document_id: Document ID
            owner_id: Owner ID

        Returns:
            dict: Confirmation
        """
        async with get_db_session() as session:
            # Find public link
            result = await session.execute(
                select(DocumentShare).where(
                    DocumentShare.document_id == document_id,
                    DocumentShare.share_token.isnot(None),
                    DocumentShare.status == ShareStatus.ACTIVE,
                )
            )
            share = result.scalar_one_or_none()

            if not share:
                raise ValueError("No public link found for this document")

            # Verify ownership
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    StoredDocument.owner_id == owner_id,
                )
            )
            if not doc_result.scalar_one_or_none():
                raise ValueError("You don't have permission to revoke this link")

            share.status = ShareStatus.REVOKED
            share.revoked_at = now_utc()
            share.revoked_by = owner_id

            await session.commit()

            return {"status": "revoked", "share_id": share.id}


# Singleton instance
share_service = ShareService()
