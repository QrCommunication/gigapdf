"""
Object storage service — provider-agnostic facade.

Historically Scaleway-only; it now delegates every call to the configured
:class:`~app.storage_backends.base.StorageBackend` (iDrive e2, Scaleway, AWS, MinIO,
local disk or a custom backend — see ``STORAGE_PROVIDER``). The public API
(method names, arguments, return shapes) is unchanged so callers do not care
which provider is active.

Security:
- Application-level AES-256-GCM envelope encryption for documents
  (independent of the provider)
- Optional provider-side encryption (SSE) when the provider supports it
- Presigned URLs with expiration
"""

from __future__ import annotations

import logging

from app.storage_backends import StorageBackend, get_storage_backend

logger = logging.getLogger(__name__)

_PRESIGN_METHODS = {
    "get_object": "get",
    "put_object": "put",
    "get": "get",
    "put": "put",
}


class ObjectStorageService:
    """High-level storage operations used by the API and Celery tasks."""

    def __init__(self, backend: StorageBackend | None = None):
        # None → resolve lazily from settings, so importing this module never
        # fails on missing credentials (same behaviour as before).
        self._backend = backend

    @property
    def backend(self) -> StorageBackend:
        return self._backend or get_storage_backend()

    @property
    def bucket_name(self) -> str:
        return self.backend.bucket

    # -- writes -------------------------------------------------------------

    def upload_file(
        self,
        file_data: bytes,
        key: str,
        content_type: str = "application/pdf",
        metadata: dict | None = None,
        server_side_encryption: bool = True,  # kept for API compatibility
    ) -> dict:
        """Store ``file_data`` under ``key``.

        Provider-side encryption follows the backend configuration
        (``S3_SERVER_SIDE_ENCRYPTION`` / provider preset).
        """
        backend = self.backend
        try:
            result = backend.put_object(key, file_data, content_type, metadata)
        except Exception as e:
            logger.error(f"Storage upload failed for {key} ({backend.provider}): {e}")
            raise

        logger.info(f"Uploaded {key} ({len(file_data)} bytes) to {backend.provider}")
        return {
            "key": key,
            "etag": result.get("etag", ""),
            "bucket": backend.bucket,
            "size": len(file_data),
            "url": backend.public_url(key),
            "encryption": result.get("encryption"),
        }

    def upload_encrypted_document(
        self,
        document_data: bytes,
        key: str,
        document_id: str,
        user_id: str,
        metadata: dict | None = None,
    ) -> tuple[dict, str]:
        """Encrypt (AES-256-GCM envelope) then upload a document.

        Returns:
            Tuple of (upload result dict, encrypted DEK as base64 string).
        """
        from app.services.encryption_service import encode_encrypted_key, encryption_service

        encrypted_data, encrypted_dek = encryption_service.encrypt_document(
            document_data, document_id, user_id
        )

        encryption_metadata = {
            "encrypted": "true",
            "encryption_version": "1",
            "original_size": str(len(document_data)),
        }
        if metadata:
            encryption_metadata.update(metadata)

        result = self.upload_file(
            encrypted_data,
            key,
            content_type="application/octet-stream",
            metadata=encryption_metadata,
        )

        logger.info(
            f"Uploaded encrypted document: {key} "
            f"(original: {len(document_data)} bytes, encrypted: {len(encrypted_data)} bytes)"
        )
        return result, encode_encrypted_key(encrypted_dek)

    def delete_file(self, key: str) -> bool:
        """Delete ``key``. Returns False instead of raising on failure."""
        try:
            self.backend.delete_object(key)
            logger.info(f"Deleted {key} from storage")
            return True
        except Exception as e:
            logger.error(f"Storage delete failed for {key}: {e}")
            return False

    def copy_file(
        self,
        source_key: str,
        dest_key: str,
        content_type: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """Copy an object inside the bucket (server-side when supported)."""
        backend = self.backend
        try:
            backend.copy_object(source_key, dest_key, content_type, metadata)
        except Exception as e:
            logger.error(f"Storage copy failed ({source_key} -> {dest_key}): {e}")
            raise
        logger.info(f"Copied storage object: {source_key} -> {dest_key}")
        return {"source_key": source_key, "dest_key": dest_key, "bucket": backend.bucket}

    # -- reads --------------------------------------------------------------

    def download_file(self, key: str) -> bytes | None:
        """Return the object bytes, or None when it does not exist."""
        try:
            data = self.backend.get_object(key)
        except Exception as e:
            logger.error(f"Storage download failed for {key}: {e}")
            raise
        if data is None:
            logger.warning(f"File not found in storage: {key}")
            return None
        logger.info(f"Downloaded {key} ({len(data)} bytes)")
        return data

    def download_encrypted_document(
        self,
        key: str,
        encrypted_dek: str,
        document_id: str,
        user_id: str,
    ) -> bytes | None:
        """Download and decrypt a document (None when the object is missing)."""
        from app.services.encryption_service import decode_encrypted_key, encryption_service

        encrypted_data = self.download_file(key)
        if encrypted_data is None:
            return None

        plaintext = encryption_service.decrypt_document(
            encrypted_data, decode_encrypted_key(encrypted_dek), document_id, user_id
        )
        logger.info(
            f"Downloaded and decrypted document: {key} "
            f"(encrypted: {len(encrypted_data)} bytes, decrypted: {len(plaintext)} bytes)"
        )
        return plaintext

    def file_exists(self, key: str) -> bool:
        try:
            return self.backend.object_exists(key)
        except Exception:
            return False

    def list_files(self, prefix: str = "", max_keys: int = 1000) -> list[dict]:
        return [
            {
                "key": obj.key,
                "size": obj.size,
                "last_modified": obj.last_modified,
                "etag": obj.etag,
            }
            for obj in self.backend.list_objects(prefix, max_keys)
        ]

    def get_presigned_url(
        self, key: str, expires_in: int = 3600, method: str = "get_object"
    ) -> str:
        """Temporary direct-access URL (``get_object`` or ``put_object``)."""
        try:
            return self.backend.presigned_url(key, expires_in, _PRESIGN_METHODS[method])
        except Exception as e:
            logger.error(f"Failed to generate presigned URL for {key}: {e}")
            raise

    # -- key layout ---------------------------------------------------------

    def get_document_key(self, user_id: str, document_id: str, version: int) -> str:
        """Object key for a document version."""
        return f"documents/{user_id}/{document_id}/v{version}.pdf"

    def get_thumbnail_key(self, user_id: str, document_id: str, extension: str) -> str:
        """Object key for a stored document thumbnail (png, jpg, webp)."""
        return f"thumbnails/{user_id}/{document_id}.{extension}"


# Backward-compatible names: existing code imports ``s3_service`` / ``S3Service``.
S3Service = ObjectStorageService
object_storage = ObjectStorageService()
s3_service = object_storage
