"""
Storage maintenance tasks.

Handles periodic purge of trashed (soft-deleted) stored documents:
documents left in the trash for more than the retention period are
permanently deleted (S3 version files + thumbnail + database records).
"""

import logging
from datetime import UTC, datetime, timedelta

from celery import shared_task
from sqlalchemy import select

from app.core.database import get_sync_session
from app.models.database import DocumentVersion, StoredDocument

logger = logging.getLogger(__name__)

# Documents stay in the trash for 30 days before permanent deletion
TRASH_RETENTION_DAYS = 30

# Process the purge in bounded batches to keep transactions short
_PURGE_BATCH_SIZE = 200


@shared_task(
    name="app.tasks.storage_tasks.purge_trashed_documents",
    bind=True,
    max_retries=1,
)
def purge_trashed_documents(self, retention_days: int = TRASH_RETENTION_DAYS) -> dict:
    """
    Permanently delete documents trashed more than ``retention_days`` ago.

    Runs daily via Celery Beat. Mirrors the behaviour of
    ``DELETE /api/v1/storage/documents/{id}?permanent=true``:

    - Deletes every version file from S3 (best-effort)
    - Deletes the thumbnail from S3 (best-effort)
    - Deletes the database row (FK cascade removes versions, shares,
      invitations and activity logs)
    - Does NOT touch quotas: they were already freed at soft-delete time

    Args:
        retention_days: Trash retention period in days (default 30).

    Returns:
        dict: Purge statistics (purged_count, s3_deleted, errors).
    """
    from app.services.s3_service import s3_service

    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    purged_count = 0
    s3_deleted = 0
    errors: list[str] = []

    logger.info(
        f"Purging trashed documents older than {retention_days} days "
        f"(cutoff: {cutoff.isoformat()})"
    )

    try:
        while True:
            # Collect a batch of expired trash entries with their S3 keys,
            # then delete the DB rows in the same short transaction.
            batch_keys: list[str] = []

            with get_sync_session() as session:
                result = session.execute(
                    select(StoredDocument)
                    .where(
                        StoredDocument.is_deleted,
                        StoredDocument.deleted_at.is_not(None),
                        StoredDocument.deleted_at < cutoff,
                    )
                    .limit(_PURGE_BATCH_SIZE)
                )
                documents = result.scalars().all()

                if not documents:
                    break

                doc_ids = [doc.id for doc in documents]

                versions_result = session.execute(
                    select(DocumentVersion.file_path).where(
                        DocumentVersion.document_id.in_(doc_ids)
                    )
                )
                batch_keys.extend(
                    row[0] for row in versions_result.all() if row[0]
                )
                batch_keys.extend(
                    doc.thumbnail_path for doc in documents if doc.thumbnail_path
                )

                for doc in documents:
                    logger.debug(
                        f"Purging trashed document {doc.id} "
                        f"(deleted_at={doc.deleted_at})"
                    )
                    # FK cascade removes versions/shares/invitations/activity
                    session.delete(doc)

                purged_count += len(documents)
                # get_sync_session commits on context exit

            # S3 cleanup AFTER the DB commit — an orphan S3 object is
            # harmless, a DB row pointing to a deleted file is not.
            for key in batch_keys:
                try:
                    if s3_service.delete_file(key):
                        s3_deleted += 1
                except Exception as e:  # pragma: no cover — defensive
                    errors.append(f"{key}: {e}")
                    logger.warning(f"Failed to delete S3 object {key}: {e}")

    except Exception as e:
        logger.error(f"Trash purge failed: {e}", exc_info=True)
        raise self.retry(exc=e)

    logger.info(
        f"Trash purge complete: {purged_count} documents purged, "
        f"{s3_deleted} S3 objects deleted, {len(errors)} errors"
    )

    return {
        "purged_count": purged_count,
        "s3_deleted": s3_deleted,
        "retention_days": retention_days,
        "errors": errors,
    }
