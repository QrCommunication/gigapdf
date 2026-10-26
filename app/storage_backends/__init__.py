"""
Pluggable object storage.

Business code uses :func:`get_storage_backend` (or the higher-level
``app.services.s3_service.object_storage`` facade) and never depends on a
specific provider. See ``docs/storage.md``.
"""

from app.storage_backends.base import (
    ObjectHead,
    PresignNotSupportedError,
    StorageBackend,
    StorageConfigurationError,
    StorageError,
    StoredObject,
)
from app.storage_backends.local import LocalFilesystemBackend
from app.storage_backends.registry import (
    available_storage_providers,
    create_storage_backend,
    get_storage_backend,
    register_storage_provider,
    set_storage_backend,
)
from app.storage_backends.s3 import S3_PROVIDER_PRESETS, S3BackendConfig, S3CompatibleBackend

__all__ = [
    "LocalFilesystemBackend",
    "ObjectHead",
    "PresignNotSupportedError",
    "S3BackendConfig",
    "S3CompatibleBackend",
    "S3_PROVIDER_PRESETS",
    "StorageBackend",
    "StorageConfigurationError",
    "StorageError",
    "StoredObject",
    "available_storage_providers",
    "create_storage_backend",
    "get_storage_backend",
    "register_storage_provider",
    "set_storage_backend",
]
