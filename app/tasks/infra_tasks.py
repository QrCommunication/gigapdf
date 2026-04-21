"""
Infrastructure monitoring tasks.

Handles periodic collection and cleanup of infrastructure metrics,
and watchdog monitoring for stuck/pending tasks.
"""

import logging
from datetime import datetime, timedelta

from celery import shared_task
from sqlalchemy import delete, select

from app.core.database import get_sync_session
from app.models.database import InfrastructureMetric, AsyncJob
from app.services.infra_metrics_service import infra_metrics_service

logger = logging.getLogger(__name__)


@shared_task(
    name="infra.collect_metrics",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def collect_infrastructure_metrics(self):
    """
    Collect and store current infrastructure metrics.

    Runs every 15 minutes via Celery Beat.
    Stores CPU, memory, disk, S3, and network statistics.
    """
    try:
        logger.info("Starting infrastructure metrics collection")

        # Collect current metrics
        metrics = infra_metrics_service.collect_current_metrics()

        # Store in database
        with get_sync_session() as session:
            record = InfrastructureMetric(
                cpu_percent=metrics.get("cpu_percent"),
                memory_used_bytes=metrics.get("memory_used_bytes"),
                memory_total_bytes=metrics.get("memory_total_bytes"),
                disk_used_bytes=metrics.get("disk_used_bytes"),
                disk_total_bytes=metrics.get("disk_total_bytes"),
                s3_objects_count=metrics.get("s3_objects_count"),
                s3_total_bytes=metrics.get("s3_total_bytes"),
                network_rx_bytes=metrics.get("network_rx_bytes"),
                network_tx_bytes=metrics.get("network_tx_bytes"),
            )
            session.add(record)
            session.commit()

            logger.info(
                f"Infrastructure metrics collected: "
                f"CPU={metrics.get('cpu_percent', 0):.1f}%, "
                f"Memory={metrics.get('memory_used_bytes', 0) / (1024**3):.1f}GB, "
                f"S3 objects={metrics.get('s3_objects_count', 0)}"
            )

            return {
                "status": "success",
                "record_id": record.id,
                "recorded_at": record.recorded_at.isoformat(),
            }

    except Exception as e:
        logger.error(f"Failed to collect infrastructure metrics: {e}")
        raise self.retry(exc=e)


@shared_task(
    name="infra.cleanup_old_metrics",
    bind=True,
    max_retries=1,
)
def cleanup_old_metrics(self, retention_days: int = 365):
    """
    Delete infrastructure metrics older than retention period.

    Runs once daily via Celery Beat.
    Default retention is 365 days (12 months).
    """
    try:
        logger.info(f"Starting metrics cleanup (retention: {retention_days} days)")

        cutoff = datetime.utcnow() - timedelta(days=retention_days)

        with get_sync_session() as session:
            # Count records to delete
            count_stmt = select(InfrastructureMetric).where(
                InfrastructureMetric.recorded_at < cutoff
            )
            old_records = session.execute(count_stmt).scalars().all()
            count = len(old_records)

            if count > 0:
                # Delete old records
                delete_stmt = delete(InfrastructureMetric).where(
                    InfrastructureMetric.recorded_at < cutoff
                )
                session.execute(delete_stmt)
                session.commit()

                logger.info(f"Deleted {count} infrastructure metrics older than {cutoff}")
            else:
                logger.info("No old infrastructure metrics to clean up")

            return {
                "status": "success",
                "deleted_count": count,
                "cutoff_date": cutoff.isoformat(),
            }

    except Exception as e:
        logger.error(f"Failed to cleanup old metrics: {e}")
        raise self.retry(exc=e)


@shared_task(
    name="infra.watchdog_pending_tasks",
    bind=True,
    max_retries=1,
)
def watchdog_pending_tasks(self, timeout_hours: int = 1):
    """
    Detect and mark tasks stuck in PENDING state for too long.

    Runs periodically to find and recover jobs that:
    - Have celery_task_id set
    - Have status='pending' or 'processing'
    - Have been in that state for > timeout_hours (default: 1 hour)

    Marks them as 'failed' with an error message.

    Args:
        timeout_hours: Hours threshold before marking as failed (default: 1)

    Returns:
        dict: Status with count of recovered tasks
    """
    try:
        logger.info(
            f"Starting watchdog check for tasks stuck > {timeout_hours}h in pending/processing"
        )

        timeout_threshold = datetime.utcnow() - timedelta(hours=timeout_hours)

        with get_sync_session() as session:
            # Find all jobs that are pending/processing AND have a celery_task_id
            stuck_jobs_stmt = select(AsyncJob).where(
                AsyncJob.celery_task_id != None,  # noqa: E711
                AsyncJob.status.in_(["pending", "processing"]),
                AsyncJob.created_at < timeout_threshold,
            )

            stuck_jobs = session.execute(stuck_jobs_stmt).scalars().all()
            count = len(stuck_jobs)

            if count > 0:
                logger.warning(
                    f"Found {count} tasks stuck in pending/processing state"
                )

                for job in stuck_jobs:
                    logger.warning(
                        f"Marking job {job.id} (task_id={job.celery_task_id}) "
                        f"as failed after {timeout_hours}h"
                    )
                    job.status = "failed"
                    job.error_message = (
                        f"Task stuck in pending state for {timeout_hours}+ hours. "
                        f"Marked as failed by watchdog at {datetime.utcnow().isoformat()}"
                    )
                    job.completed_at = datetime.utcnow()

                session.commit()

                logger.info(f"Watchdog recovered {count} stuck tasks")
            else:
                logger.debug("No stuck tasks detected by watchdog")

            return {
                "status": "success",
                "recovered_count": count,
                "threshold_hours": timeout_hours,
                "checked_at": datetime.utcnow().isoformat(),
            }

    except Exception as e:
        logger.error(f"Watchdog task failed: {e}")
        raise self.retry(exc=e)
