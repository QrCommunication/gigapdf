"""
Storage backend contract.

Every object-storage provider (iDrive e2, Scaleway, AWS, MinIO, local disk,
or anything custom) implements :class:`StorageBackend`. The rest of the
application only talks to this interface, so switching provider is a matter
of configuration (``STORAGE_PROVIDER``) and never touches business code.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

PresignMethod = Literal["get", "put"]


class StorageError(Exception):
    """Base error raised by storage backends."""


class StorageConfigurationError(StorageError):
    """The backend is missing configuration (credentials, endpoint, ...)."""


class PresignNotSupportedError(StorageError):
    """The backend cannot generate presigned URLs (e.g. local filesystem)."""


@dataclass(frozen=True)
class StoredObject:
    """Listing entry for one stored object."""

    key: str
    size: int
    last_modified: datetime | None = None
    etag: str = ""


@dataclass(frozen=True)
class ObjectHead:
    """Object metadata, without the body."""

    key: str
    size: int
    content_type: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)


class StorageBackend(ABC):
    """Abstract object store addressed by string keys inside one bucket.

    Keys use ``/`` as separator (``documents/{user}/{doc}/v1.pdf``).
    Implementations must be thread-safe: a single instance is shared by the
    API workers and Celery tasks.
    """

    #: Short provider identifier (``idrive``, ``scaleway``, ``local``...).
    provider: str = "unknown"

    #: Bucket / container name, informational.
    bucket: str = ""

    # -- writes -------------------------------------------------------------

    @abstractmethod
    def put_object(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> dict:
        """Store ``data`` under ``key``. Returns at least ``{"etag": str}``."""

    @abstractmethod
    def delete_object(self, key: str) -> None:
        """Delete ``key``. Deleting a missing key is not an error."""

    @abstractmethod
    def copy_object(
        self,
        source_key: str,
        dest_key: str,
        content_type: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> None:
        """Copy an object inside the bucket (server-side when possible).

        When ``content_type`` or ``metadata`` is given they replace the
        source values; otherwise the source values are kept.
        """

    # -- reads --------------------------------------------------------------

    @abstractmethod
    def get_object(self, key: str) -> bytes | None:
        """Return the object bytes, or ``None`` when the key does not exist."""

    @abstractmethod
    def head_object(self, key: str) -> ObjectHead | None:
        """Return object metadata, or ``None`` when the key does not exist."""

    def object_exists(self, key: str) -> bool:
        return self.head_object(key) is not None

    @abstractmethod
    def iter_objects(self, prefix: str = "") -> Iterator[StoredObject]:
        """Iterate over every object whose key starts with ``prefix``."""

    def list_objects(self, prefix: str = "", max_keys: int = 1000) -> list[StoredObject]:
        result: list[StoredObject] = []
        for obj in self.iter_objects(prefix):
            if len(result) >= max_keys:
                break
            result.append(obj)
        return result

    # -- URLs ---------------------------------------------------------------

    @abstractmethod
    def presigned_url(
        self, key: str, expires_in: int = 3600, method: PresignMethod = "get"
    ) -> str:
        """Return a temporary URL giving direct access to ``key``.

        Raises :class:`PresignNotSupportedError` when the backend has no
        such concept.
        """

    def public_url(self, key: str) -> str:
        """Informational, non-signed location of ``key``."""
        return f"{self.provider}://{self.bucket}/{key}"

    # -- health -------------------------------------------------------------

    def bucket_encryption(self) -> str | None:
        """Default encryption configured on the bucket itself.

        Returns the algorithm (``AES256``, ``aws:kms``...), ``"disabled"``
        when the bucket has none, or ``None`` when it cannot be determined.
        """
        return None

    @abstractmethod
    def check_connection(self) -> None:
        """Raise if the bucket is unreachable or credentials are invalid."""

    def describe(self) -> dict:
        """Non-secret description used by the admin settings page."""
        return {"provider": self.provider, "bucket": self.bucket}
