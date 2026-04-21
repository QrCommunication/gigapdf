"""
Celery application configuration.

Configures Celery for async task processing including
OCR, export, merge, and split operations.
"""

import asyncio
import logging
from datetime import datetime, timezone

from celery import Celery
from celery.signals import task_postrun, task_failure

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

celery_app = Celery(
    "giga-pdf",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.tasks.ocr_tasks",
        "app.tasks.export_tasks",
        "app.tasks.processing_tasks",
        "app.tasks.billing_tasks",
        "app.tasks.infra_tasks",
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

    # Rate limiting
    task_annotations={
        "app.tasks.ocr_tasks.process_ocr": {"rate_limit": "10/m"},
        "app.tasks.export_tasks.export_document": {"rate_limit": "20/m"},
    },

    # Queues
    task_routes={
        "app.tasks.ocr_tasks.*": {"queue": "ocr"},
        "app.tasks.export_tasks.*": {"queue": "export"},
        "app.tasks.processing_tasks.*": {"queue": "processing"},
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


# Signal handlers for updating job status in database
def _run_async(coro):
    """Run async coroutine in sync context."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If loop is already running, create task
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, coro)
                return future.result(timeout=30)
        else:
            return loop.run_until_complete(coro)
    except RuntimeError:
        # No event loop, create new one
        return asyncio.run(coro)


async def _update_job_completed(celery_task_id: str, result: dict, state: str):
    """Update job status in database after task completion."""
    from app.core.database import get_db_session
    from app.models.database import AsyncJob
    from sqlalchemy import select

    try:
        async with get_db_session() as session:
            stmt = select(AsyncJob).where(AsyncJob.celery_task_id == celery_task_id)
            db_result = await session.execute(stmt)
            job = db_result.scalar_one_or_none()

            if job:
                job.status = "completed" if state == "SUCCESS" else "failed"
                job.progress = 100.0
                job.completed_at = datetime.now(timezone.utc)

                # Store result (file_path instead of binary data)
                if isinstance(result, dict):
                    # Remove binary data from result, keep file_path
                    clean_result = {
                        k: v for k, v in result.items()
                        if k != "data" or not isinstance(v, bytes)
                    }
                    job.result = clean_result
                else:
                    job.result = {"status": "completed"}

                await session.commit()
                logger.info(f"Updated job {job.id} status to {job.status}")
    except Exception as e:
        logger.error(f"Failed to update job status for task {celery_task_id}: {e}")


async def _update_job_failed(celery_task_id: str, error_message: str):
    """Update job status when task fails."""
    from app.core.database import get_db_session
    from app.models.database import AsyncJob
    from sqlalchemy import select

    try:
        async with get_db_session() as session:
            stmt = select(AsyncJob).where(AsyncJob.celery_task_id == celery_task_id)
            db_result = await session.execute(stmt)
            job = db_result.scalar_one_or_none()

            if job:
                job.status = "failed"
                job.error_message = error_message[:1000] if error_message else "Unknown error"
                job.completed_at = datetime.now(timezone.utc)
                await session.commit()
                logger.error(f"Marked job {job.id} as failed: {error_message[:100]}")
    except Exception as e:
        logger.error(f"Failed to update job failure for task {celery_task_id}: {e}")


@task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, retval=None, state=None, **kwargs):
    """
    Global handler for all task completions.

    Covers:
    - app.tasks.export_tasks.* (export operations)
    - app.tasks.ocr_tasks.* (OCR processing)
    - app.tasks.processing_tasks.* (merge, split)
    - billing.* (billing operations)
    - infra.* (infrastructure tasks)
    """
    if not task or not task_id:
        return

    task_name = task.name or ""

    # Global coverage: handle all application tasks
    tracked_prefixes = (
        "app.tasks.export_tasks.",
        "app.tasks.ocr_tasks.",
        "app.tasks.processing_tasks.",
        "billing.",
        "infra.",
    )

    if any(task_name.startswith(prefix) for prefix in tracked_prefixes):
        logger.debug(f"Task {task_name} ({task_id}) completed with state {state}")
        _run_async(_update_job_completed(task_id, retval or {}, state))


@task_failure.connect
def task_failure_handler(sender=None, task_id=None, exception=None, **kwargs):
    """
    Global handler for all task failures.

    Catches failures for:
    - app.tasks.export_tasks.* (export operations)
    - app.tasks.ocr_tasks.* (OCR processing)
    - app.tasks.processing_tasks.* (merge, split)
    - billing.* (billing operations)
    - infra.* (infrastructure tasks)
    """
    if not task_id or not exception:
        return

    logger.error(f"Task {task_id} failed: {exception}")
    _run_async(_update_job_failed(task_id, str(exception)))
