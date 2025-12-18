"""
Admin statistics endpoints.

Provides dashboard statistics and analytics for the admin panel.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.database import (
    AsyncJob,
    Plan,
    StoredDocument,
    UserQuota,
)

router = APIRouter()


class SystemHealth(BaseModel):
    """System component health status."""
    name: str
    status: str  # healthy, warning, error
    latency: Optional[str] = None


class DashboardStats(BaseModel):
    """Dashboard overview statistics."""
    total_users: int
    total_documents: int
    total_storage_bytes: int
    total_storage_formatted: str
    active_jobs: int
    completed_jobs_today: int
    failed_jobs_today: int
    system_health: list[SystemHealth]


class UsageDataPoint(BaseModel):
    """Usage data point for charts."""
    month: str
    documents: int
    storage_gb: float


class RevenueDataPoint(BaseModel):
    """Revenue data point for charts."""
    month: str
    revenue: float
    subscribers: int


class RecentActivity(BaseModel):
    """Recent activity item."""
    id: str
    type: str  # user_signup, document_upload, job_completed, etc.
    description: str
    timestamp: datetime
    user_id: Optional[str] = None


@router.get("/overview", response_model=DashboardStats)
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
):
    """
    Get dashboard overview statistics.

    Returns aggregated statistics for the admin dashboard.
    """
    # Get total users (from UserQuota table)
    users_result = await db.execute(
        select(func.count()).select_from(UserQuota)
    )
    total_users = users_result.scalar() or 0

    # Get total documents
    docs_result = await db.execute(
        select(func.count()).select_from(StoredDocument).where(
            StoredDocument.is_deleted == False
        )
    )
    total_documents = docs_result.scalar() or 0

    # Get total storage used
    storage_result = await db.execute(
        select(func.sum(UserQuota.storage_used_bytes))
    )
    total_storage_bytes = storage_result.scalar() or 0

    # Format storage
    def format_bytes(bytes_val: int) -> str:
        if bytes_val >= 1024 ** 4:
            return f"{bytes_val / (1024 ** 4):.1f} TB"
        elif bytes_val >= 1024 ** 3:
            return f"{bytes_val / (1024 ** 3):.1f} GB"
        elif bytes_val >= 1024 ** 2:
            return f"{bytes_val / (1024 ** 2):.1f} MB"
        elif bytes_val >= 1024:
            return f"{bytes_val / 1024:.1f} KB"
        return f"{bytes_val} B"

    # Get active jobs
    active_jobs_result = await db.execute(
        select(func.count()).select_from(AsyncJob).where(
            AsyncJob.status.in_(["pending", "processing"])
        )
    )
    active_jobs = active_jobs_result.scalar() or 0

    # Get jobs completed today
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    completed_result = await db.execute(
        select(func.count()).select_from(AsyncJob).where(
            AsyncJob.status == "completed",
            AsyncJob.completed_at >= today_start
        )
    )
    completed_jobs_today = completed_result.scalar() or 0

    # Get failed jobs today
    failed_result = await db.execute(
        select(func.count()).select_from(AsyncJob).where(
            AsyncJob.status == "failed",
            AsyncJob.completed_at >= today_start
        )
    )
    failed_jobs_today = failed_result.scalar() or 0

    # System health (simplified - in production, check actual services)
    system_health = [
        SystemHealth(name="API Server", status="healthy", latency="12ms"),
        SystemHealth(name="Database", status="healthy", latency="3ms"),
        SystemHealth(name="Redis Cache", status="healthy", latency="1ms"),
        SystemHealth(name="Storage", status="healthy", latency="8ms"),
    ]

    return DashboardStats(
        total_users=total_users,
        total_documents=total_documents,
        total_storage_bytes=total_storage_bytes,
        total_storage_formatted=format_bytes(total_storage_bytes),
        active_jobs=active_jobs,
        completed_jobs_today=completed_jobs_today,
        failed_jobs_today=failed_jobs_today,
        system_health=system_health,
    )


@router.get("/usage", response_model=list[UsageDataPoint])
async def get_usage_stats(
    months: int = Query(6, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    """
    Get usage statistics over time.

    Returns document and storage usage per month.
    """
    data = []
    now = datetime.now()

    for i in range(months - 1, -1, -1):
        # Calculate month boundaries
        month_date = now - timedelta(days=30 * i)
        month_start = month_date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if month_date.month == 12:
            month_end = month_start.replace(year=month_start.year + 1, month=1)
        else:
            month_end = month_start.replace(month=month_start.month + 1)

        # Count documents created in this month
        docs_result = await db.execute(
            select(func.count()).select_from(StoredDocument).where(
                StoredDocument.created_at >= month_start,
                StoredDocument.created_at < month_end,
                StoredDocument.is_deleted == False
            )
        )
        doc_count = docs_result.scalar() or 0

        # Get storage at end of month (cumulative up to month_end)
        storage_result = await db.execute(
            select(func.sum(StoredDocument.file_size_bytes)).where(
                StoredDocument.created_at < month_end,
                StoredDocument.is_deleted == False
            )
        )
        storage_bytes = storage_result.scalar() or 0
        storage_gb = storage_bytes / (1024 ** 3)

        data.append(UsageDataPoint(
            month=month_start.strftime("%b %Y"),
            documents=doc_count,
            storage_gb=round(storage_gb, 2),
        ))

    return data


@router.get("/revenue", response_model=list[RevenueDataPoint])
async def get_revenue_stats(
    months: int = Query(6, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    """
    Get revenue statistics over time.

    Returns revenue and subscriber counts per month.
    """
    data = []
    now = datetime.now()

    for i in range(months - 1, -1, -1):
        month_date = now - timedelta(days=30 * i)
        month_start = month_date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        # Count paid subscribers for this period
        subscribers_result = await db.execute(
            select(func.count()).select_from(UserQuota).where(
                UserQuota.plan_type.in_(["pro", "enterprise"]),
            )
        )
        subscribers = subscribers_result.scalar() or 0

        # Get plan prices for revenue calculation
        plans_result = await db.execute(
            select(Plan).where(Plan.is_active == True)
        )
        plans = {p.slug: float(p.price) for p in plans_result.scalars().all()}

        # Calculate approximate revenue (subscribers * average plan price)
        avg_price = sum(plans.values()) / len(plans) if plans else 0
        revenue = subscribers * avg_price

        data.append(RevenueDataPoint(
            month=month_start.strftime("%b %Y"),
            revenue=round(revenue, 2),
            subscribers=subscribers,
        ))

    return data


@router.get("/activity", response_model=list[RecentActivity])
async def get_recent_activity(
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Get recent system activity.

    Returns a list of recent events across the platform.
    """
    activities = []

    # Get recent documents
    docs_result = await db.execute(
        select(StoredDocument)
        .where(StoredDocument.is_deleted == False)
        .order_by(StoredDocument.created_at.desc())
        .limit(limit // 2)
    )
    for doc in docs_result.scalars().all():
        activities.append(RecentActivity(
            id=doc.id,
            type="document_upload",
            description=f"Document '{doc.name}' uploaded",
            timestamp=doc.created_at,
            user_id=doc.owner_id,
        ))

    # Get recent jobs
    jobs_result = await db.execute(
        select(AsyncJob)
        .order_by(AsyncJob.created_at.desc())
        .limit(limit // 2)
    )
    for job in jobs_result.scalars().all():
        status_text = "completed" if job.status == "completed" else job.status
        activities.append(RecentActivity(
            id=job.id,
            type=f"job_{job.status}",
            description=f"{job.job_type} job {status_text}",
            timestamp=job.created_at,
            user_id=job.owner_id,
        ))

    # Sort by timestamp and limit
    activities.sort(key=lambda x: x.timestamp, reverse=True)
    return activities[:limit]
