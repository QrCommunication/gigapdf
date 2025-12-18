"""
Storage Service - Persistent document storage operations.

Handles saving, loading, and managing documents in persistent storage.
"""

import hashlib
import logging
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.database import (
    StoredDocument,
    DocumentVersion,
    Folder,
    UserQuota,
)
from app.utils.helpers import generate_uuid, now_utc

logger = logging.getLogger(__name__)


class StorageService:
    """Service for persistent document storage."""

    def __init__(self):
        """Initialize storage service."""
        self.settings = get_settings()

    async def save_document(
        self,
        db: AsyncSession,
        user_id: str,
        document_bytes: bytes,
        name: str,
        folder_id: Optional[str] = None,
        tags: Optional[list[str]] = None,
        version_comment: Optional[str] = None,
        page_count: int = 0,
    ) -> StoredDocument:
        """
        Save a document to persistent storage.

        Args:
            db: Database session.
            user_id: User identifier.
            document_bytes: PDF file bytes.
            name: Document display name.
            folder_id: Folder to save into.
            tags: Document tags.
            version_comment: Comment for initial version.
            page_count: Number of pages.

        Returns:
            StoredDocument instance.
        """
        # Check user quota
        quota = await self._get_or_create_quota(db, user_id)

        file_size = len(document_bytes)

        if quota.storage_used_bytes + file_size > quota.storage_limit_bytes:
            raise ValueError(
                f"Storage quota exceeded. Used: {quota.storage_used_bytes}, "
                f"Limit: {quota.storage_limit_bytes}"
            )

        if quota.document_count >= quota.document_limit:
            raise ValueError(f"Document limit exceeded. Limit: {quota.document_limit}")

        # Calculate file hash
        file_hash = hashlib.sha256(document_bytes).hexdigest()

        # Create stored document record
        stored_doc_id = generate_uuid()
        stored_doc = StoredDocument(
            id=stored_doc_id,
            name=name,
            owner_id=user_id,
            folder_id=folder_id,
            page_count=page_count,
            current_version=1,
            file_size_bytes=file_size,
            tags=tags or [],
        )
        db.add(stored_doc)

        # Upload to S3
        from app.services.s3_service import s3_service
        s3_key = s3_service.get_document_key(user_id, stored_doc_id, 1)
        s3_service.upload_file(
            file_data=document_bytes,
            key=s3_key,
            content_type="application/pdf",
            metadata={"document_id": stored_doc_id, "user_id": user_id, "version": "1"}
        )

        # Create version record with S3 key
        version = DocumentVersion(
            document_id=stored_doc_id,
            version_number=1,
            file_path=s3_key,  # Store S3 key
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment=version_comment,
            created_by=user_id,
        )
        db.add(version)

        # Update quota
        quota.storage_used_bytes += file_size
        quota.document_count += 1

        await db.commit()
        await db.refresh(stored_doc)
        return stored_doc

    async def get_document(
        self, db: AsyncSession, stored_document_id: str, user_id: str
    ) -> Optional[StoredDocument]:
        """
        Get stored document by ID.

        Args:
            db: Database session.
            stored_document_id: Document identifier.
            user_id: User identifier (for ownership check).

        Returns:
            StoredDocument if found and owned by user.
        """
        result = await db.execute(
            select(StoredDocument).where(
                StoredDocument.id == stored_document_id,
                StoredDocument.owner_id == user_id,
                StoredDocument.is_deleted == False,
            )
        )
        return result.scalar_one_or_none()

    async def load_document_file(
        self, db: AsyncSession, stored_document_id: str, user_id: str
    ) -> Optional[bytes]:
        """
        Load document file from storage.

        Args:
            db: Database session.
            stored_document_id: Document identifier.
            user_id: User identifier.

        Returns:
            Document bytes if found.
        """
        stored_doc = await self.get_document(db, stored_document_id, user_id)
        if not stored_doc:
            return None

        # Download from S3
        from app.services.s3_service import s3_service
        s3_key = s3_service.get_document_key(
            user_id, stored_document_id, stored_doc.current_version
        )
        return s3_service.download_file(s3_key)

    async def create_version(
        self,
        db: AsyncSession,
        stored_document_id: str,
        user_id: str,
        document_bytes: bytes,
        comment: Optional[str] = None,
        page_count: int = 0,
    ) -> DocumentVersion:
        """
        Create a new version of a stored document.

        Args:
            db: Database session.
            stored_document_id: Document identifier.
            user_id: User identifier.
            document_bytes: PDF file bytes.
            comment: Version comment.
            page_count: Number of pages.

        Returns:
            Created DocumentVersion.
        """
        stored_doc = await self.get_document(db, stored_document_id, user_id)
        if not stored_doc:
            raise ValueError(f"Stored document not found: {stored_document_id}")

        file_size = len(document_bytes)
        file_hash = hashlib.sha256(document_bytes).hexdigest()

        # Increment version
        new_version_number = stored_doc.current_version + 1

        # Upload to S3
        from app.services.s3_service import s3_service
        s3_key = s3_service.get_document_key(user_id, stored_document_id, new_version_number)
        s3_service.upload_file(
            file_data=document_bytes,
            key=s3_key,
            content_type="application/pdf",
            metadata={
                "document_id": stored_document_id,
                "user_id": user_id,
                "version": str(new_version_number)
            }
        )

        # Create version record with S3 key
        version = DocumentVersion(
            document_id=stored_document_id,
            version_number=new_version_number,
            file_path=s3_key,  # Store S3 key
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment=comment,
            created_by=user_id,
        )
        db.add(version)

        # Update stored document
        stored_doc.current_version = new_version_number
        stored_doc.page_count = page_count
        stored_doc.file_size_bytes = file_size

        await db.commit()
        await db.refresh(version)
        return version

    async def delete_document(
        self, db: AsyncSession, stored_document_id: str, user_id: str
    ) -> bool:
        """
        Soft delete a stored document.

        Args:
            db: Database session.
            stored_document_id: Document identifier.
            user_id: User identifier.

        Returns:
            True if deleted.
        """
        stored_doc = await self.get_document(db, stored_document_id, user_id)
        if not stored_doc:
            return False

        stored_doc.is_deleted = True
        stored_doc.deleted_at = now_utc()

        # Update quota
        quota = await self._get_or_create_quota(db, user_id)
        quota.storage_used_bytes -= stored_doc.file_size_bytes
        quota.document_count -= 1

        await db.commit()
        return True

    async def create_folder(
        self,
        db: AsyncSession,
        user_id: str,
        name: str,
        parent_id: Optional[str] = None,
    ) -> Folder:
        """
        Create a new folder.

        Args:
            db: Database session.
            user_id: User identifier.
            name: Folder name.
            parent_id: Parent folder ID.

        Returns:
            Created Folder.
        """
        # Calculate path
        if parent_id:
            result = await db.execute(
                select(Folder).where(
                    Folder.id == parent_id,
                    Folder.owner_id == user_id,
                )
            )
            parent = result.scalar_one_or_none()
            if not parent:
                raise ValueError(f"Parent folder not found: {parent_id}")
            path = f"{parent.path}{parent.id}/"
        else:
            path = "/"

        # Create folder
        folder_id = generate_uuid()
        folder = Folder(
            id=folder_id,
            name=name,
            owner_id=user_id,
            parent_id=parent_id,
            path=path,
        )
        db.add(folder)
        await db.commit()
        await db.refresh(folder)
        return folder

    async def _get_or_create_quota(
        self, db: AsyncSession, user_id: str
    ) -> UserQuota:
        """Get or create user quota."""
        result = await db.execute(
            select(UserQuota).where(UserQuota.user_id == user_id)
        )
        quota = result.scalar_one_or_none()

        if not quota:
            quota = UserQuota(user_id=user_id)
            db.add(quota)
            await db.commit()
            await db.refresh(quota)

        return quota


# Global service instance
storage_service = StorageService()
