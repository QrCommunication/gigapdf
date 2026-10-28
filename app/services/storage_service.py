"""
Storage Service - Persistent document storage operations.

Loads stored documents (decrypting them when needed) and creates folders.
Document writes and their quota accounting live in app/api/v1/storage.py
(through ``quota_service.adjust_document_storage``).

Security Features:
- AES-256-GCM encryption for all documents at rest
- Per-document encryption keys (envelope encryption)
- S3 server-side encryption as additional layer
- Audit logging for all storage operations
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.database import (
    DocumentVersion,
    Folder,
    StoredDocument,
)
from app.utils.helpers import generate_uuid

logger = logging.getLogger(__name__)


class StorageService:
    """Service for persistent document storage."""

    def __init__(self):
        """Initialize storage service."""
        self.settings = get_settings()

    async def get_document(
        self, db: AsyncSession, stored_document_id: str, user_id: str
    ) -> StoredDocument | None:
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
                ~StoredDocument.is_deleted,
            )
        )
        return result.scalar_one_or_none()

    async def load_document_file(
        self, db: AsyncSession, stored_document_id: str, user_id: str
    ) -> bytes | None:
        """
        Load document file from storage, decrypting if necessary.

        Args:
            db: Database session.
            stored_document_id: Document identifier.
            user_id: User identifier.

        Returns:
            Document bytes if found (decrypted if encrypted).
        """
        stored_doc = await self.get_document(db, stored_document_id, user_id)
        if not stored_doc:
            return None

        # Get the current version record to check encryption status
        result = await db.execute(
            select(DocumentVersion).where(
                DocumentVersion.document_id == stored_document_id,
                DocumentVersion.version_number == stored_doc.current_version,
            )
        )
        version = result.scalar_one_or_none()

        if not version:
            logger.error(f"Version record not found for {stored_document_id}")
            return None

        # Download from S3
        from app.services.s3_service import s3_service
        s3_key = s3_service.get_document_key(
            user_id, stored_document_id, stored_doc.current_version
        )

        # Check if document is encrypted
        is_encrypted = getattr(version, 'is_encrypted', False)
        encryption_key = getattr(version, 'encryption_key', None)

        if is_encrypted and encryption_key:
            # Download and decrypt
            try:
                document_bytes = s3_service.download_encrypted_document(
                    key=s3_key,
                    encrypted_dek=encryption_key,
                    document_id=stored_document_id,
                    user_id=user_id,
                )
                logger.info(f"Loaded encrypted document: {stored_document_id[:8]}...")
                return document_bytes
            except Exception as e:
                logger.error(f"Decryption failed for {stored_document_id}: {e}")
                raise ValueError(f"Failed to decrypt document: {e}")
        else:
            # Download unencrypted
            return s3_service.download_file(s3_key)

    async def create_folder(
        self,
        db: AsyncSession,
        user_id: str,
        name: str,
        parent_id: str | None = None,
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


# Global service instance
storage_service = StorageService()
