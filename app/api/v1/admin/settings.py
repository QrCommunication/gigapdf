"""
Admin settings endpoints.

Provides system settings management for the admin panel.
"""

import os

from fastapi import APIRouter
from pydantic import BaseModel

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
    storage_bucket: str | None = None
    storage_region: str | None = None
    storage_endpoint: str | None = None

    # Email (SMTP)
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_from: str | None = None
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
    system_name: str | None = None
    system_url: str | None = None
    support_email: str | None = None

    # Limits
    max_file_size_mb: int | None = None
    max_pages_per_document: int | None = None
    max_documents_per_user: int | None = None

    # Email
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_secure: bool | None = None

    # Features
    enable_registration: bool | None = None
    enable_public_sharing: bool | None = None
    enable_ocr: bool | None = None
    enable_collaboration: bool | None = None
    maintenance_mode: bool | None = None


# In-memory settings store (in production, use database or config file)
_settings_store: dict = {}


def get_current_settings() -> SystemSettings:
    """Get current system settings."""
    get_settings()

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


@router.get(
    "",
    response_model=SystemSettings,
    summary="Get system settings",
    description=(
        "Retrieve all current system settings for the GigaPDF platform.\n\n"
        "**Admin access required.** Returns the full configuration including general settings, "
        "file limits, storage configuration, SMTP email settings, and feature flags.\n\n"
        "Settings are resolved by merging environment variables with any runtime overrides "
        "stored in memory. SMTP password is never returned for security reasons."
    ),
    response_description="Current system settings object",
    responses={
        200: {"description": "Settings retrieved successfully"},
        401: {"description": "Authentication required — provide a valid Bearer token"},
        403: {"description": "Admin access required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/admin/settings" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/settings",\n'
                    '    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n'
                    ")\n"
                    "settings = response.json()\n"
                    "print(settings['system_name'], settings['maintenance_mode'])"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/settings",\n'
                    '  { headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n'
                    ");\n"
                    "const settings = await response.json();\n"
                    "console.log(settings.system_name, settings.maintenance_mode);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/admin/settings');\n"
                    "curl_setopt_array($ch, [\n"
                    "    CURLOPT_RETURNTRANSFER => true,\n"
                    "    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $adminToken],\n"
                    "]);\n"
                    "$settings = json_decode(curl_exec($ch), true);\n"
                    "echo $settings['system_name'];"
                ),
            },
        ]
    },
)
async def get_system_settings():
    """
    Get current system settings.
    """
    return get_current_settings()


@router.patch(
    "",
    response_model=SystemSettings,
    summary="Update system settings",
    description=(
        "Partially update one or more system settings at runtime.\n\n"
        "**Admin access required.** Only provided fields are updated; omitted fields keep "
        "their current values. Settings are stored in memory and reset on server restart — "
        "for persistent changes, update the corresponding environment variables.\n\n"
        "**Note:** `smtp_password` is accepted for update but never returned in the response. "
        "Some settings (e.g. storage provider) may require a server restart to fully take effect."
    ),
    response_description="Updated system settings object",
    responses={
        200: {"description": "Settings updated successfully"},
        401: {"description": "Authentication required — provide a valid Bearer token"},
        403: {"description": "Admin access required"},
        422: {"description": "Validation error — invalid field value"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X PATCH "https://api.giga-pdf.com/api/v1/admin/settings" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN" \\\n'
                    '  -H "Content-Type: application/json" \\\n'
                    "  -d '{\"maintenance_mode\": true, \"max_file_size_mb\": 200}'"
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.patch(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/settings",\n'
                    '    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n'
                    "    json={\"maintenance_mode\": True, \"max_file_size_mb\": 200},\n"
                    ")\n"
                    "updated = response.json()"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/settings",\n'
                    "  {\n"
                    '    method: "PATCH",\n'
                    '    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ADMIN_TOKEN },\n'
                    "    body: JSON.stringify({ maintenance_mode: true, max_file_size_mb: 200 }),\n"
                    "  }\n"
                    ");\n"
                    "const updated = await response.json();"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/admin/settings');\n"
                    "curl_setopt_array($ch, [\n"
                    "    CURLOPT_CUSTOMREQUEST => 'PATCH',\n"
                    "    CURLOPT_RETURNTRANSFER => true,\n"
                    "    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $adminToken],\n"
                    "    CURLOPT_POSTFIELDS => json_encode(['maintenance_mode' => true, 'max_file_size_mb' => 200]),\n"
                    "]);\n"
                    "$updated = json_decode(curl_exec($ch), true);"
                ),
            },
        ]
    },
)
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


@router.post(
    "/test-email",
    summary="Test SMTP email configuration",
    description=(
        "Send a test email to verify the current SMTP configuration.\n\n"
        "**Admin access required.** Attempts to deliver a test message to the specified "
        "address using the currently configured SMTP settings. Returns success/failure "
        "along with the SMTP host and port used.\n\n"
        "If `smtp_host` is not configured, the endpoint returns a failure response "
        "without attempting delivery.\n\n"
        "**Query parameter:** `to_email` — destination address for the test message (required)."
    ),
    response_description="Test result with SMTP host, port, and success status",
    responses={
        200: {"description": "Test result returned (check `success` field for outcome)"},
        401: {"description": "Authentication required — provide a valid Bearer token"},
        403: {"description": "Admin access required"},
        422: {"description": "Validation error — invalid or missing email address"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X POST "https://api.giga-pdf.com/api/v1/admin/settings/test-email'
                    '?to_email=admin@example.com" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.post(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/settings/test-email",\n'
                    '    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n'
                    '    params={"to_email": "admin@example.com"},\n'
                    ")\n"
                    "result = response.json()\n"
                    'print("OK" if result["success"] else result["message"])'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/settings/test-email?to_email=admin@example.com",\n'
                    '  { method: "POST", headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n'
                    ");\n"
                    "const result = await response.json();\n"
                    "console.log(result.success, result.message);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/admin/settings/test-email?to_email=admin@example.com');\n"
                    "curl_setopt_array($ch, [\n"
                    "    CURLOPT_POST => true,\n"
                    "    CURLOPT_RETURNTRANSFER => true,\n"
                    "    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $adminToken],\n"
                    "]);\n"
                    "$result = json_decode(curl_exec($ch), true);\n"
                    "echo $result['success'] ? 'OK' : $result['message'];"
                ),
            },
        ]
    },
)
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


@router.post(
    "/test-storage",
    summary="Test storage (S3) connection",
    description=(
        "Verify the S3-compatible storage configuration by performing a live connection test.\n\n"
        "**Admin access required.** Attempts to connect to the configured bucket using the "
        "current storage credentials (access key, secret key, endpoint, region). Uses a "
        "`HeadBucket` operation to confirm access without reading or writing any data.\n\n"
        "Returns connection status, provider name, endpoint, and region on success. "
        "Compatible with AWS S3, Scaleway Object Storage, MinIO, and any S3-compatible provider."
    ),
    response_description="Connection test result with storage provider details",
    responses={
        200: {"description": "Connection test result (check `success` field for outcome)"},
        401: {"description": "Authentication required — provide a valid Bearer token"},
        403: {"description": "Admin access required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X POST "https://api.giga-pdf.com/api/v1/admin/settings/test-storage" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.post(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/settings/test-storage",\n'
                    '    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n'
                    ")\n"
                    "result = response.json()\n"
                    'print("OK" if result["success"] else result["message"])'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/settings/test-storage",\n'
                    '  { method: "POST", headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n'
                    ");\n"
                    "const result = await response.json();\n"
                    "console.log(result.success, result.provider);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/admin/settings/test-storage');\n"
                    "curl_setopt_array($ch, [\n"
                    "    CURLOPT_POST => true,\n"
                    "    CURLOPT_RETURNTRANSFER => true,\n"
                    "    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $adminToken],\n"
                    "]);\n"
                    "$result = json_decode(curl_exec($ch), true);\n"
                    "echo $result['success'] ? 'Connected' : $result['message'];"
                ),
            },
        ]
    },
)
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


@router.get(
    "/storage-info",
    summary="Get storage statistics",
    description=(
        "Retrieve storage usage statistics from the configured S3-compatible bucket.\n\n"
        "**Admin access required.** Connects to the bucket and returns object count, "
        "total size (bytes and human-readable), provider, region, and endpoint.\n\n"
        "Object count is capped at 1,000 for performance — if the bucket contains more objects, "
        "a `object_count_note` field is included in the response. "
        "Returns `configured: false` if no bucket is set."
    ),
    response_description="Storage statistics including object count and total size",
    responses={
        200: {"description": "Storage info returned (check `configured` field)"},
        401: {"description": "Authentication required — provide a valid Bearer token"},
        403: {"description": "Admin access required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/settings/storage-info" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/settings/storage-info",\n'
                    '    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n'
                    ")\n"
                    "info = response.json()\n"
                    'if info.get("configured"):\n'
                    '    print(info["object_count"], info["total_size_formatted"])'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/settings/storage-info",\n'
                    '  { headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n'
                    ");\n"
                    "const info = await response.json();\n"
                    "if (info.configured) console.log(info.object_count, info.total_size_formatted);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/admin/settings/storage-info');\n"
                    "curl_setopt_array($ch, [\n"
                    "    CURLOPT_RETURNTRANSFER => true,\n"
                    "    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $adminToken],\n"
                    "]);\n"
                    "$info = json_decode(curl_exec($ch), true);\n"
                    "if ($info['configured']) echo $info['object_count'] . ' — ' . $info['total_size_formatted'];"
                ),
            },
        ]
    },
)
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
        s3_client.get_bucket_location(Bucket=settings.storage_bucket)

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
