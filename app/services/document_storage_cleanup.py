"""Object-storage cleanup shared by every path that hard-deletes documents.

A stored document owns several objects: one per version (``file_path``) and an
optional thumbnail. Every hard-delete path (owner permanent delete, admin
permanent delete, account erasure) must collect the same set of keys; keeping
the query here stops a path from forgetting the thumbnails or older versions.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import DocumentVersion, StoredDocument
from app.services.s3_service import s3_service

logger = logging.getLogger(__name__)


async def collect_document_object_keys(
    db: AsyncSession, documents: Sequence[StoredDocument]
) -> list[str]:
    """Return every object key (all versions + thumbnail) of ``documents``."""
    if not documents:
        return []
    version_rows = await db.execute(
        select(DocumentVersion.file_path).where(
            DocumentVersion.document_id.in_([document.id for document in documents])
        )
    )
    keys = [row[0] for row in version_rows.all() if row[0]]
    keys.extend(document.thumbnail_path for document in documents if document.thumbnail_path)
    # dict.fromkeys keeps the order while dropping duplicates.
    return list(dict.fromkeys(keys))


def delete_objects_best_effort(keys: Sequence[str]) -> int:
    """Delete ``keys`` after the database commit; returns how many succeeded.

    Used once the rows are gone: an orphan object is recoverable (and
    harmless), whereas a row pointing to a deleted object is not, so a failure
    here is logged rather than raised.
    """
    deleted = 0
    for key in keys:
        if s3_service.delete_file(key):
            deleted += 1
    if deleted != len(keys):
        logger.warning(
            "Document storage cleanup left %d of %d objects behind",
            len(keys) - deleted,
            len(keys),
        )
    return deleted
