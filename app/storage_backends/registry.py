"""
Storage provider registry.

``STORAGE_PROVIDER`` selects the backend:

* a registered name (``idrive``, ``scaleway``, ``aws``, ``minio``, ``s3``,
  ``local``), or
* a dotted path ``package.module:factory`` to any callable that takes the
  :class:`~app.config.Settings` and returns a
  :class:`~app.storage_backends.base.StorageBackend` — no change needed in this repo
  to plug in a new service.

Code can also register its own providers with :func:`register_storage_provider`.
"""

from __future__ import annotations

import importlib
import threading
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING

from app.storage_backends.base import StorageBackend, StorageConfigurationError
from app.storage_backends.local import LocalFilesystemBackend
from app.storage_backends.s3 import S3_PROVIDER_PRESETS, S3BackendConfig, S3CompatibleBackend

if TYPE_CHECKING:
    from app.config import Settings

BackendFactory = Callable[["Settings"], StorageBackend]

_FACTORIES: dict[str, BackendFactory] = {}
_backend: StorageBackend | None = None
_backend_lock = threading.Lock()


def register_storage_provider(name: str, factory: BackendFactory) -> None:
    """Register (or replace) a provider factory under ``name``."""
    _FACTORIES[name.lower()] = factory


def available_storage_providers() -> list[str]:
    return sorted(_FACTORIES)


def _s3_factory(provider: str, settings: Settings) -> StorageBackend:
    config = S3BackendConfig.from_preset(
        provider,
        bucket=settings.s3_bucket_name,
        access_key_id=settings.s3_access_key_id,
        secret_access_key=settings.s3_secret_access_key,
        endpoint_url=settings.s3_endpoint or None,
        region=settings.s3_region or None,
        addressing_style=settings.s3_addressing_style or None,
        server_side_encryption=settings.s3_server_side_encryption,
    )
    return S3CompatibleBackend(config)


def _local_factory(settings: Settings) -> StorageBackend:
    root = settings.storage_local_root or Path(settings.storage_path) / "objects"
    return LocalFilesystemBackend(root, bucket=settings.s3_bucket_name)


for _name in S3_PROVIDER_PRESETS:
    register_storage_provider(_name, partial(_s3_factory, _name))
register_storage_provider("local", _local_factory)


def _import_factory(path: str) -> BackendFactory:
    module_name, _, attr = path.partition(":")
    if not module_name or not attr:
        raise StorageConfigurationError(
            f"Invalid custom storage provider {path!r}; expected 'package.module:factory'"
        )
    module = importlib.import_module(module_name)
    factory = getattr(module, attr, None)
    if not callable(factory):
        raise StorageConfigurationError(f"{path!r} is not callable")
    return factory


def create_storage_backend(
    settings: Settings | None = None, provider: str | None = None
) -> StorageBackend:
    """Build a new backend for ``provider`` (default: ``settings.storage_provider``)."""
    if settings is None:
        from app.config import get_settings

        settings = get_settings()
    name = (provider or settings.storage_provider or "").strip()
    if ":" in name:
        factory = _import_factory(name)
    else:
        factory = _FACTORIES.get(name.lower())
        if factory is None:
            raise StorageConfigurationError(
                f"Unknown storage provider {name!r}. "
                f"Available: {', '.join(available_storage_providers())} "
                "or 'package.module:factory'"
            )
    backend = factory(settings)
    if not isinstance(backend, StorageBackend):
        raise StorageConfigurationError(
            f"Storage provider {name!r} did not return a StorageBackend"
        )
    return backend


def get_storage_backend() -> StorageBackend:
    """Process-wide backend built from the application settings."""
    global _backend
    if _backend is None:
        with _backend_lock:
            if _backend is None:
                _backend = create_storage_backend()
    return _backend


def set_storage_backend(backend: StorageBackend | None) -> None:
    """Override (or reset with ``None``) the process-wide backend — tests, tooling."""
    global _backend
    with _backend_lock:
        _backend = backend
