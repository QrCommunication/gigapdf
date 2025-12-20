"""
Export operations endpoints.

Handles document export to various formats (images, text, HTML, etc.).
"""

import time
from typing import Literal, Optional

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo
from app.tasks.export_tasks import export_document
from app.utils.helpers import generate_uuid, now_utc

router = APIRouter()


@router.post(
    "/{document_id}/export",
    response_model=APIResponse[dict],
    summary="Start document export",
    description="""
Start an async export operation to convert the document to various formats.

Supported formats:
- **png**: Export pages as PNG images
- **jpeg**: Export pages as JPEG images
- **webp**: Export pages as WebP images
- **svg**: Export pages as SVG vector graphics
- **html**: Export as HTML with text and layout
- **txt**: Export as plain text
- **docx**: Export as Microsoft Word (not yet implemented)
- **xlsx**: Export as Microsoft Excel (not yet implemented)

For image formats, each page is exported separately. Use the `single_file` parameter
to combine all pages into a ZIP archive.

## Path Parameters
- **document_id**: Document identifier (UUID v4)

## Query Parameters
- **format**: Output format (required)
- **page_range**: Pages to export (e.g., "1-5,10,15-20", default: all pages)
- **dpi**: Resolution for image formats (default: 150, max: 600)
- **quality**: Quality for JPEG/WebP (default: 85, range: 1-100)
- **single_file**: Combine into ZIP archive for multi-page exports (default: false)

## Response
Returns a job_id to track the export progress.

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/export?format=png&dpi=300" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Exporter un document en PNG haute résolution
response = requests.post(
    f"http://localhost:8000/api/v1/documents/{document_id}/export",
    params={
        "format": "png",
        "dpi": 300,
        "single_file": True
    },
    headers={"Authorization": "Bearer <token>"}
)
job = response.json()["data"]
job_id = job["job_id"]

# Vérifier la progression
import time
while True:
    status_response = requests.get(
        f"http://localhost:8000/api/v1/jobs/{job_id}",
        headers={"Authorization": "Bearer <token>"}
    )
    job_status = status_response.json()["data"]
    if job_status["status"] == "completed":
        break
    time.sleep(1)
```

## Example (JavaScript)
```javascript
// Exporter en format HTML
const response = await fetch(
  `/api/v1/documents/${documentId}/export?format=html`,
  {
    method: 'POST',
    headers: { 'Authorization': 'Bearer <token>' }
  }
);
const result = await response.json();
const jobId = result.data.job_id;

// Surveiller la progression
async function pollJobStatus(jobId) {
  while (true) {
    const statusRes = await fetch(`/api/v1/jobs/${jobId}`, {
      headers: { 'Authorization': 'Bearer <token>' }
    });
    const status = await statusRes.json();
    if (status.data.status === 'completed') {
      return status.data.result;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}
```

## Example (PHP)
```php
// Exporter un document en JPEG
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "http://localhost:8000/api/v1/documents/{$documentId}/export",
    [
        'headers' => ['Authorization' => 'Bearer <token>'],
        'query' => [
            'format' => 'jpeg',
            'quality' => 90,
            'page_range' => '1-10'
        ]
    ]
);
$job = json_decode($response->getBody(), true)['data'];
$jobId = $job['job_id'];

// Attendre la fin de l'export
while (true) {
    $statusRes = $client->get("http://localhost:8000/api/v1/jobs/{$jobId}", [
        'headers' => ['Authorization' => 'Bearer <token>']
    ]);
    $status = json_decode($statusRes->getBody(), true)['data'];
    if ($status['status'] === 'completed') {
        break;
    }
    sleep(1);
}
```
""",
    responses={
        202: {
            "description": "Export job created",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "job_id": "550e8400-e29b-41d4-a716-446655440030",
                            "status": "pending",
                            "message": "Export job created. Use the job_id to track progress.",
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {"description": "Invalid format or parameters"},
        404: {"description": "Document not found"},
    },
)
async def start_export(
    document_id: str,
    format: Literal["png", "jpeg", "webp", "svg", "html", "txt", "docx", "xlsx"] = Query(
        ..., description="Output format"
    ),
    page_range: Optional[str] = Query(default=None, description="Page range (e.g., '1-5,10')"),
    dpi: int = Query(default=150, ge=72, le=600, description="DPI for image formats"),
    quality: int = Query(default=85, ge=1, le=100, description="Quality for JPEG/WebP"),
    single_file: bool = Query(default=False, description="Combine into single archive"),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Start export to format."""
    start_time = time.time()

    # Verify document exists
    from app.repositories.document_repo import document_sessions
    doc_session = document_sessions.get_session(document_id)
    if not doc_session:
        from app.middleware.error_handler import DocumentNotFoundError
        raise DocumentNotFoundError(document_id)

    # Create job in database
    from app.models.database import AsyncJob
    from app.core.database import get_db_session

    async with get_db_session() as session:
        job_id = generate_uuid()
        owner_id = user.user_id if user else "anonymous"

        job = AsyncJob(
            id=job_id,
            job_type="export",
            status="pending",
            progress=0.0,
            document_id=document_id,
            owner_id=owner_id,
            input_params={
                "format": format,
                "page_range": page_range,
                "dpi": dpi,
                "quality": quality,
                "single_file": single_file,
            },
        )
        session.add(job)
        await session.flush()

        # Start Celery task
        task = export_document.delay(
            document_id=document_id,
            format=format,
            page_range=page_range,
            dpi=dpi,
            quality=quality,
            single_file=single_file,
        )

        # Update job with Celery task ID
        job.celery_task_id = task.id
        job.started_at = now_utc()
        job.status = "processing"
        # Session commits automatically on exit

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data={
                "job_id": job_id,
                "status": "pending",
                "message": "Export job created. Use the job_id to track progress.",
            },
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )


@router.get(
    "/{document_id}/export/{job_id}",
    summary="Get export result",
    description="""
Download the exported file or get the export result.

This endpoint returns the exported file directly. For multi-file exports with
`single_file=true`, it returns a ZIP archive.

## Path Parameters
- **document_id**: Document identifier (UUID v4)
- **job_id**: Export job identifier (UUID v4)

## Response
Returns the exported file with appropriate content type.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/export/{job_id}" \\
  -H "Authorization: Bearer <token>" \\
  -o export.zip
```

## Example (Python)
```python
import requests

# Télécharger le résultat de l'export
response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}/export/{job_id}",
    headers={"Authorization": "Bearer <token>"}
)

# Sauvegarder le fichier
with open("export.zip", "wb") as f:
    f.write(response.content)
```

## Example (JavaScript)
```javascript
// Télécharger le fichier exporté
const response = await fetch(
  `/api/v1/documents/${documentId}/export/${jobId}`,
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer <token>' }
  }
);
const blob = await response.blob();
const url = window.URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'export.zip';
a.click();
```

## Example (PHP)
```php
// Télécharger le fichier exporté
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "http://localhost:8000/api/v1/documents/{$documentId}/export/{$jobId}",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
file_put_contents('export.zip', $response->getBody());
```
""",
    responses={
        200: {
            "description": "Export file",
            "content": {
                "application/zip": {},
                "image/png": {},
                "image/jpeg": {},
                "text/html": {},
                "text/plain": {},
            },
        },
        404: {"description": "Job not found or not completed"},
        410: {"description": "Export result has expired"},
    },
)
async def get_export_result(
    document_id: str,
    job_id: str,
    user: OptionalUser = None,
) -> Response:
    """Get export result/download."""
    import os
    from app.models.database import AsyncJob
    from app.core.database import get_db_session
    from sqlalchemy import select

    async with get_db_session() as session:
        result = await session.execute(select(AsyncJob).where(AsyncJob.id == job_id))
        job = result.scalar_one_or_none()

        if not job:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError(f"Job not found: {job_id}")

        if job.status != "completed":
            from app.middleware.error_handler import InvalidOperationError
            raise InvalidOperationError(
                f"Job is not completed yet. Current status: {job.status}"
            )

        if not job.result:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError("Export result has expired or is not available")

        # Get export format and file path
        export_format = job.result.get("format", "zip")
        file_path = job.result.get("file_path")

        # Check for file_path (new approach) or legacy data
        if file_path:
            # New approach: read from saved file
            if not os.path.exists(file_path):
                from app.middleware.error_handler import NotFoundError
                raise NotFoundError("Export file has expired or was deleted")

            with open(file_path, "rb") as f:
                file_bytes = f.read()
        elif "data" in job.result:
            # Legacy support for old exports with inline data
            export_data = job.result["data"]
            if isinstance(export_data, str):
                file_bytes = export_data.encode("utf-8")
            elif isinstance(export_data, bytes):
                file_bytes = export_data
            else:
                file_bytes = bytes(export_data)
        else:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError("Export result has expired or is not available")

        # Determine content type
        content_type_map = {
            "png": "image/png",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
            "svg": "image/svg+xml",
            "html": "text/html; charset=utf-8",
            "txt": "text/plain; charset=utf-8",
            "zip": "application/zip",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }
        content_type = content_type_map.get(export_format, "application/octet-stream")

        # Determine filename from original format if available
        original_format = job.result.get("original_format", export_format)
        filename = f"export_{document_id}.{export_format}"

        return Response(
            content=file_bytes,
            media_type=content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(file_bytes)),
            },
        )
