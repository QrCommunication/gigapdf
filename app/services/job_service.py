"""
Job Service - Async job management operations.

Handles job creation, tracking, and cancellation.
"""

import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.database import AsyncJob
from app.tasks.celery_app import celery_app
from app.utils.helpers import generate_uuid, now_utc

logger = logging.getLogger(__name__)


class JobService:
    """Service for managing async jobs."""

    async def get_job(self, db: AsyncSession, job_id: str) -> Optional[AsyncJob]:
        """
        Get job by ID.

        Args:
            db: Database session.
            job_id: Job identifier.

        Returns:
            AsyncJob if found, None otherwise.
        """
        result = await db.execute(select(AsyncJob).where(AsyncJob.id == job_id))
        return result.scalar_one_or_none()

    async def list_user_jobs(
        self,
        db: AsyncSession,
        user_id: str,
        page: int = 1,
        per_page: int = 20,
        job_type: Optional[str] = None,
        status: Optional[str] = None,
    ) -> tuple[list[AsyncJob], int]:
        """
        List jobs for a user with pagination.

        Args:
            db: Database session.
            user_id: User identifier.
            page: Page number (1-indexed).
            per_page: Items per page.
            job_type: Filter by job type.
            status: Filter by status.

        Returns:
            Tuple of (jobs, total_count).
        """
        # Build query
        query = select(AsyncJob).where(AsyncJob.owner_id == user_id)

        if job_type:
            query = query.where(AsyncJob.job_type == job_type)

        if status:
            query = query.where(AsyncJob.status == status)

        # Get total count
        count_result = await db.execute(
            select(AsyncJob.id).where(AsyncJob.owner_id == user_id)
        )
        total = len(count_result.all())

        # Order and paginate
        query = query.order_by(AsyncJob.created_at.desc())
        offset = (page - 1) * per_page
        query = query.offset(offset).limit(per_page)

        result = await db.execute(query)
        jobs = result.scalars().all()

        return list(jobs), total

    async def create_job(
        self,
        db: AsyncSession,
        job_type: str,
        owner_id: str,
        document_id: Optional[str] = None,
        input_params: Optional[dict] = None,
    ) -> AsyncJob:
        """
        Create a new async job.

        Args:
            db: Database session.
            job_type: Type of job.
            owner_id: User identifier.
            document_id: Associated document ID.
            input_params: Job parameters.

        Returns:
            Created AsyncJob.
        """
        job_id = generate_uuid()
        job = AsyncJob(
            id=job_id,
            job_type=job_type,
            status="pending",
            progress=0.0,
            document_id=document_id,
            owner_id=owner_id,
            input_params=input_params,
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)
        return job

    async def update_job_status(
        self,
        db: AsyncSession,
        job_id: str,
        status: str,
        progress: Optional[float] = None,
        result: Optional[dict] = None,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> Optional[AsyncJob]:
        """
        Update job status.

        Args:
            db: Database session.
            job_id: Job identifier.
            status: New status.
            progress: Progress percentage.
            result: Job result data.
            error_code: Error code if failed.
            error_message: Error message if failed.

        Returns:
            Updated job if found.
        """
        job = await self.get_job(db, job_id)
        if not job:
            return None

        job.status = status

        if progress is not None:
            job.progress = progress

        if result is not None:
            job.result = result

        if error_code:
            job.error_code = error_code
            job.error_message = error_message

        if status == "processing" and not job.started_at:
            job.started_at = now_utc()

        if status in ("completed", "failed", "cancelled"):
            job.completed_at = now_utc()

        await db.commit()
        await db.refresh(job)
        return job

    async def cancel_job(self, db: AsyncSession, job_id: str) -> Optional[AsyncJob]:
        """
        Cancel a running job.

        Args:
            db: Database session.
            job_id: Job identifier.

        Returns:
            Cancelled job if found and cancellable.
        """
        job = await self.get_job(db, job_id)
        if not job:
            return None

        if job.status in ("completed", "failed", "cancelled"):
            raise ValueError(f"Cannot cancel job with status: {job.status}")

        # Cancel Celery task
        if job.celery_task_id:
            celery_app.control.revoke(job.celery_task_id, terminate=True)

        job.status = "cancelled"
        job.completed_at = now_utc()

        await db.commit()
        await db.refresh(job)
        return job


# Global service instance
job_service = JobService()
