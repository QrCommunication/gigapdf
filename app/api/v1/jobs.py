"""
Job management endpoints.

Handles async job status, cancellation, and listing.
"""

import time

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
    description="""Retrieve the current status and progress of an asynchronous job.

Jobs are created for long-running operations such as OCR processing, PDF export, document merge, and split operations. This endpoint allows you to poll for job completion and retrieve results.

**Job Status Values:**
- `pending` - Job is queued and waiting to be processed
- `processing` - Job is currently being executed
- `completed` - Job finished successfully, result data is available
- `failed` - Job encountered an error, error details are provided
- `cancelled` - Job was cancelled by the user

**Polling Strategy:**
For optimal performance, we recommend polling every 2-5 seconds for short jobs (< 1 minute) and every 10-30 seconds for longer operations like OCR on large documents.""",
    responses={
        200: {
            "description": "Job status retrieved successfully. The response includes job metadata, current progress (0-100), and result data if the job is completed.",
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
        404: {"description": "Job not found. The specified job_id does not exist or has been deleted."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/jobs/{job_id}" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Accept: application/json"'
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\nimport time\n\njob_id = "550e8400-e29b-41d4-a716-446655440030"\ntoken = "your_api_token"\n\n# Poll for job completion\nwhile True:\n    response = requests.get(\n        f"https://api.giga-pdf.com/api/v1/jobs/{job_id}",\n        headers={"Authorization": f"Bearer {token}"}\n    )\n    response.raise_for_status()\n    job = response.json()["data"]\n\n    print(f"Status: {job[\'status\']}, Progress: {job[\'progress\']}%")\n\n    if job["status"] == "completed":\n        print("Job completed! Result:", job["result"])\n        break\n    elif job["status"] == "failed":\n        print("Job failed:", job["error"])\n        break\n\n    time.sleep(2)  # Poll every 2 seconds'
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const jobId = "550e8400-e29b-41d4-a716-446655440030";\nconst token = "your_api_token";\n\n// Poll for job completion\nasync function pollJobStatus() {\n  while (true) {\n    const response = await fetch(\n      `https://api.giga-pdf.com/api/v1/jobs/${jobId}`,\n      {\n        method: "GET",\n        headers: {\n          "Authorization": `Bearer ${token}`,\n          "Accept": "application/json"\n        }\n      }\n    );\n\n    if (!response.ok) {\n      throw new Error(`HTTP error! status: ${response.status}`);\n    }\n\n    const { data: job } = await response.json();\n    console.log(`Status: ${job.status}, Progress: ${job.progress}%`);\n\n    if (job.status === "completed") {\n      console.log("Job completed!", job.result);\n      return job;\n    } else if (job.status === "failed") {\n      throw new Error(`Job failed: ${job.error.message}`);\n    }\n\n    await new Promise(resolve => setTimeout(resolve, 2000));\n  }\n}\n\npollJobStatus().catch(console.error);'
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$jobId = "550e8400-e29b-41d4-a716-446655440030";\n$token = "your_api_token";\n\n// Poll for job completion\nwhile (true) {\n    $ch = curl_init();\n    curl_setopt_array($ch, [\n        CURLOPT_URL => "https://api.giga-pdf.com/api/v1/jobs/{$jobId}",\n        CURLOPT_RETURNTRANSFER => true,\n        CURLOPT_HTTPHEADER => [\n            "Authorization: Bearer {$token}",\n            "Accept: application/json"\n        ]\n    ]);\n\n    $response = curl_exec($ch);\n    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n    curl_close($ch);\n\n    if ($httpCode !== 200) {\n        throw new Exception("HTTP error: {$httpCode}");\n    }\n\n    $data = json_decode($response, true);\n    $job = $data["data"];\n\n    echo "Status: {$job[\'status\']}, Progress: {$job[\'progress\']}%\\n";\n\n    if ($job["status"] === "completed") {\n        echo "Job completed!\\n";\n        print_r($job["result"]);\n        break;\n    } elseif ($job["status"] === "failed") {\n        throw new Exception("Job failed: " . $job["error"]["message"]);\n    }\n\n    sleep(2); // Poll every 2 seconds\n}'
            }
        ]
    },
)
async def get_job_status(
    job_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get job status with progress."""
    start_time = time.time()

    from sqlalchemy import select

    from app.core.database import get_db_session

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
    description="""Cancel a running or pending asynchronous job.

Use this endpoint to stop a job that is no longer needed. This is useful for:
- Cancelling long-running OCR operations on large documents
- Stopping export jobs that are taking too long
- Freeing up processing resources

**Cancellable States:**
- `pending` - Job is waiting in queue and can be cancelled
- `processing` - Job is running and will be terminated

**Non-Cancellable States:**
- `completed` - Job has already finished successfully
- `failed` - Job has already failed
- `cancelled` - Job was already cancelled

**Note:** Cancelling a job is irreversible. Any partial results will be discarded.""",
    responses={
        200: {
            "description": "Job cancelled successfully. The job has been terminated and any partial results have been discarded.",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "job_id": "550e8400-e29b-41d4-a716-446655440030",
                            "status": "cancelled",
                            "message": "Job cancelled successfully"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
        400: {"description": "Job cannot be cancelled. The job has already completed, failed, or was previously cancelled."},
        404: {"description": "Job not found. The specified job_id does not exist or has been deleted."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X DELETE "https://api.giga-pdf.com/api/v1/jobs/{job_id}" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Accept: application/json"'
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\njob_id = "550e8400-e29b-41d4-a716-446655440030"\ntoken = "your_api_token"\n\n# Cancel a running job\nresponse = requests.delete(\n    f"https://api.giga-pdf.com/api/v1/jobs/{job_id}",\n    headers={"Authorization": f"Bearer {token}"}\n)\n\nif response.status_code == 200:\n    result = response.json()\n    print(f"Job {result[\'data\'][\'job_id\']} cancelled successfully")\nelif response.status_code == 400:\n    error = response.json()\n    print(f"Cannot cancel job: {error[\'error\'][\'message\']}")\nelif response.status_code == 404:\n    print("Job not found")'
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const jobId = "550e8400-e29b-41d4-a716-446655440030";\nconst token = "your_api_token";\n\n// Cancel a running job\nasync function cancelJob() {\n  const response = await fetch(\n    `https://api.giga-pdf.com/api/v1/jobs/${jobId}`,\n    {\n      method: "DELETE",\n      headers: {\n        "Authorization": `Bearer ${token}`,\n        "Accept": "application/json"\n      }\n    }\n  );\n\n  const result = await response.json();\n\n  if (response.ok) {\n    console.log(`Job ${result.data.job_id} cancelled successfully`);\n  } else if (response.status === 400) {\n    console.log(`Cannot cancel job: ${result.error.message}`);\n  } else if (response.status === 404) {\n    console.log("Job not found");\n  }\n\n  return result;\n}\n\ncancelJob().catch(console.error);'
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$jobId = "550e8400-e29b-41d4-a716-446655440030";\n$token = "your_api_token";\n\n// Cancel a running job\n$ch = curl_init();\ncurl_setopt_array($ch, [\n    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/jobs/{$jobId}",\n    CURLOPT_CUSTOMREQUEST => "DELETE",\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_HTTPHEADER => [\n        "Authorization: Bearer {$token}",\n        "Accept: application/json"\n    ]\n]);\n\n$response = curl_exec($ch);\n$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\ncurl_close($ch);\n\n$result = json_decode($response, true);\n\nif ($httpCode === 200) {\n    echo "Job {$result[\'data\'][\'job_id\']} cancelled successfully\\n";\n} elseif ($httpCode === 400) {\n    echo "Cannot cancel job: {$result[\'error\'][\'message\']}\\n";\n} elseif ($httpCode === 404) {\n    echo "Job not found\\n";\n}'
            }
        ]
    },
)
async def cancel_job(
    job_id: str,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Cancel a running job."""
    start_time = time.time()

    from sqlalchemy import select

    from app.core.database import get_db_session

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
    description="""Retrieve a paginated list of all jobs for the authenticated user.

Returns jobs sorted by creation time (newest first). Use query parameters to filter results by job type or status.

**Job Types:**
- `ocr` - Optical Character Recognition processing
- `export` - PDF export to other formats (Word, Excel, PowerPoint, images)
- `merge` - Combining multiple PDFs into one
- `split` - Splitting a PDF into multiple documents
- `upload` - File upload and processing
- `convert` - File format conversion

**Job Statuses:**
- `pending` - Job is queued and waiting to be processed
- `processing` - Job is currently being executed
- `completed` - Job finished successfully
- `failed` - Job encountered an error
- `cancelled` - Job was cancelled by the user

**Pagination:**
Use `page` and `per_page` parameters to navigate through results. The response includes pagination metadata with total count and page information.""",
    responses={
        200: {
            "description": "Jobs retrieved successfully. Returns a paginated list of jobs with their current status and metadata.",
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
                                    "started_at": "2024-01-15T10:30:05Z",
                                    "completed_at": "2024-01-15T10:32:15Z",
                                    "document_id": "550e8400-e29b-41d4-a716-446655440000"
                                },
                                {
                                    "job_id": "550e8400-e29b-41d4-a716-446655440031",
                                    "type": "ocr",
                                    "status": "processing",
                                    "progress": 45.0,
                                    "created_at": "2024-01-15T10:35:00Z",
                                    "started_at": "2024-01-15T10:35:02Z",
                                    "completed_at": None,
                                    "document_id": "550e8400-e29b-41d4-a716-446655440001"
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
        401: {"description": "Unauthorized. Authentication token is missing or invalid."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '# List all jobs\ncurl -X GET "https://api.giga-pdf.com/api/v1/jobs" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Accept: application/json"\n\n# Filter by status and paginate\ncurl -X GET "https://api.giga-pdf.com/api/v1/jobs?status=processing&page=1&per_page=10" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Accept: application/json"\n\n# Filter by job type\ncurl -X GET "https://api.giga-pdf.com/api/v1/jobs?job_type=ocr" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Accept: application/json"'
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\ntoken = "your_api_token"\n\n# List all jobs with pagination\nresponse = requests.get(\n    "https://api.giga-pdf.com/api/v1/jobs",\n    params={\n        "page": 1,\n        "per_page": 20,\n        "status": "processing"  # Optional: filter by status\n    },\n    headers={"Authorization": f"Bearer {token}"}\n)\nresponse.raise_for_status()\n\ndata = response.json()["data"]\njobs = data["items"]\npagination = data["pagination"]\n\nprint(f"Found {pagination[\'total\']} jobs (page {pagination[\'page\']} of {pagination[\'total_pages\']})")\n\nfor job in jobs:\n    print(f"Job {job[\'job_id\']}: {job[\'type\']} - {job[\'status\']} ({job[\'progress\']}%)")\n\n# Iterate through all pages\nall_jobs = []\npage = 1\nwhile True:\n    response = requests.get(\n        "https://api.giga-pdf.com/api/v1/jobs",\n        params={"page": page, "per_page": 100},\n        headers={"Authorization": f"Bearer {token}"}\n    )\n    data = response.json()["data"]\n    all_jobs.extend(data["items"])\n    if page >= data["pagination"]["total_pages"]:\n        break\n    page += 1'
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const token = "your_api_token";\n\n// List jobs with filters\nasync function listJobs(options = {}) {\n  const params = new URLSearchParams({\n    page: options.page || 1,\n    per_page: options.perPage || 20,\n    ...(options.status && { status: options.status }),\n    ...(options.jobType && { job_type: options.jobType })\n  });\n\n  const response = await fetch(\n    `https://api.giga-pdf.com/api/v1/jobs?${params}`,\n    {\n      method: "GET",\n      headers: {\n        "Authorization": `Bearer ${token}`,\n        "Accept": "application/json"\n      }\n    }\n  );\n\n  if (!response.ok) {\n    throw new Error(`HTTP error! status: ${response.status}`);\n  }\n\n  const { data } = await response.json();\n  return data;\n}\n\n// Get processing jobs\nconst { items: jobs, pagination } = await listJobs({ status: "processing" });\nconsole.log(`Found ${pagination.total} processing jobs`);\n\njobs.forEach(job => {\n  console.log(`${job.job_id}: ${job.type} - ${job.progress}%`);\n});'
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$token = "your_api_token";\n\n// List jobs with filters\nfunction listJobs($token, $options = []) {\n    $queryParams = http_build_query([\n        "page" => $options["page"] ?? 1,\n        "per_page" => $options["per_page"] ?? 20,\n        "status" => $options["status"] ?? null,\n        "job_type" => $options["job_type"] ?? null\n    ]);\n\n    $ch = curl_init();\n    curl_setopt_array($ch, [\n        CURLOPT_URL => "https://api.giga-pdf.com/api/v1/jobs?{$queryParams}",\n        CURLOPT_RETURNTRANSFER => true,\n        CURLOPT_HTTPHEADER => [\n            "Authorization: Bearer {$token}",\n            "Accept: application/json"\n        ]\n    ]);\n\n    $response = curl_exec($ch);\n    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n    curl_close($ch);\n\n    if ($httpCode !== 200) {\n        throw new Exception("HTTP error: {$httpCode}");\n    }\n\n    return json_decode($response, true)["data"];\n}\n\n// Get all processing jobs\n$data = listJobs($token, ["status" => "processing"]);\n$jobs = $data["items"];\n$pagination = $data["pagination"];\n\necho "Found {$pagination[\'total\']} processing jobs\\n";\n\nforeach ($jobs as $job) {\n    echo "{$job[\'job_id\']}: {$job[\'type\']} - {$job[\'progress\']}%\\n";\n}'
            }
        ]
    },
)
async def list_jobs(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1, description="Page number"),
    per_page: int = Query(default=20, ge=1, le=100, description="Items per page"),
    job_type: str | None = Query(default=None, description="Filter by job type"),
    status: str | None = Query(default=None, description="Filter by status"),
) -> APIResponse[dict]:
    """List user's jobs with pagination."""
    start_time = time.time()

    from sqlalchemy import func, select

    from app.core.database import get_db_session

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
