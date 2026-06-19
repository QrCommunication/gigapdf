"""
Celery application configuration.

Configures Celery for async task processing including
export, billing, storage, and infrastructure operations.

Note: the legacy OCR task (app.tasks.ocr_tasks.process_ocr) was removed on
2026-06-13 — OCR is handled by the TypeScript pdf-engine via /api/pdf/ocr.
"""

import logging
from datetime import UTC, datetime

from celery import Celery
from celery.signals import task_failure, task_postrun

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

celery_app = Celery(
    "giga-pdf",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.tasks.export_tasks",
        "app.tasks.billing_tasks",
        "app.tasks.infra_tasks",
        "app.tasks.storage_tasks",
    ],
)

# Celery configuration
celery_app.conf.update(
    # Task settings
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,

    # Task execution settings
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_time_limit=settings.job_timeout_seconds,
    task_soft_time_limit=settings.job_timeout_seconds - 60,

    # Worker settings
    worker_prefetch_multiplier=1,
    worker_concurrency=4,

    # Result settings
    result_expires=3600,  # 1 hour

    # Queues
    task_routes={
        # Only cleanup_expired_exports remains in export_tasks; route it here.
        "app.tasks.export_tasks.*": {"queue": "export"},
        "app.tasks.billing_tasks.*": {"queue": "billing"},
        "app.tasks.infra_tasks.*": {"queue": "infra"},
        "billing.*": {"queue": "billing"},
        "infra.*": {"queue": "infra"},
    },

    # Default queue
    task_default_queue="default",

    # Celery Beat schedule for periodic tasks
    beat_schedule={
        # Billing tasks
        "sync-plans-to-stripe": {
            "task": "billing.sync_plans_to_stripe",
            "schedule": 3600.0,  # Every hour
        },
        "process-overdue-payments": {
            "task": "billing.process_overdue_payments",
            "schedule": 86400.0,  # Every 24 hours
        },
        "process-expired-trials": {
            "task": "billing.process_expired_trials",
            "schedule": 3600.0,  # Every hour
        },
        "send-trial-reminders": {
            "task": "billing.send_trial_reminders",
            "schedule": 86400.0,  # Every 24 hours
        },
        "cleanup-stale-subscriptions": {
            "task": "billing.cleanup_stale_subscriptions",
            "schedule": 86400.0,  # Every 24 hours
        },
        # Cleanup expired export files
        "cleanup-export-files": {
            "task": "app.tasks.export_tasks.cleanup_expired_exports",
            "schedule": 3600.0,  # Every hour
        },
        # Purge stored documents trashed more than 30 days ago
        "purge-trashed-documents": {
            "task": "app.tasks.storage_tasks.purge_trashed_documents",
            "schedule": 86400.0,  # Every 24 hours
        },
        # Infrastructure monitoring
        "collect-infrastructure-metrics": {
            "task": "infra.collect_metrics",
            "schedule": 900.0,  # Every 15 minutes
        },
        "cleanup-old-metrics": {
            "task": "infra.cleanup_old_metrics",
            "schedule": 86400.0,  # Every 24 hours
        },
        # Watchdog for stuck/pending tasks (checks every 10 minutes)
        "watchdog-pending-tasks": {
            "task": "infra.watchdog_pending_tasks",
            "schedule": 600.0,  # Every 10 minutes
            "kwargs": {"timeout_hours": 1},
        },
    },
)


# Signal handlers for updating job status in database.
#
# These run inside the synchronous Celery worker process and MUST use the
# synchronous SQLAlchemy session (get_sync_session / psycopg2) — exactly like
# storage_tasks and infra_tasks. The async engine (asyncpg) must NOT be used
# here: the export task spins up per-call event loops (_render_page_via_ts_sync),
# and reusing asyncpg connections across those loops raised
# "Event loop is closed" / "Future attached to a different loop", silently
# leaving finished jobs stuck in "processing".
def _update_job_completed_sync(celery_task_id: str, result: dict, state: str) -> None:
    """Update job status in database after task completion (sync, for Celery)."""
    from sqlalchemy import select

    from app.core.database import get_sync_session
    from app.models.database import AsyncJob

    try:
        with get_sync_session() as session:
            stmt = select(AsyncJob).where(AsyncJob.celery_task_id == celery_task_id)
            job = session.execute(stmt).scalar_one_or_none()

            if job:
                job.status = "completed" if state == "SUCCESS" else "failed"
                job.progress = 100.0
                job.completed_at = datetime.now(UTC)

                # Store result (file_path instead of binary data)
                if isinstance(result, dict):
                    # Remove binary data from result, keep file_path
                    job.result = {
                        k: v for k, v in result.items()
                        if not (k == "data" and isinstance(v, bytes))
                    }
                else:
                    job.result = {"status": "completed"}

                # get_sync_session commits on context exit
                logger.info(f"Updated job {job.id} status to {job.status}")
    except Exception as e:
        logger.error(f"Failed to update job status for task {celery_task_id}: {e}")


def _update_job_failed_sync(celery_task_id: str, error_message: str) -> None:
    """Update job status when task fails (sync, for Celery)."""
    from sqlalchemy import select

    from app.core.database import get_sync_session
    from app.models.database import AsyncJob

    try:
        with get_sync_session() as session:
            stmt = select(AsyncJob).where(AsyncJob.celery_task_id == celery_task_id)
            job = session.execute(stmt).scalar_one_or_none()

            if job:
                job.status = "failed"
                job.error_message = error_message[:1000] if error_message else "Unknown error"
                job.completed_at = datetime.now(UTC)
                # get_sync_session commits on context exit
                logger.error(f"Marked job {job.id} as failed: {error_message[:100]}")
    except Exception as e:
        logger.error(f"Failed to update job failure for task {celery_task_id}: {e}")


@task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, retval=None, state=None, **kwargs):
    """
    Global handler for all task completions.

    Covers:
    - app.tasks.export_tasks.* (export operations)
    - billing.* (billing operations)
    - infra.* (infrastructure tasks)
    """
    if not task or not task_id:
        return

    task_name = task.name or ""

    # Global coverage: handle all application tasks
    tracked_prefixes = (
        "app.tasks.export_tasks.",
        "billing.",
        "infra.",
    )

    if any(task_name.startswith(prefix) for prefix in tracked_prefixes):
        logger.debug(f"Task {task_name} ({task_id}) completed with state {state}")
        _update_job_completed_sync(task_id, retval or {}, state)


@task_failure.connect
def task_failure_handler(sender=None, task_id=None, exception=None, **kwargs):
    """
    Global handler for all task failures.

    Catches failures for:
    - app.tasks.export_tasks.* (export operations)
    - billing.* (billing operations)
    - infra.* (infrastructure tasks)
    """
    if not task_id or not exception:
        return

    logger.error(f"Task {task_id} failed: {exception}")
    _update_job_failed_sync(task_id, str(exception))
