"""
Copy objects from one storage backend to another (e.g. Scaleway → iDrive e2).

Keys, bytes, content type and metadata are preserved, so database rows
(``file_path``, ``thumbnail_path``, encrypted DEKs) stay valid after a switch
of ``STORAGE_PROVIDER``. Used by ``scripts/migrate_storage.py``.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from app.storage_backends.base import StorageBackend, StoredObject

logger = logging.getLogger(__name__)


@dataclass
class MigrationStats:
    scanned: int = 0
    copied: int = 0
    skipped: int = 0
    bytes_copied: int = 0
    errors: list[str] = field(default_factory=list)


def _copy_one(
    obj: StoredObject, source: StorageBackend, dest: StorageBackend, overwrite: bool
) -> tuple[str, int]:
    """Copy a single object. Returns ("copied"|"skipped", bytes)."""
    if not overwrite:
        existing = dest.head_object(obj.key)
        if existing is not None and existing.size == obj.size:
            return "skipped", 0

    data = source.get_object(obj.key)
    if data is None:  # deleted between listing and copy
        return "skipped", 0
    head = source.head_object(obj.key)
    dest.put_object(
        obj.key,
        data,
        content_type=(head.content_type if head else None) or "application/octet-stream",
        metadata=head.metadata if head else None,
    )
    return "copied", len(data)


def migrate_objects(
    source: StorageBackend,
    dest: StorageBackend,
    prefix: str = "",
    *,
    dry_run: bool = False,
    overwrite: bool = False,
    workers: int = 8,
    on_progress: Callable[[MigrationStats], None] | None = None,
) -> MigrationStats:
    """Copy every object under ``prefix`` from ``source`` to ``dest``.

    Idempotent: objects already present in ``dest`` with the same size are
    skipped unless ``overwrite`` is set.
    """
    stats = MigrationStats()
    lock = threading.Lock()

    def handle(obj: StoredObject) -> None:
        try:
            outcome, size = _copy_one(obj, source, dest, overwrite)
        except Exception as e:
            logger.warning("Failed to migrate %s: %s", obj.key, e)
            with lock:
                stats.errors.append(f"{obj.key}: {e}")
            return
        with lock:
            if outcome == "copied":
                stats.copied += 1
                stats.bytes_copied += size
            else:
                stats.skipped += 1

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = []
        for obj in source.iter_objects(prefix):
            stats.scanned += 1
            if dry_run:
                continue
            futures.append(pool.submit(handle, obj))
            # Bound memory: drain in batches.
            if len(futures) >= workers * 4:
                for f in futures:
                    f.result()
                futures.clear()
                if on_progress:
                    on_progress(stats)
        for f in futures:
            f.result()

    if on_progress:
        on_progress(stats)
    return stats
