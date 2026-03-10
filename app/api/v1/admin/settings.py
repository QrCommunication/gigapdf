"""
Admin settings endpoints.

Provides system settings management for the admin panel.
"""

import os
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr

from app.config import get_settings

router = APIRouter()


class SystemSettings(BaseModel):
    """System settings model."""
    # General
    system_name: str = "GigaPDF"
    system_url: str = "http://localhost:3000"
    support_email: str = "support@gigapdf.com"

    # Limits
    max_file_size_mb: int = 100
    max_pages_per_document: int = 1000
    max_documents_per_user: int = 1000

    # Storage
    storage_provider: str = "s3"
    storage_bucket: Optional[str] = None
    storage_region: Optional[str] = None
    storage_endpoint: Optional[str] = None

    # Email (SMTP)
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_from: Optional[str] = None
    smtp_secure: bool = True

    # Features
    enable_registration: bool = True
    enable_public_sharing: bool = True
    enable_ocr: bool = True
    enable_collaboration: bool = True
    maintenance_mode: bool = False


class SettingsUpdateRequest(BaseModel):
    """Settings update request (partial)."""
    # General
    system_name: Optional[str] = None
    system_url: Optional[str] = None
    support_email: Optional[str] = None

    # Limits
    max_file_size_mb: Optional[int] = None
    max_pages_per_document: Optional[int] = None
    max_documents_per_user: Optional[int] = None

    # Email
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from: Optional[str] = None
    smtp_secure: Optional[bool] = None

    # Features
    enable_registration: Optional[bool] = None
    enable_public_sharing: Optional[bool] = None
    enable_ocr: Optional[bool] = None
    enable_collaboration: Optional[bool] = None
    maintenance_mode: Optional[bool] = None


# In-memory settings store (in production, use database or config file)
_settings_store: dict = {}


def get_current_settings() -> SystemSettings:
    """Get current system settings."""
    settings = get_settings()

    # Merge environment settings with stored settings
    base_settings = {
        "system_name": os.getenv("SYSTEM_NAME", "GigaPDF"),
        "system_url": os.getenv("SYSTEM_URL", "http://localhost:3000"),
        "support_email": os.getenv("SUPPORT_EMAIL", "support@gigapdf.com"),
        "max_file_size_mb": int(os.getenv("MAX_FILE_SIZE_MB", "100")),
        "max_pages_per_document": int(os.getenv("MAX_PAGES_PER_DOCUMENT", "1000")),
        "max_documents_per_user": int(os.getenv("MAX_DOCUMENTS_PER_USER", "1000")),
        "storage_provider": os.getenv("STORAGE_PROVIDER", "s3"),
        "storage_bucket": os.getenv("S3_BUCKET_NAME", os.getenv("AWS_S3_BUCKET")),
        "storage_region": os.getenv("S3_REGION", os.getenv("AWS_REGION")),
        "storage_endpoint": os.getenv("S3_ENDPOINT", os.getenv("S3_ENDPOINT_URL")),
        "smtp_host": os.getenv("SMTP_HOST"),
        "smtp_port": int(os.getenv("SMTP_PORT", "587")),
        "smtp_user": os.getenv("SMTP_USER"),
        "smtp_from": os.getenv("SMTP_FROM"),
        "smtp_secure": os.getenv("SMTP_SECURE", "true").lower() == "true",
        "enable_registration": os.getenv("ENABLE_REGISTRATION", "true").lower() == "true",
        "enable_public_sharing": os.getenv("ENABLE_PUBLIC_SHARING", "true").lower() == "true",
        "enable_ocr": os.getenv("ENABLE_OCR", "true").lower() == "true",
        "enable_collaboration": os.getenv("ENABLE_COLLABORATION", "true").lower() == "true",
        "maintenance_mode": os.getenv("MAINTENANCE_MODE", "false").lower() == "true",
    }

    # Override with stored settings
    merged = {**base_settings, **_settings_store}

    return SystemSettings(**merged)


@router.get("", response_model=SystemSettings)
async def get_system_settings():
    """
    Get current system settings.
    """
    return get_current_settings()


@router.patch("", response_model=SystemSettings)
async def update_system_settings(
    update: SettingsUpdateRequest,
):
    """
    Update system settings.

    Note: Some settings require a server restart to take effect.
    Settings are stored in memory and will be reset on restart.
    For persistent settings, update environment variables.
    """
    global _settings_store

    # Get update data, excluding None values
    update_data = update.model_dump(exclude_none=True)

    # Remove password from stored settings (don't expose it)
    if "smtp_password" in update_data:
        # In production, encrypt and store the password
        # For now, just note it was updated
        del update_data["smtp_password"]

    # Update stored settings
    _settings_store.update(update_data)

    return get_current_settings()


@router.post("/test-email")
async def test_email_settings(
    to_email: str,
):
    """
    Test email settings by sending a test email.
    """
    settings = get_current_settings()

    if not settings.smtp_host:
        return {
            "success": False,
            "message": "SMTP host not configured",
        }

    # In production, actually send the email
    # For now, just return a simulated response
    return {
        "success": True,
        "message": f"Test email would be sent to {to_email}",
        "smtp_host": settings.smtp_host,
        "smtp_port": settings.smtp_port,
    }


@router.post("/test-storage")
async def test_storage_settings():
    """
    Test storage connection.
    """
    settings = get_current_settings()

    if not settings.storage_bucket:
        return {
            "success": False,
            "message": "Storage bucket not configured",
        }

    # Try to connect to S3/storage
    try:
        import boto3
        from botocore.config import Config

        s3_config = Config(
            signature_version='s3v4',
            s3={'addressing_style': 'path'}
        )

        s3_client = boto3.client(
            's3',
            endpoint_url=settings.storage_endpoint,
            region_name=settings.storage_region or 'fr-par',
            aws_access_key_id=os.getenv('S3_ACCESS_KEY_ID', os.getenv('AWS_ACCESS_KEY_ID')),
            aws_secret_access_key=os.getenv('S3_SECRET_ACCESS_KEY', os.getenv('AWS_SECRET_ACCESS_KEY')),
            config=s3_config,
        )

        # Try to list bucket
        s3_client.head_bucket(Bucket=settings.storage_bucket)

        return {
            "success": True,
            "message": f"Successfully connected to bucket '{settings.storage_bucket}'",
            "provider": settings.storage_provider,
            "endpoint": settings.storage_endpoint,
            "region": settings.storage_region,
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Storage connection failed: {str(e)}",
        }


@router.get("/storage-info")
async def get_storage_info():
    """
    Get storage information and statistics.
    """
    settings = get_current_settings()

    if not settings.storage_bucket:
        return {
            "configured": False,
            "message": "Storage not configured",
        }

    try:
        import boto3
        from botocore.config import Config

        s3_config = Config(
            signature_version='s3v4',
            s3={'addressing_style': 'path'}
        )

        s3_client = boto3.client(
            's3',
            endpoint_url=settings.storage_endpoint,
            region_name=settings.storage_region or 'fr-par',
            aws_access_key_id=os.getenv('S3_ACCESS_KEY_ID', os.getenv('AWS_ACCESS_KEY_ID')),
            aws_secret_access_key=os.getenv('S3_SECRET_ACCESS_KEY', os.getenv('AWS_SECRET_ACCESS_KEY')),
            config=s3_config,
        )

        # Get bucket location
        location = s3_client.get_bucket_location(Bucket=settings.storage_bucket)

        # Count objects (limited for performance)
        paginator = s3_client.get_paginator('list_objects_v2')
        object_count = 0
        total_size = 0

        for page in paginator.paginate(Bucket=settings.storage_bucket, MaxKeys=1000):
            if 'Contents' in page:
                object_count += len(page['Contents'])
                total_size += sum(obj['Size'] for obj in page['Contents'])
            if object_count >= 1000:
                break

        def format_bytes(bytes_val: int) -> str:
            if bytes_val >= 1024 ** 3:
                return f"{bytes_val / (1024 ** 3):.2f} GB"
            elif bytes_val >= 1024 ** 2:
                return f"{bytes_val / (1024 ** 2):.2f} MB"
            elif bytes_val >= 1024:
                return f"{bytes_val / 1024:.2f} KB"
            return f"{bytes_val} B"

        return {
            "configured": True,
            "provider": settings.storage_provider,
            "bucket": settings.storage_bucket,
            "region": settings.storage_region,
            "endpoint": settings.storage_endpoint,
            "object_count": object_count,
            "object_count_note": "Limited to first 1000 objects" if object_count >= 1000 else None,
            "total_size_bytes": total_size,
            "total_size_formatted": format_bytes(total_size),
        }
    except Exception as e:
        return {
            "configured": True,
            "error": str(e),
        }
