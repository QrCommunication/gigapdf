"""
Admin jobs management endpoints.

Provides job monitoring for the admin panel.
"""

from datetime import datetime

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
    document_id: str | None = None
    owner_id: str
    input_params: dict | None = None
    result: dict | None = None
    error_code: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    duration_seconds: float | None = None


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
    avg_duration_seconds: float | None = None


@router.get(
    "",
    response_model=JobListResponse,
    summary="List all async jobs",
    description="""Returns a paginated list of all asynchronous processing jobs on the platform.

**Admin access required.** This endpoint provides a global view of the job queue across all
users, regardless of ownership.

Jobs represent background tasks such as PDF compression, conversion, OCR, splitting, merging,
and other processing operations. Each job carries a `status` field with one of the following values:
`pending`, `processing`, `completed`, `failed`, `cancelled`.

Supports filtering by:
- **status**: narrow results to a specific lifecycle state
- **job_type**: filter by processing operation type (e.g. `compress`, `ocr`, `merge`)
- **owner_id**: filter jobs submitted by a specific user

Results are ordered by creation date (most recent first).""",
    response_description="Paginated list of async jobs with full metadata",
    responses={
        200: {
            "description": "Paginated job list returned successfully",
            "content": {
                "application/json": {
                    "example": {
                        "jobs": [
                            {
                                "id": "job_01HXYZ",
                                "job_type": "compress",
                                "status": "completed",
                                "progress": 1.0,
                                "document_id": "doc_01HABC",
                                "owner_id": "usr_01HDEF",
                                "input_params": {"quality": "medium"},
                                "result": {"output_document_id": "doc_01HGHI"},
                                "error_code": None,
                                "error_message": None,
                                "started_at": "2024-03-01T10:00:00Z",
                                "completed_at": "2024-03-01T10:00:05Z",
                                "created_at": "2024-03-01T09:59:58Z",
                                "duration_seconds": 5.0,
                            }
                        ],
                        "total": 1,
                        "page": 1,
                        "page_size": 20,
                        "total_pages": 1,
                    }
                }
            },
        },
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        422: {"description": "Invalid query parameters (e.g. page < 1)"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/jobs'
                    '?page=1&page_size=20&status=failed" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/jobs",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    "    params={\"page\": 1, \"page_size\": 20, \"status\": \"failed\"},\n"
                    ")\n"
                    "data = response.json()\n"
                    'print(f"Failed jobs: {data[\'total\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const params = new URLSearchParams({ page: 1, page_size: 20, status: \"failed\" });\n"
                    "const response = await fetch(\n"
                    '  `https://api.giga-pdf.com/api/v1/admin/jobs?${params}`,\n'
                    "  { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }\n"
                    ");\n"
                    "const data = await response.json();\n"
                    "console.log(`Failed jobs: ${data.total}`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get('https://api.giga-pdf.com/api/v1/admin/jobs', [\n"
                    "    'headers' => ['Authorization' => 'Bearer ' . $adminToken],\n"
                    "    'query'   => ['page' => 1, 'page_size' => 20, 'status' => 'failed'],\n"
                    "]);\n"
                    "$data = json_decode($response->getBody(), true);\n"
                    "echo 'Failed jobs: ' . $data['total'];"
                ),
            },
        ]
    },
)
async def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None),
    job_type: str | None = Query(None),
    owner_id: str | None = Query(None),
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


@router.get(
    "/stats",
    response_model=JobStatsResponse,
    summary="Get job queue statistics",
    description="""Returns aggregated statistics about the async job queue across all users.

**Admin access required.** Provides a real-time snapshot of the processing pipeline, useful
for monitoring dashboards and capacity planning:

- **total_jobs**: total number of jobs ever recorded
- **pending_jobs**: jobs waiting to be picked up by a worker
- **processing_jobs**: jobs currently being executed by a worker
- **completed_jobs**: successfully finished jobs
- **failed_jobs**: jobs that terminated with an error
- **cancelled_jobs**: jobs manually cancelled by an admin or the system
- **jobs_by_type**: breakdown of total jobs per operation type
- **avg_duration_seconds**: average execution time for completed jobs (null if no completed jobs)""",
    response_description="Aggregated job queue statistics",
    responses={
        200: {
            "description": "Job statistics returned successfully",
            "content": {
                "application/json": {
                    "example": {
                        "total_jobs": 15432,
                        "pending_jobs": 12,
                        "processing_jobs": 5,
                        "completed_jobs": 15200,
                        "failed_jobs": 198,
                        "cancelled_jobs": 17,
                        "jobs_by_type": {
                            "compress": 6800,
                            "ocr": 4500,
                            "merge": 2300,
                            "split": 1832,
                        },
                        "avg_duration_seconds": 3.74,
                    }
                }
            },
        },
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/jobs/stats" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/jobs/stats",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    ")\n"
                    "stats = response.json()\n"
                    'print(f"Pending: {stats[\'pending_jobs\']} | Processing: {stats[\'processing_jobs\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/jobs/stats",\n'
                    "  { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }\n"
                    ");\n"
                    "const stats = await response.json();\n"
                    "console.log(`Pending: ${stats.pending_jobs} | Processing: ${stats.processing_jobs}`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/jobs/stats',\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$stats = json_decode($response->getBody(), true);\n"
                    "echo 'Pending: ' . $stats['pending_jobs'] . ' | Processing: ' . $stats['processing_jobs'];"
                ),
            },
        ]
    },
)
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


@router.get(
    "/{job_id}",
    response_model=JobResponse,
    summary="Get job details",
    description="""Returns the full details of a specific async job identified by its ID.

**Admin access required.** This endpoint exposes all job fields including internal parameters,
processing results, error codes, and timing information — regardless of which user submitted the job.

Key fields:
- **progress**: completion percentage between 0.0 and 1.0
- **input_params**: the parameters the job was submitted with (e.g. compression quality, OCR language)
- **result**: output data upon successful completion (e.g. output document ID)
- **error_code / error_message**: populated when `status` is `failed`
- **duration_seconds**: computed from `started_at` and `completed_at` when both are available""",
    response_description="Complete job details including status, progress, and result",
    responses={
        200: {
            "description": "Job found and returned successfully",
            "content": {
                "application/json": {
                    "example": {
                        "id": "job_01HXYZ",
                        "job_type": "ocr",
                        "status": "failed",
                        "progress": 0.45,
                        "document_id": "doc_01HABC",
                        "owner_id": "usr_01HDEF",
                        "input_params": {"language": "fr"},
                        "result": None,
                        "error_code": "OCR_TIMEOUT",
                        "error_message": "OCR worker timed out after 120s",
                        "started_at": "2024-03-01T11:00:00Z",
                        "completed_at": "2024-03-01T11:02:00Z",
                        "created_at": "2024-03-01T10:59:50Z",
                        "duration_seconds": 120.0,
                    }
                }
            },
        },
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "Job not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/jobs/job_01HXYZ" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "job_id = \"job_01HXYZ\"\n"
                    "response = requests.get(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/jobs/{job_id}",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    ")\n"
                    "job = response.json()\n"
                    'print(f"Job {job[\'id\']}: {job[\'status\']} ({job[\'progress\']*100:.0f}%)")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const jobId = \"job_01HXYZ\";\n"
                    "const response = await fetch(\n"
                    "  `https://api.giga-pdf.com/api/v1/admin/jobs/${jobId}`,\n"
                    "  { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }\n"
                    ");\n"
                    "const job = await response.json();\n"
                    "console.log(`Job ${job.id}: ${job.status} (${(job.progress * 100).toFixed(0)}%)`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$jobId = 'job_01HXYZ';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    \"https://api.giga-pdf.com/api/v1/admin/jobs/{$jobId}\",\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$job = json_decode($response->getBody(), true);\n"
                    "echo 'Job ' . $job['id'] . ': ' . $job['status'];"
                ),
            },
        ]
    },
)
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


@router.post(
    "/{job_id}/cancel",
    summary="Cancel a pending or processing job",
    description="""Forces cancellation of an async job that is currently in `pending` or `processing` state.

**Admin access required.** This is a privileged action that overrides normal user-level job control.
It is intended for situations where a job is stuck, consuming excessive resources, or was submitted
in error.

Upon cancellation:
- `status` is set to `cancelled`
- `completed_at` is set to the current timestamp
- `error_message` is set to `"Cancelled by admin"` for audit traceability

Returns a 400 error if the job is already in a terminal state (`completed`, `failed`, or `cancelled`).""",
    response_description="Confirmation message that the job has been cancelled",
    responses={
        200: {
            "description": "Job cancelled successfully",
            "content": {
                "application/json": {
                    "example": {"message": "Job job_01HXYZ cancelled successfully"}
                }
            },
        },
        400: {
            "description": "Job cannot be cancelled (already in a terminal state)",
            "content": {
                "application/json": {
                    "example": {"detail": "Cannot cancel job with status 'completed'"}
                }
            },
        },
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "Job not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X POST "https://api.giga-pdf.com/api/v1/admin/jobs/job_01HXYZ/cancel" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "job_id = \"job_01HXYZ\"\n"
                    "response = requests.post(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/jobs/{job_id}/cancel",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    ")\n"
                    "print(response.json()['message'])"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const jobId = \"job_01HXYZ\";\n"
                    "const response = await fetch(\n"
                    "  `https://api.giga-pdf.com/api/v1/admin/jobs/${jobId}/cancel`,\n"
                    "  { method: \"POST\", headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }\n"
                    ");\n"
                    "const result = await response.json();\n"
                    "console.log(result.message);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$jobId = 'job_01HXYZ';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->post(\n"
                    "    \"https://api.giga-pdf.com/api/v1/admin/jobs/{$jobId}/cancel\",\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$result = json_decode($response->getBody(), true);\n"
                    "echo $result['message'];"
                ),
            },
        ]
    },
)
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


@router.post(
    "/{job_id}/retry",
    summary="Retry a failed job",
    description="""Re-queues a failed job for reprocessing by resetting it to `pending` state.

**Admin access required.** Use this endpoint to recover from transient failures (e.g. worker
crash, temporary storage unavailability, external API timeout) without requiring the user to
re-submit their request.

Upon retry, the following fields are reset:
- `status` → `pending`
- `progress` → `0.0`
- `started_at`, `completed_at` → `null`
- `error_code`, `error_message` → `null`
- `result` → `null`

The original `input_params` and `document_id` are preserved. Returns a 400 error if the job
is not in `failed` state.""",
    response_description="Confirmation message that the job has been queued for retry",
    responses={
        200: {
            "description": "Job successfully queued for retry",
            "content": {
                "application/json": {
                    "example": {"message": "Job job_01HXYZ queued for retry"}
                }
            },
        },
        400: {
            "description": "Job cannot be retried (not in failed state)",
            "content": {
                "application/json": {
                    "example": {"detail": "Can only retry failed jobs, current status is 'processing'"}
                }
            },
        },
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "Job not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X POST "https://api.giga-pdf.com/api/v1/admin/jobs/job_01HXYZ/retry" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "job_id = \"job_01HXYZ\"\n"
                    "response = requests.post(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/jobs/{job_id}/retry",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    ")\n"
                    "print(response.json()['message'])"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const jobId = \"job_01HXYZ\";\n"
                    "const response = await fetch(\n"
                    "  `https://api.giga-pdf.com/api/v1/admin/jobs/${jobId}/retry`,\n"
                    "  { method: \"POST\", headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }\n"
                    ");\n"
                    "const result = await response.json();\n"
                    "console.log(result.message);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$jobId = 'job_01HXYZ';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->post(\n"
                    "    \"https://api.giga-pdf.com/api/v1/admin/jobs/{$jobId}/retry\",\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$result = json_decode($response->getBody(), true);\n"
                    "echo $result['message'];"
                ),
            },
        ]
    },
)
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


@router.delete(
    "/{job_id}",
    summary="Delete a terminal job",
    description="""Permanently removes a job record from the database.

**Admin access required.** Only jobs in a terminal state can be deleted:
`completed`, `failed`, or `cancelled`. Active jobs (`pending` or `processing`) must be
cancelled first before they can be deleted.

This is useful for cleaning up old or failed job records to keep the queue table lean.
**This action is irreversible** — the job record and its associated result data will be
permanently removed.""",
    response_description="Confirmation message that the job has been permanently deleted",
    responses={
        200: {
            "description": "Job deleted successfully",
            "content": {
                "application/json": {
                    "example": {"message": "Job job_01HXYZ deleted successfully"}
                }
            },
        },
        400: {
            "description": "Job is still active and cannot be deleted",
            "content": {
                "application/json": {
                    "example": {"detail": "Cannot delete active jobs. Cancel them first."}
                }
            },
        },
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "Job not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X DELETE "https://api.giga-pdf.com/api/v1/admin/jobs/job_01HXYZ" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "job_id = \"job_01HXYZ\"\n"
                    "response = requests.delete(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/jobs/{job_id}",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    ")\n"
                    "print(response.json()['message'])"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const jobId = \"job_01HXYZ\";\n"
                    "const response = await fetch(\n"
                    "  `https://api.giga-pdf.com/api/v1/admin/jobs/${jobId}`,\n"
                    "  { method: \"DELETE\", headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }\n"
                    ");\n"
                    "const result = await response.json();\n"
                    "console.log(result.message);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$jobId = 'job_01HXYZ';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->delete(\n"
                    "    \"https://api.giga-pdf.com/api/v1/admin/jobs/{$jobId}\",\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$result = json_decode($response->getBody(), true);\n"
                    "echo $result['message'];"
                ),
            },
        ]
    },
)
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
