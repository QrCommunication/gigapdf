"""
Job management endpoints.

Handles async job status, cancellation, and listing.
"""

import time
from typing import Optional

from fastapi import APIRouter, Query

from app.middleware.auth import AuthenticatedUser, OptionalUser
from app.middleware.request_id import get_request_id
from app.models.database import AsyncJob
from app.schemas.responses.common import APIResponse, MetaInfo, PaginationInfo
from app.tasks.celery_app import celery_app
from app.utils.helpers import now_utc

router = APIRouter()


@router.get(
    "/{job_id}",
    response_model=APIResponse[dict],
    summary="Get job status",
    description="""
Get the status and progress of an async job.

Jobs are created for long-running operations like OCR, export, merge, and split.
This endpoint returns the current status, progress percentage, and result if completed.

## Path Parameters
- **job_id**: Job identifier (UUID v4)

## Response
Returns job information including:
- Job type and status
- Progress percentage (0-100)
- Result data if completed
- Error details if failed

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/jobs/{job_id}" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Obtenir le statut d'une tâche
response = requests.get(
    f"http://localhost:8000/api/v1/jobs/{job_id}",
    headers={"Authorization": "Bearer <token>"}
)
job_status = response.json()["data"]
print(f"Progress: {job_status['progress']}%")
```

## Example (JavaScript)
```javascript
// Récupérer le statut de la tâche
const response = await fetch(`/api/v1/jobs/${jobId}`, {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
console.log(`Progress: ${result.data.progress}%`);
```

## Example (PHP)
```php
// Obtenir le statut de la tâche
$client = new GuzzleHttp\\Client();
$response = $client->get("http://localhost:8000/api/v1/jobs/{$jobId}", [
    'headers' => ['Authorization' => 'Bearer <token>']
]);
$job = json_decode($response->getBody(), true)['data'];
echo "Progress: {$job['progress']}%";
```
""",
    responses={
        200: {
            "description": "Job status retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "job_id": "550e8400-e29b-41d4-a716-446655440030",
                            "type": "export",
                            "status": "processing",
                            "progress": 65.5,
                            "created_at": "2024-01-15T10:30:00Z",
                            "started_at": "2024-01-15T10:30:05Z",
                            "completed_at": None,
                            "result": None,
                            "error": None,
                            "document_id": "550e8400-e29b-41d4-a716-446655440000",
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        404: {"description": "Job not found"},
    },
)
async def get_job_status(
    job_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get job status with progress."""
    start_time = time.time()

    from app.core.database import get_db_session
    from sqlalchemy import select

    async with get_db_session() as session:
        result = await session.execute(select(AsyncJob).where(AsyncJob.id == job_id))
        job = result.scalar_one_or_none()

        if not job:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError(f"Job not found: {job_id}")

        # Check if Celery task is running and update progress
        if job.celery_task_id and job.status == "processing":
            task_result = celery_app.AsyncResult(job.celery_task_id)
            if task_result.state == "PROGRESS":
                meta = task_result.info
                if isinstance(meta, dict) and "progress" in meta:
                    job.progress = meta["progress"]

        job_data = {
            "job_id": job.id,
            "type": job.job_type,
            "status": job.status,
            "progress": job.progress,
            "created_at": job.created_at.isoformat(),
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "result": job.result,
            "error": {
                "code": job.error_code,
                "message": job.error_message,
            } if job.error_code else None,
            "document_id": job.document_id,
        }

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=job_data,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )


@router.delete(
    "/{job_id}",
    response_model=APIResponse[dict],
    summary="Cancel job",
    description="""
Cancel a running async job.

Only jobs in 'pending' or 'processing' status can be cancelled.
Completed or failed jobs cannot be cancelled.

## Path Parameters
- **job_id**: Job identifier (UUID v4)

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/jobs/{job_id}" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Annuler une tâche en cours
response = requests.delete(
    f"http://localhost:8000/api/v1/jobs/{job_id}",
    headers={"Authorization": "Bearer <token>"}
)
result = response.json()
```

## Example (JavaScript)
```javascript
// Annuler une tâche
const response = await fetch(`/api/v1/jobs/${jobId}`, {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
```

## Example (PHP)
```php
// Annuler une tâche
$client = new GuzzleHttp\\Client();
$response = $client->delete("http://localhost:8000/api/v1/jobs/{$jobId}", [
    'headers' => ['Authorization' => 'Bearer <token>']
]);
$result = json_decode($response->getBody(), true);
```
""",
    responses={
        200: {"description": "Job cancelled successfully"},
        400: {"description": "Job cannot be cancelled (already completed/failed)"},
        404: {"description": "Job not found"},
    },
)
async def cancel_job(
    job_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Cancel a running job."""
    start_time = time.time()

    from app.core.database import get_db_session
    from sqlalchemy import select

    async with get_db_session() as session:
        result = await session.execute(select(AsyncJob).where(AsyncJob.id == job_id))
        job = result.scalar_one_or_none()

        if not job:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError(f"Job not found: {job_id}")

        # Check if job can be cancelled
        if job.status in ("completed", "failed", "cancelled"):
            from app.middleware.error_handler import InvalidOperationError
            raise InvalidOperationError(f"Cannot cancel job with status: {job.status}")

        # Cancel Celery task if exists
        if job.celery_task_id:
            celery_app.control.revoke(job.celery_task_id, terminate=True)

        # Update job status
        job.status = "cancelled"
        job.completed_at = now_utc()
        # Session commits automatically on exit

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data={
                "job_id": job.id,
                "status": "cancelled",
                "message": "Job cancelled successfully",
            },
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )


@router.get(
    "",
    response_model=APIResponse[dict],
    summary="List user jobs",
    description="""
List all jobs for the authenticated user with pagination.

Returns jobs sorted by creation time (newest first).
You can filter by job type and status.

## Query Parameters
- **page**: Page number (default: 1)
- **per_page**: Items per page (default: 20, max: 100)
- **job_type**: Filter by job type (ocr, export, merge, split, upload, convert)
- **status**: Filter by status (pending, processing, completed, failed, cancelled)

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/jobs?page=1&per_page=20&status=processing" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Lister toutes les tâches de l'utilisateur
response = requests.get(
    "http://localhost:8000/api/v1/jobs",
    params={"page": 1, "per_page": 20, "status": "processing"},
    headers={"Authorization": "Bearer <token>"}
)
jobs = response.json()["data"]["items"]
pagination = response.json()["data"]["pagination"]
```

## Example (JavaScript)
```javascript
// Récupérer la liste des tâches
const params = new URLSearchParams({
  page: '1',
  per_page: '20',
  status: 'processing'
});
const response = await fetch(`/api/v1/jobs?${params}`, {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
const jobs = result.data.items;
```

## Example (PHP)
```php
// Obtenir la liste des tâches
$client = new GuzzleHttp\\Client();
$response = $client->get('http://localhost:8000/api/v1/jobs', [
    'headers' => ['Authorization' => 'Bearer <token>'],
    'query' => [
        'page' => 1,
        'per_page' => 20,
        'status' => 'processing'
    ]
]);
$data = json_decode($response->getBody(), true)['data'];
$jobs = $data['items'];
$pagination = $data['pagination'];
```
""",
    responses={
        200: {
            "description": "Jobs retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "items": [
                                {
                                    "job_id": "550e8400-e29b-41d4-a716-446655440030",
                                    "type": "export",
                                    "status": "completed",
                                    "progress": 100.0,
                                    "created_at": "2024-01-15T10:30:00Z",
                                    "completed_at": "2024-01-15T10:32:15Z",
                                }
                            ],
                            "pagination": {
                                "total": 42,
                                "page": 1,
                                "per_page": 20,
                                "total_pages": 3,
                            },
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
    },
)
async def list_jobs(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1, description="Page number"),
    per_page: int = Query(default=20, ge=1, le=100, description="Items per page"),
    job_type: Optional[str] = Query(default=None, description="Filter by job type"),
    status: Optional[str] = Query(default=None, description="Filter by status"),
) -> APIResponse[dict]:
    """List user's jobs with pagination."""
    start_time = time.time()

    from app.core.database import get_db_session
    from sqlalchemy import select, func

    async with get_db_session() as session:
        # Build base query
        base_query = select(AsyncJob).where(AsyncJob.owner_id == user.user_id)

        # Filter by type
        if job_type:
            base_query = base_query.where(AsyncJob.job_type == job_type)

        # Filter by status
        if status:
            base_query = base_query.where(AsyncJob.status == status)

        # Get total count
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await session.execute(count_query)
        total = total_result.scalar() or 0

        # Order and paginate
        offset = (page - 1) * per_page
        paginated_query = base_query.order_by(AsyncJob.created_at.desc()).offset(offset).limit(per_page)
        result = await session.execute(paginated_query)
        jobs = result.scalars().all()

        # Format jobs
        items = []
        for job in jobs:
            items.append({
                "job_id": job.id,
                "type": job.job_type,
                "status": job.status,
                "progress": job.progress,
                "created_at": job.created_at.isoformat(),
                "started_at": job.started_at.isoformat() if job.started_at else None,
                "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                "document_id": job.document_id,
            })

        # Calculate pagination info
        total_pages = (total + per_page - 1) // per_page

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data={
                "items": items,
                "pagination": PaginationInfo(
                    total=total,
                    page=page,
                    per_page=per_page,
                    total_pages=total_pages,
                ).model_dump(),
            },
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )
