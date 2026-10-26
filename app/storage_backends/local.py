"""
Local filesystem backend — for development, tests and single-node setups.

Objects are plain files under ``root``; content type and metadata live in a
``<file>.meta.json`` sidecar. Presigned URLs are not supported.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from app.storage_backends.base import (
    ObjectHead,
    PresignMethod,
    PresignNotSupportedError,
    StorageBackend,
    StorageError,
    StoredObject,
)

_META_SUFFIX = ".meta.json"


class LocalFilesystemBackend(StorageBackend):
    provider = "local"

    def __init__(self, root: Path | str, bucket: str = "local"):
        self.root = Path(root).resolve()
        self.bucket = bucket
        self.root.mkdir(parents=True, exist_ok=True)

    # -- helpers ------------------------------------------------------------

    def _path(self, key: str) -> Path:
        if not key or key.endswith(_META_SUFFIX):
            raise StorageError(f"Invalid object key: {key!r}")
        path = (self.root / key).resolve()
        if path != self.root and self.root not in path.parents:
            raise StorageError(f"Object key escapes storage root: {key!r}")
        return path

    @staticmethod
    def _meta_path(path: Path) -> Path:
        return path.with_name(path.name + _META_SUFFIX)

    @staticmethod
    def _atomic_write(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def _read_meta(self, path: Path) -> dict:
        meta_path = self._meta_path(path)
        if not meta_path.exists():
            return {}
        return json.loads(meta_path.read_text("utf-8"))

    # -- writes -------------------------------------------------------------

    def put_object(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> dict:
        path = self._path(key)
        self._atomic_write(path, data)
        meta = {
            "content_type": content_type,
            "metadata": {k: str(v) for k, v in (metadata or {}).items()},
        }
        self._atomic_write(self._meta_path(path), json.dumps(meta).encode())
        return {"etag": hashlib.md5(data, usedforsecurity=False).hexdigest(), "encryption": None}

    def delete_object(self, key: str) -> None:
        path = self._path(key)
        path.unlink(missing_ok=True)
        self._meta_path(path).unlink(missing_ok=True)

    def copy_object(
        self,
        source_key: str,
        dest_key: str,
        content_type: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> None:
        src, dst = self._path(source_key), self._path(dest_key)
        if not src.exists():
            raise StorageError(f"Source object not found: {source_key}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        meta = self._read_meta(src)
        if content_type or metadata:
            if content_type:
                meta["content_type"] = content_type
            if metadata:
                meta["metadata"] = {k: str(v) for k, v in metadata.items()}
        self._atomic_write(self._meta_path(dst), json.dumps(meta).encode())

    # -- reads --------------------------------------------------------------

    def get_object(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.is_file() else None

    def head_object(self, key: str) -> ObjectHead | None:
        path = self._path(key)
        if not path.is_file():
            return None
        meta = self._read_meta(path)
        return ObjectHead(
            key=key,
            size=path.stat().st_size,
            content_type=meta.get("content_type"),
            metadata=meta.get("metadata", {}),
        )

    def iter_objects(self, prefix: str = "") -> Iterator[StoredObject]:
        for path in sorted(self.root.rglob("*")):
            if not path.is_file() or path.name.endswith(_META_SUFFIX):
                continue
            if path.name.startswith(".tmp-"):
                continue
            key = path.relative_to(self.root).as_posix()
            if not key.startswith(prefix):
                continue
            stat = path.stat()
            yield StoredObject(
                key=key,
                size=stat.st_size,
                last_modified=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
            )

    # -- URLs / health ------------------------------------------------------

    def presigned_url(
        self, key: str, expires_in: int = 3600, method: PresignMethod = "get"
    ) -> str:
        raise PresignNotSupportedError("The local storage backend has no presigned URLs")

    def public_url(self, key: str) -> str:
        return self._path(key).as_uri()

    def check_connection(self) -> None:
        if not os.access(self.root, os.W_OK):
            raise StorageError(f"Storage root is not writable: {self.root}")

    def describe(self) -> dict:
        return {
            "provider": self.provider,
            "provider_label": "Local filesystem",
            "bucket": self.bucket,
            "endpoint": str(self.root),
            "region": None,
        }
