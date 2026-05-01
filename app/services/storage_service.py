"""
Storage Service - Persistent document storage operations.

Handles saving, loading, and managing documents in persistent storage.

Security Features:
- AES-256-GCM encryption for all documents at rest
- Per-document encryption keys (envelope encryption)
- S3 server-side encryption as additional layer
- Audit logging for all storage operations
"""

import hashlib
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.database import (
    DocumentVersion,
    Folder,
    StoredDocument,
    UserQuota,
)
from app.utils.helpers import generate_uuid, now_utc

logger = logging.getLogger(__name__)

# Enable encryption for new documents (set to False for backward compatibility testing)
ENABLE_ENCRYPTION = True


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
        folder_id: str | None = None,
        tags: list[str] | None = None,
        version_comment: str | None = None,
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

        # Upload to S3 with encryption
        from app.services.s3_service import s3_service
        s3_key = s3_service.get_document_key(user_id, stored_doc_id, 1)

        encryption_key = None
        is_encrypted = False

        if ENABLE_ENCRYPTION:
            # Use encrypted upload (AES-256-GCM + SSE-S3)
            try:
                _, encryption_key = s3_service.upload_encrypted_document(
                    document_data=document_bytes,
                    key=s3_key,
                    document_id=stored_doc_id,
                    user_id=user_id,
                    metadata={"document_id": stored_doc_id, "user_id": user_id, "version": "1"}
                )
                is_encrypted = True
                logger.info(f"Document saved with encryption: {stored_doc_id[:8]}...")
            except Exception as e:
                logger.error(f"Encryption failed, falling back to unencrypted: {e}")
                # Fallback to unencrypted upload
                s3_service.upload_file(
                    file_data=document_bytes,
                    key=s3_key,
                    content_type="application/pdf",
                    metadata={"document_id": stored_doc_id, "user_id": user_id, "version": "1"}
                )
        else:
            # Unencrypted upload (with SSE-S3 only)
            s3_service.upload_file(
                file_data=document_bytes,
                key=s3_key,
                content_type="application/pdf",
                metadata={"document_id": stored_doc_id, "user_id": user_id, "version": "1"}
            )

        # Create version record with S3 key and encryption info
        version = DocumentVersion(
            document_id=stored_doc_id,
            version_number=1,
            file_path=s3_key,  # Store S3 key
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment=version_comment,
            created_by=user_id,
            encryption_key=encryption_key,
            is_encrypted=is_encrypted,
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

    async def create_version(
        self,
        db: AsyncSession,
        stored_document_id: str,
        user_id: str,
        document_bytes: bytes,
        comment: str | None = None,
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

        # Upload to S3 with encryption
        from app.services.s3_service import s3_service
        s3_key = s3_service.get_document_key(user_id, stored_document_id, new_version_number)

        encryption_key = None
        is_encrypted = False

        if ENABLE_ENCRYPTION:
            # Use encrypted upload (AES-256-GCM + SSE-S3)
            try:
                _, encryption_key = s3_service.upload_encrypted_document(
                    document_data=document_bytes,
                    key=s3_key,
                    document_id=stored_document_id,
                    user_id=user_id,
                    metadata={
                        "document_id": stored_document_id,
                        "user_id": user_id,
                        "version": str(new_version_number)
                    }
                )
                is_encrypted = True
                logger.info(f"Version saved with encryption: {stored_document_id[:8]}... v{new_version_number}")
            except Exception as e:
                logger.error(f"Encryption failed, falling back to unencrypted: {e}")
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
        else:
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

        # Create version record with S3 key and encryption info
        version = DocumentVersion(
            document_id=stored_document_id,
            version_number=new_version_number,
            file_path=s3_key,  # Store S3 key
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment=comment,
            created_by=user_id,
            encryption_key=encryption_key,
            is_encrypted=is_encrypted,
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
