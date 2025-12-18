"""
Admin jobs management endpoints.

Provides job monitoring for the admin panel.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.database import AsyncJob

router = APIRouter()


class JobResponse(BaseModel):
    """Job response model."""
    id: str
    job_type: str
    status: str
    progress: float
    document_id: Optional[str] = None
    owner_id: str
    input_params: Optional[dict] = None
    result: Optional[dict] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    duration_seconds: Optional[float] = None


class JobListResponse(BaseModel):
    """Paginated job list response."""
    jobs: list[JobResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class JobStatsResponse(BaseModel):
    """Job statistics response."""
    total_jobs: int
    pending_jobs: int
    processing_jobs: int
    completed_jobs: int
    failed_jobs: int
    cancelled_jobs: int
    jobs_by_type: dict
    avg_duration_seconds: Optional[float] = None


@router.get("", response_model=JobListResponse)
async def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    job_type: Optional[str] = Query(None),
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    List all jobs with pagination and filtering.
    """
    # Build query
    query = select(AsyncJob)

    # Apply filters
    if status:
        query = query.where(AsyncJob.status == status)

    if job_type:
        query = query.where(AsyncJob.job_type == job_type)

    if owner_id:
        query = query.where(AsyncJob.owner_id == owner_id)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(AsyncJob.created_at.desc())

    # Execute query
    result = await db.execute(query)
    jobs = result.scalars().all()

    # Build response
    job_list = []
    for job in jobs:
        duration = None
        if job.started_at and job.completed_at:
            duration = (job.completed_at - job.started_at).total_seconds()

        job_list.append(JobResponse(
            id=job.id,
            job_type=job.job_type,
            status=job.status,
            progress=job.progress,
            document_id=job.document_id,
            owner_id=job.owner_id,
            input_params=job.input_params,
            result=job.result,
            error_code=job.error_code,
            error_message=job.error_message,
            started_at=job.started_at,
            completed_at=job.completed_at,
            created_at=job.created_at,
            duration_seconds=duration,
        ))

    total_pages = (total + page_size - 1) // page_size

    return JobListResponse(
        jobs=job_list,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/stats", response_model=JobStatsResponse)
async def get_job_stats(
    db: AsyncSession = Depends(get_db),
):
    """
    Get job statistics.
    """
    # Total jobs
    total_result = await db.execute(
        select(func.count()).select_from(AsyncJob)
    )
    total_jobs = total_result.scalar() or 0

    # Jobs by status
    status_counts = {}
    for status in ["pending", "processing", "completed", "failed", "cancelled"]:
        result = await db.execute(
            select(func.count()).select_from(AsyncJob).where(
                AsyncJob.status == status
            )
        )
        status_counts[status] = result.scalar() or 0

    # Jobs by type
    type_result = await db.execute(
        select(
            AsyncJob.job_type,
            func.count().label("count")
        ).group_by(AsyncJob.job_type)
    )
    jobs_by_type = {row.job_type: row.count for row in type_result.all()}

    # Average duration for completed jobs
    avg_duration = None
    completed_jobs = await db.execute(
        select(AsyncJob).where(
            AsyncJob.status == "completed",
            AsyncJob.started_at.isnot(None),
            AsyncJob.completed_at.isnot(None)
        )
    )
    durations = []
    for job in completed_jobs.scalars().all():
        if job.started_at and job.completed_at:
            durations.append((job.completed_at - job.started_at).total_seconds())

    if durations:
        avg_duration = sum(durations) / len(durations)

    return JobStatsResponse(
        total_jobs=total_jobs,
        pending_jobs=status_counts.get("pending", 0),
        processing_jobs=status_counts.get("processing", 0),
        completed_jobs=status_counts.get("completed", 0),
        failed_jobs=status_counts.get("failed", 0),
        cancelled_jobs=status_counts.get("cancelled", 0),
        jobs_by_type=jobs_by_type,
        avg_duration_seconds=avg_duration,
    )


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get a specific job's details.
    """
    result = await db.execute(
        select(AsyncJob).where(AsyncJob.id == job_id)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    duration = None
    if job.started_at and job.completed_at:
        duration = (job.completed_at - job.started_at).total_seconds()

    return JobResponse(
        id=job.id,
        job_type=job.job_type,
        status=job.status,
        progress=job.progress,
        document_id=job.document_id,
        owner_id=job.owner_id,
        input_params=job.input_params,
        result=job.result,
        error_code=job.error_code,
        error_message=job.error_message,
        started_at=job.started_at,
        completed_at=job.completed_at,
        created_at=job.created_at,
        duration_seconds=duration,
    )


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Cancel a pending or processing job.
    """
    result = await db.execute(
        select(AsyncJob).where(AsyncJob.id == job_id)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status not in ["pending", "processing"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job with status '{job.status}'"
        )

    job.status = "cancelled"
    job.completed_at = datetime.now()
    job.error_message = "Cancelled by admin"

    await db.commit()

    return {"message": f"Job {job_id} cancelled successfully"}


@router.post("/{job_id}/retry")
async def retry_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Retry a failed job.
    """
    result = await db.execute(
        select(AsyncJob).where(AsyncJob.id == job_id)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != "failed":
        raise HTTPException(
            status_code=400,
            detail=f"Can only retry failed jobs, current status is '{job.status}'"
        )

    # Reset job status
    job.status = "pending"
    job.progress = 0.0
    job.started_at = None
    job.completed_at = None
    job.error_code = None
    job.error_message = None
    job.result = None

    await db.commit()

    return {"message": f"Job {job_id} queued for retry"}


@router.delete("/{job_id}")
async def delete_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a completed, failed, or cancelled job.
    """
    result = await db.execute(
        select(AsyncJob).where(AsyncJob.id == job_id)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status in ["pending", "processing"]:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete active jobs. Cancel them first."
        )

    await db.delete(job)
    await db.commit()

    return {"message": f"Job {job_id} deleted successfully"}
