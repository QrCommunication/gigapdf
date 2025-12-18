"""
Admin logs endpoints.

Provides system logs for the admin panel.
Since we don't have a dedicated logs table, we'll aggregate logs from
various sources: jobs, documents, etc.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, union_all, literal
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.database import AsyncJob, StoredDocument, UserQuota

router = APIRouter()


class LogEntry(BaseModel):
    """Log entry model."""
    id: str
    level: str  # info, warning, error, success
    message: str
    source: str  # system, user, job, document
    user_id: Optional[str] = None
    metadata: Optional[dict] = None
    timestamp: datetime


class LogListResponse(BaseModel):
    """Paginated log list response."""
    logs: list[LogEntry]
    total: int
    page: int
    page_size: int


class LogStatsResponse(BaseModel):
    """Log statistics response."""
    total_logs: int
    info_count: int
    warning_count: int
    error_count: int
    success_count: int
    logs_today: int
    logs_this_week: int


@router.get("", response_model=LogListResponse)
async def list_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    level: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    List system logs with pagination and filtering.

    Logs are aggregated from various system activities.
    """
    logs = []

    # Get job-related logs
    job_query = select(AsyncJob)
    if user_id:
        job_query = job_query.where(AsyncJob.owner_id == user_id)
    if start_date:
        job_query = job_query.where(AsyncJob.created_at >= start_date)
    if end_date:
        job_query = job_query.where(AsyncJob.created_at <= end_date)

    job_query = job_query.order_by(AsyncJob.created_at.desc()).limit(page_size)

    job_result = await db.execute(job_query)
    for job in job_result.scalars().all():
        # Determine log level based on job status
        if job.status == "completed":
            log_level = "success"
            message = f"Job '{job.job_type}' completed successfully"
        elif job.status == "failed":
            log_level = "error"
            message = f"Job '{job.job_type}' failed: {job.error_message or 'Unknown error'}"
        elif job.status == "processing":
            log_level = "info"
            message = f"Job '{job.job_type}' is processing ({job.progress:.0%})"
        elif job.status == "cancelled":
            log_level = "warning"
            message = f"Job '{job.job_type}' was cancelled"
        else:
            log_level = "info"
            message = f"Job '{job.job_type}' is pending"

        if not level or log_level == level:
            if not source or source == "job":
                logs.append(LogEntry(
                    id=f"job-{job.id}",
                    level=log_level,
                    message=message,
                    source="job",
                    user_id=job.owner_id,
                    metadata={
                        "job_id": job.id,
                        "job_type": job.job_type,
                        "status": job.status,
                        "progress": job.progress,
                    },
                    timestamp=job.completed_at or job.created_at,
                ))

    # Get document-related logs
    if not source or source == "document":
        doc_query = select(StoredDocument)
        if user_id:
            doc_query = doc_query.where(StoredDocument.owner_id == user_id)
        if start_date:
            doc_query = doc_query.where(StoredDocument.created_at >= start_date)
        if end_date:
            doc_query = doc_query.where(StoredDocument.created_at <= end_date)

        doc_query = doc_query.order_by(StoredDocument.created_at.desc()).limit(page_size)

        doc_result = await db.execute(doc_query)
        for doc in doc_result.scalars().all():
            if doc.is_deleted:
                log_level = "warning"
                message = f"Document '{doc.name}' was deleted"
            else:
                log_level = "info"
                message = f"Document '{doc.name}' was uploaded ({doc.page_count} pages)"

            if not level or log_level == level:
                logs.append(LogEntry(
                    id=f"doc-{doc.id}",
                    level=log_level,
                    message=message,
                    source="document",
                    user_id=doc.owner_id,
                    metadata={
                        "document_id": doc.id,
                        "document_name": doc.name,
                        "page_count": doc.page_count,
                        "file_size": doc.file_size_bytes,
                    },
                    timestamp=doc.deleted_at if doc.is_deleted else doc.created_at,
                ))

    # Get user-related logs
    if not source or source == "user":
        user_query = select(UserQuota)
        if user_id:
            user_query = user_query.where(UserQuota.user_id == user_id)

        user_query = user_query.order_by(UserQuota.updated_at.desc()).limit(page_size // 3)

        user_result = await db.execute(user_query)
        for quota in user_result.scalars().all():
            usage_percent = (quota.storage_used_bytes / quota.storage_limit_bytes * 100) if quota.storage_limit_bytes > 0 else 0

            if usage_percent >= 90:
                log_level = "warning"
                message = f"User approaching storage limit ({usage_percent:.1f}% used)"
            elif usage_percent >= 75:
                log_level = "info"
                message = f"User at {usage_percent:.1f}% storage usage"
            else:
                continue  # Skip low usage users

            if not level or log_level == level:
                logs.append(LogEntry(
                    id=f"user-{quota.user_id}",
                    level=log_level,
                    message=message,
                    source="user",
                    user_id=quota.user_id,
                    metadata={
                        "storage_used": quota.storage_used_bytes,
                        "storage_limit": quota.storage_limit_bytes,
                        "usage_percent": usage_percent,
                        "plan_type": quota.plan_type,
                    },
                    timestamp=quota.updated_at,
                ))

    # Sort all logs by timestamp
    logs.sort(key=lambda x: x.timestamp, reverse=True)

    # Apply pagination
    offset = (page - 1) * page_size
    paginated_logs = logs[offset:offset + page_size]

    return LogListResponse(
        logs=paginated_logs,
        total=len(logs),
        page=page,
        page_size=page_size,
    )


@router.get("/stats", response_model=LogStatsResponse)
async def get_log_stats(
    db: AsyncSession = Depends(get_db),
):
    """
    Get log statistics.
    """
    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)

    # Count jobs by status
    completed_result = await db.execute(
        select(AsyncJob).where(AsyncJob.status == "completed")
    )
    completed_count = len(list(completed_result.scalars().all()))

    failed_result = await db.execute(
        select(AsyncJob).where(AsyncJob.status == "failed")
    )
    failed_count = len(list(failed_result.scalars().all()))

    pending_result = await db.execute(
        select(AsyncJob).where(AsyncJob.status.in_(["pending", "processing"]))
    )
    pending_count = len(list(pending_result.scalars().all()))

    cancelled_result = await db.execute(
        select(AsyncJob).where(AsyncJob.status == "cancelled")
    )
    cancelled_count = len(list(cancelled_result.scalars().all()))

    # Jobs today
    today_result = await db.execute(
        select(AsyncJob).where(AsyncJob.created_at >= today_start)
    )
    logs_today = len(list(today_result.scalars().all()))

    # Jobs this week
    week_result = await db.execute(
        select(AsyncJob).where(AsyncJob.created_at >= week_start)
    )
    logs_this_week = len(list(week_result.scalars().all()))

    total_logs = completed_count + failed_count + pending_count + cancelled_count

    return LogStatsResponse(
        total_logs=total_logs,
        info_count=pending_count,
        warning_count=cancelled_count,
        error_count=failed_count,
        success_count=completed_count,
        logs_today=logs_today,
        logs_this_week=logs_this_week,
    )


@router.get("/export")
async def export_logs(
    format: str = Query("json", regex="^(json|csv)$"),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Export logs in JSON or CSV format.
    """
    # Get all logs
    response = await list_logs(
        page=1,
        page_size=1000,
        start_date=start_date,
        end_date=end_date,
        db=db,
    )

    if format == "json":
        return {
            "logs": [log.model_dump() for log in response.logs],
            "exported_at": datetime.now().isoformat(),
            "total": response.total,
        }
    else:
        # CSV format
        import io
        import csv

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id", "level", "message", "source", "user_id", "timestamp"])

        for log in response.logs:
            writer.writerow([
                log.id,
                log.level,
                log.message,
                log.source,
                log.user_id or "",
                log.timestamp.isoformat(),
            ])

        from fastapi.responses import StreamingResponse
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=logs.csv"},
        )
