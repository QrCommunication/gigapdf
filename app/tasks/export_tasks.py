"""
Export Celery tasks.

The document export task (``export_document``) and its synchronous image-export
endpoint have been removed. Image rendering and Office/text/HTML conversions are
now performed entirely by the Next.js TypeScript engine and the
``@giga-pdf/pdf-engine`` package; the Python side no longer exports documents.

Only the periodic cleanup of any leftover export files on disk remains here.
"""

import logging
import os
from datetime import UTC, datetime, timedelta

from app.config import get_settings
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()

# Directory where legacy export files may still reside (cleaned up below).
EXPORT_DIR = os.path.join(settings.storage_path, "exports")


def _ensure_export_dir() -> None:
    """Ensure the export directory exists."""
    os.makedirs(EXPORT_DIR, exist_ok=True)


@celery_app.task(name="app.tasks.export_tasks.cleanup_expired_exports")
def cleanup_expired_exports(max_age_hours: int = 24) -> dict:
    """
    Cleanup old export files.

    Args:
        max_age_hours: Maximum age in hours before deletion.

    Returns:
        dict: Cleanup statistics.
    """
    _ensure_export_dir()

    cutoff_time = datetime.now(UTC) - timedelta(hours=max_age_hours)
    deleted_count = 0
    deleted_bytes = 0
    errors = []

    try:
        for filename in os.listdir(EXPORT_DIR):
            filepath = os.path.join(EXPORT_DIR, filename)

            try:
                # Check file modification time
                mtime = datetime.fromtimestamp(os.path.getmtime(filepath), tz=UTC)

                if mtime < cutoff_time:
                    file_size = os.path.getsize(filepath)
                    os.remove(filepath)
                    deleted_count += 1
                    deleted_bytes += file_size
                    logger.debug(f"Deleted expired export: {filename}")

            except Exception as e:
                errors.append(f"{filename}: {str(e)}")
                logger.warning(f"Failed to cleanup {filename}: {e}")

    except Exception as e:
        logger.error(f"Failed to list export directory: {e}")
        errors.append(f"Directory listing: {str(e)}")

    logger.info(f"Cleanup complete: deleted {deleted_count} files ({deleted_bytes / 1024 / 1024:.2f} MB)")

    return {
        "deleted_count": deleted_count,
        "deleted_bytes": deleted_bytes,
        "errors": errors,
    }
