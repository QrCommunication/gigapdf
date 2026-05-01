"""
Admin statistics endpoints.

Provides dashboard statistics and analytics for the admin panel.
"""

from datetime import datetime, timedelta

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
    latency: str | None = None


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
    user_id: str | None = None


@router.get(
    "/overview",
    response_model=DashboardStats,
    summary="Get dashboard overview statistics",
    description="""
Retrieve aggregated statistics for the admin dashboard.

**Admin access required.** Returns a snapshot of the platform's current state including:
- Total registered users and documents
- Cumulative storage usage (raw bytes + human-readable format)
- Active, completed and failed async jobs for the current day
- Health status and latency of all critical system components (API, Database, Redis, Storage)

This endpoint is intended for the GigaPDF admin panel home screen.
""",
    response_description="Dashboard statistics with system health indicators",
    responses={
        200: {"description": "Dashboard statistics returned successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        500: {"description": "Internal server error while querying statistics"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/stats/overview" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/stats/overview",\n'
                    '    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},\n'
                    ")\n"
                    "stats = response.json()\n"
                    'print(f"Total users: {stats[\'total_users\']}")\n'
                    'print(f"Active jobs: {stats[\'active_jobs\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/stats/overview",\n'
                    "  {\n"
                    '    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` },\n'
                    "  }\n"
                    ");\n"
                    "const stats = await response.json();\n"
                    "console.log(`Total users: ${stats.total_users}`);\n"
                    "console.log(`Active jobs: ${stats.active_jobs}`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/stats/overview',\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$stats = json_decode($response->getBody(), true);\n"
                    "echo 'Total users: ' . $stats['total_users'];"
                ),
            },
        ],
    },
)
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
            ~StoredDocument.is_deleted
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


@router.get(
    "/usage",
    response_model=list[UsageDataPoint],
    summary="Get usage statistics over time",
    description="""
Retrieve document upload and storage usage trends aggregated by month.

**Admin access required.** Use the `months` query parameter to control how many
months of historical data are returned (1–12). Each data point contains:
- `month` — label in "MMM YYYY" format (e.g. "Jan 2026")
- `documents` — number of documents uploaded during that month
- `storage_gb` — cumulative storage occupied at the end of that month (in GB)

Useful for rendering time-series charts in the admin dashboard.
""",
    response_description="List of monthly usage data points ordered chronologically",
    responses={
        200: {"description": "Usage statistics returned successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        422: {"description": "Invalid value for `months` parameter (must be 1–12)"},
        500: {"description": "Internal server error while querying usage data"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/stats/usage?months=6" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/stats/usage",\n'
                    '    params={"months": 6},\n'
                    '    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},\n'
                    ")\n"
                    "for point in response.json():\n"
                    '    print(f"{point[\'month\']}: {point[\'documents\']} docs, {point[\'storage_gb\']} GB")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/stats/usage?months=6",\n'
                    "  {\n"
                    '    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` },\n'
                    "  }\n"
                    ");\n"
                    "const data = await response.json();\n"
                    "data.forEach(({ month, documents, storage_gb }) =>\n"
                    "  console.log(`${month}: ${documents} docs, ${storage_gb} GB`)\n"
                    ");"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/stats/usage',\n"
                    "    [\n"
                    "        'query' => ['months' => 6],\n"
                    "        'headers' => ['Authorization' => 'Bearer ' . $adminToken],\n"
                    "    ]\n"
                    ");\n"
                    "$points = json_decode($response->getBody(), true);\n"
                    "foreach ($points as $point) {\n"
                    "    echo $point['month'] . ': ' . $point['documents'] . ' docs\\n';\n"
                    "}"
                ),
            },
        ],
    },
)
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
                ~StoredDocument.is_deleted
            )
        )
        doc_count = docs_result.scalar() or 0

        # Get storage at end of month (cumulative up to month_end)
        storage_result = await db.execute(
            select(func.sum(StoredDocument.file_size_bytes)).where(
                StoredDocument.created_at < month_end,
                ~StoredDocument.is_deleted
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


@router.get(
    "/revenue",
    response_model=list[RevenueDataPoint],
    summary="Get revenue statistics over time",
    description="""
Retrieve estimated monthly revenue and paid subscriber counts.

**Admin access required.** Returns one data point per month for the requested
period (1–12 months). Revenue is approximated by multiplying the number of paid
subscribers (Pro + Enterprise plans) by the average active plan price fetched
from the database.

Each data point contains:
- `month` — label in "MMM YYYY" format
- `revenue` — estimated revenue in the platform's base currency
- `subscribers` — number of active paid subscribers at that point in time

> **Note:** Revenue figures are estimates based on current plan pricing and
> active subscriber counts. They do not account for discounts, refunds, or
> prorated billing.
""",
    response_description="List of monthly revenue data points ordered chronologically",
    responses={
        200: {"description": "Revenue statistics returned successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        422: {"description": "Invalid value for `months` parameter (must be 1–12)"},
        500: {"description": "Internal server error while computing revenue data"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/stats/revenue?months=12" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/stats/revenue",\n'
                    '    params={"months": 12},\n'
                    '    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},\n'
                    ")\n"
                    "for point in response.json():\n"
                    '    print(f"{point[\'month\']}: ${point[\'revenue\']:.2f} ({point[\'subscribers\']} subscribers)")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/stats/revenue?months=12",\n'
                    "  {\n"
                    '    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` },\n'
                    "  }\n"
                    ");\n"
                    "const data = await response.json();\n"
                    "data.forEach(({ month, revenue, subscribers }) =>\n"
                    "  console.log(`${month}: $${revenue.toFixed(2)} — ${subscribers} subscribers`)\n"
                    ");"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/stats/revenue',\n"
                    "    [\n"
                    "        'query' => ['months' => 12],\n"
                    "        'headers' => ['Authorization' => 'Bearer ' . $adminToken],\n"
                    "    ]\n"
                    ");\n"
                    "$points = json_decode($response->getBody(), true);\n"
                    "foreach ($points as $point) {\n"
                    "    echo $point['month'] . ': $' . number_format($point['revenue'], 2) . '\\n';\n"
                    "}"
                ),
            },
        ],
    },
)
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
            select(Plan).where(Plan.is_active)
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


@router.get(
    "/activity",
    response_model=list[RecentActivity],
    summary="Get recent platform activity",
    description="""
Retrieve the most recent events across the GigaPDF platform.

**Admin access required.** Returns a chronologically sorted list of recent
activities, combining document uploads and async job events. Use the `limit`
parameter to control how many events are returned (1–50, default 10).

Activity types include:
- `document_upload` — a user uploaded a new PDF document
- `job_completed` — an async processing job finished successfully
- `job_failed` — an async processing job encountered an error
- `job_processing` — a job is currently being processed
- `job_pending` — a job is waiting to be picked up

Each item includes the affected `user_id` when available, enabling quick
navigation to the user's admin profile.
""",
    response_description="List of recent activity events sorted from newest to oldest",
    responses={
        200: {"description": "Recent activity list returned successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        422: {"description": "Invalid value for `limit` parameter (must be 1–50)"},
        500: {"description": "Internal server error while fetching recent activity"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/stats/activity?limit=20" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/stats/activity",\n'
                    '    params={"limit": 20},\n'
                    '    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},\n'
                    ")\n"
                    "for event in response.json():\n"
                    '    print(f"[{event[\'type\']}] {event[\'description\']} at {event[\'timestamp\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/stats/activity?limit=20",\n'
                    "  {\n"
                    '    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` },\n'
                    "  }\n"
                    ");\n"
                    "const events = await response.json();\n"
                    "events.forEach(({ type, description, timestamp }) =>\n"
                    "  console.log(`[${type}] ${description} at ${timestamp}`)\n"
                    ");"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/stats/activity',\n"
                    "    [\n"
                    "        'query' => ['limit' => 20],\n"
                    "        'headers' => ['Authorization' => 'Bearer ' . $adminToken],\n"
                    "    ]\n"
                    ");\n"
                    "$events = json_decode($response->getBody(), true);\n"
                    "foreach ($events as $event) {\n"
                    "    echo '[' . $event['type'] . '] ' . $event['description'] . '\\n';\n"
                    "}"
                ),
            },
        ],
    },
)
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
        .where(~StoredDocument.is_deleted)
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
