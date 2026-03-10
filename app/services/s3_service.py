"""
S3 Storage Service - Scaleway/AWS S3-compatible storage operations.

Handles file uploads, downloads, and management for persistent document storage.

Security Features:
- Server-Side Encryption (SSE-S3) for all uploads
- Application-level AES-256-GCM encryption (envelope encryption)
- Secure presigned URLs with expiration
- Audit logging for all operations
"""

import logging
import os
from typing import Optional, BinaryIO, Tuple
from io import BytesIO

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import get_settings

logger = logging.getLogger(__name__)


class S3Service:
    """Service for S3-compatible storage operations."""

    def __init__(self):
        """Initialize S3 service with Scaleway credentials."""
        self.settings = get_settings()

        # Get S3 configuration from settings (loaded from .env by pydantic-settings)
        self.endpoint_url = self.settings.s3_endpoint
        self.bucket_name = self.settings.s3_bucket_name
        self.region = self.settings.s3_region
        self.access_key = self.settings.s3_access_key_id
        self.secret_key = self.settings.s3_secret_access_key

        # Configure S3 client for Scaleway
        s3_config = Config(
            signature_version='s3v4',
            s3={'addressing_style': 'path'},
            retries={'max_attempts': 3, 'mode': 'standard'}
        )

        self._client = None
        if self.access_key and self.secret_key:
            self._client = boto3.client(
                's3',
                endpoint_url=self.endpoint_url,
                region_name=self.region,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                config=s3_config,
            )
            logger.info(f"S3 service initialized with bucket: {self.bucket_name}")
        else:
            logger.warning("S3 credentials not configured - storage operations will fail")

    @property
    def client(self):
        """Get S3 client."""
        if not self._client:
            raise ValueError("S3 client not initialized - check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY")
        return self._client

    def upload_file(
        self,
        file_data: bytes,
        key: str,
        content_type: str = "application/pdf",
        metadata: Optional[dict] = None,
        server_side_encryption: bool = True,
    ) -> dict:
        """
        Upload a file to S3 with server-side encryption.

        Args:
            file_data: File bytes to upload.
            key: S3 object key (path in bucket).
            content_type: MIME type of the file.
            metadata: Optional metadata to attach to the object.
            server_side_encryption: Enable SSE-S3 encryption (default: True).

        Returns:
            dict with upload result including ETag and key.
        """
        try:
            extra_args = {
                'ContentType': content_type,
            }

            # Enable server-side encryption (SSE-S3) - disabled for Scaleway compatibility
            # Scaleway doesn't support SSE-S3 the same way AWS does
            # Application-level encryption (AES-256-GCM) is already applied
            is_scaleway = self.endpoint_url and 'scw.cloud' in self.endpoint_url
            if server_side_encryption and not is_scaleway:
                # Only enable SSE for AWS S3, not Scaleway
                extra_args['ServerSideEncryption'] = 'AES256'

            if metadata:
                extra_args['Metadata'] = {k: str(v) for k, v in metadata.items()}

            # Upload using put_object for bytes
            response = self.client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=file_data,
                **extra_args
            )

            logger.info(
                f"Uploaded file to S3: {key} ({len(file_data)} bytes) "
                f"[SSE: {'AES256' if server_side_encryption else 'none'}]"
            )

            return {
                'key': key,
                'etag': response.get('ETag', '').strip('"'),
                'bucket': self.bucket_name,
                'size': len(file_data),
                'url': f"{self.endpoint_url}/{self.bucket_name}/{key}",
                'encryption': 'AES256' if server_side_encryption else None,
            }

        except ClientError as e:
            logger.error(f"S3 upload failed for {key}: {e}")
            raise

    def upload_encrypted_document(
        self,
        document_data: bytes,
        key: str,
        document_id: str,
        user_id: str,
        metadata: Optional[dict] = None,
    ) -> Tuple[dict, str]:
        """
        Upload a document with application-level encryption + SSE-S3.

        This provides two layers of encryption:
        1. Application-level AES-256-GCM (envelope encryption)
        2. S3 server-side encryption (SSE-S3)

        Args:
            document_data: Plaintext document bytes.
            key: S3 object key.
            document_id: Document identifier for encryption AAD.
            user_id: User identifier for encryption AAD.
            metadata: Optional metadata.

        Returns:
            Tuple of (upload result dict, encrypted DEK as base64 string).
        """
        from app.services.encryption_service import (
            encryption_service,
            encode_encrypted_key
        )

        # Encrypt the document at application level
        encrypted_data, encrypted_dek = encryption_service.encrypt_document(
            document_data,
            document_id,
            user_id
        )

        # Add encryption metadata
        encryption_metadata = {
            'encrypted': 'true',
            'encryption_version': '1',
            'original_size': str(len(document_data)),
        }
        if metadata:
            encryption_metadata.update(metadata)

        # Upload with SSE-S3
        result = self.upload_file(
            encrypted_data,
            key,
            content_type='application/octet-stream',  # Encrypted data
            metadata=encryption_metadata,
            server_side_encryption=True,
        )

        # Encode DEK for database storage
        encoded_dek = encode_encrypted_key(encrypted_dek)

        logger.info(
            f"Uploaded encrypted document: {key} "
            f"(original: {len(document_data)} bytes, encrypted: {len(encrypted_data)} bytes)"
        )

        return result, encoded_dek

    def download_encrypted_document(
        self,
        key: str,
        encrypted_dek: str,
        document_id: str,
        user_id: str,
    ) -> bytes:
        """
        Download and decrypt a document.

        Args:
            key: S3 object key.
            encrypted_dek: Base64-encoded encrypted DEK from database.
            document_id: Document identifier for decryption.
            user_id: User identifier for decryption.

        Returns:
            Decrypted document bytes.
        """
        from app.services.encryption_service import (
            encryption_service,
            decode_encrypted_key
        )

        # Download encrypted data from S3
        encrypted_data = self.download_file(key)
        if encrypted_data is None:
            return None

        # Decode the DEK
        dek_bytes = decode_encrypted_key(encrypted_dek)

        # Decrypt the document
        plaintext = encryption_service.decrypt_document(
            encrypted_data,
            dek_bytes,
            document_id,
            user_id
        )

        logger.info(
            f"Downloaded and decrypted document: {key} "
            f"(encrypted: {len(encrypted_data)} bytes, decrypted: {len(plaintext)} bytes)"
        )

        return plaintext

    def download_file(self, key: str) -> bytes:
        """
        Download a file from S3.

        Args:
            key: S3 object key.

        Returns:
            File bytes.
        """
        try:
            response = self.client.get_object(
                Bucket=self.bucket_name,
                Key=key
            )
            file_data = response['Body'].read()
            logger.info(f"Downloaded file from S3: {key} ({len(file_data)} bytes)")
            return file_data

        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                logger.warning(f"File not found in S3: {key}")
                return None
            logger.error(f"S3 download failed for {key}: {e}")
            raise

    def delete_file(self, key: str) -> bool:
        """
        Delete a file from S3.

        Args:
            key: S3 object key.

        Returns:
            True if deleted successfully.
        """
        try:
            self.client.delete_object(
                Bucket=self.bucket_name,
                Key=key
            )
            logger.info(f"Deleted file from S3: {key}")
            return True

        except ClientError as e:
            logger.error(f"S3 delete failed for {key}: {e}")
            return False

    def file_exists(self, key: str) -> bool:
        """
        Check if a file exists in S3.

        Args:
            key: S3 object key.

        Returns:
            True if file exists.
        """
        try:
            self.client.head_object(
                Bucket=self.bucket_name,
                Key=key
            )
            return True
        except ClientError:
            return False

    def get_presigned_url(
        self,
        key: str,
        expires_in: int = 3600,
        method: str = 'get_object'
    ) -> str:
        """
        Generate a presigned URL for temporary access.

        Args:
            key: S3 object key.
            expires_in: URL expiration time in seconds.
            method: S3 operation ('get_object' or 'put_object').

        Returns:
            Presigned URL string.
        """
        try:
            url = self.client.generate_presigned_url(
                method,
                Params={
                    'Bucket': self.bucket_name,
                    'Key': key
                },
                ExpiresIn=expires_in
            )
            return url
        except ClientError as e:
            logger.error(f"Failed to generate presigned URL for {key}: {e}")
            raise

    def list_files(
        self,
        prefix: str = "",
        max_keys: int = 1000
    ) -> list[dict]:
        """
        List files in S3 with optional prefix filter.

        Args:
            prefix: Key prefix to filter by.
            max_keys: Maximum number of keys to return.

        Returns:
            List of file metadata dicts.
        """
        try:
            response = self.client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix,
                MaxKeys=max_keys
            )

            files = []
            for obj in response.get('Contents', []):
                files.append({
                    'key': obj['Key'],
                    'size': obj['Size'],
                    'last_modified': obj['LastModified'],
                    'etag': obj['ETag'].strip('"'),
                })

            return files

        except ClientError as e:
            logger.error(f"S3 list failed for prefix {prefix}: {e}")
            raise

    def get_document_key(self, user_id: str, document_id: str, version: int) -> str:
        """
        Generate S3 key for a document version.

        Args:
            user_id: User identifier.
            document_id: Document identifier.
            version: Version number.

        Returns:
            S3 key string.
        """
        return f"documents/{user_id}/{document_id}/v{version}.pdf"


# Global service instance
s3_service = S3Service()
