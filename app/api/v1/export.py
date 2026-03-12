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
    response_description="Export job created — contains job_id and initial status to track progress via the jobs endpoint",
    description="""
Start an asynchronous export operation to convert a PDF document to various formats.

This endpoint initiates an export job and immediately returns a job ID that can be used
to track progress and retrieve the exported file once processing is complete.

## Supported Formats

| Format | Description | Output |
|--------|-------------|--------|
| **png** | Export pages as PNG images | High-quality raster images with transparency support |
| **jpeg** | Export pages as JPEG images | Compressed raster images, smaller file size |
| **webp** | Export pages as WebP images | Modern format with excellent compression |
| **svg** | Export pages as SVG vector graphics | Scalable vector format, ideal for web |
| **html** | Export as HTML with text and layout | Preserves document structure and styling |
| **txt** | Export as plain text | Extracted text content only |
| **docx** | Export as Microsoft Word | (Coming soon) |
| **xlsx** | Export as Microsoft Excel | (Coming soon) |

## Image Export Options

For image formats (png, jpeg, webp, svg), each page is exported as a separate file.
Use the `single_file=true` parameter to receive all pages bundled in a ZIP archive.

### DPI Settings
- **72 DPI**: Screen resolution, smallest file size
- **150 DPI**: Default, good balance of quality and size
- **300 DPI**: Print quality
- **600 DPI**: High-resolution print quality

### Quality Settings (JPEG/WebP only)
- **1-50**: Low quality, smallest file size
- **51-84**: Medium quality
- **85**: Default, recommended for most use cases
- **86-100**: High quality, larger file size

## Workflow

1. Call this endpoint to start the export job
2. Receive a `job_id` in the response
3. Poll `/api/v1/jobs/{job_id}` to check progress
4. When status is "completed", download the result from `/api/v1/documents/{document_id}/export/{job_id}`
""",
    responses={
        202: {
            "description": "Export job created successfully",
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
        400: {"description": "Invalid format or parameters. Check that the format is supported and all parameters are within valid ranges."},
        404: {"description": "Document not found. The specified document_id does not exist or has expired."},
        401: {"description": "Unauthorized. Missing or invalid authentication token."},
        429: {"description": "Rate limit exceeded. Too many export requests."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/documents/{document_id}/export?format=png&dpi=300&single_file=true" \\
  -H "Authorization: Bearer $TOKEN"

# Response:
# {
#   "success": true,
#   "data": {
#     "job_id": "550e8400-e29b-41d4-a716-446655440030",
#     "status": "pending",
#     "message": "Export job created. Use the job_id to track progress."
#   }
# }

# Poll for completion:
curl -X GET "https://api.giga-pdf.com/api/v1/jobs/{job_id}" \\
  -H "Authorization: Bearer $TOKEN"

# Download result when completed:
curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/export/{job_id}" \\
  -H "Authorization: Bearer $TOKEN" \\
  -o exported_pages.zip'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests
import time

# Configuration
BASE_URL = "https://api.giga-pdf.com/api/v1"
TOKEN = "your_api_token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

document_id = "your-document-id"

# Start export job (PNG at 300 DPI)
response = requests.post(
    f"{BASE_URL}/documents/{document_id}/export",
    params={
        "format": "png",
        "dpi": 300,
        "page_range": "1-5",  # Export only pages 1-5
        "single_file": True   # Bundle as ZIP
    },
    headers=HEADERS
)
response.raise_for_status()
job_id = response.json()["data"]["job_id"]
print(f"Export job started: {job_id}")

# Poll for completion
while True:
    status_response = requests.get(
        f"{BASE_URL}/jobs/{job_id}",
        headers=HEADERS
    )
    job_status = status_response.json()["data"]
    print(f"Status: {job_status['status']} - Progress: {job_status.get('progress', 0)}%")

    if job_status["status"] == "completed":
        break
    elif job_status["status"] == "failed":
        raise Exception(f"Export failed: {job_status.get('error')}")

    time.sleep(2)

# Download the exported file
download_response = requests.get(
    f"{BASE_URL}/documents/{document_id}/export/{job_id}",
    headers=HEADERS
)
with open("exported_pages.zip", "wb") as f:
    f.write(download_response.content)
print("Export downloaded successfully!")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const BASE_URL = 'https://api.giga-pdf.com/api/v1';
const TOKEN = 'your_api_token';

async function exportDocument(documentId, options = {}) {
  const { format = 'png', dpi = 150, pageRange = null, singleFile = true } = options;

  // Build query string
  const params = new URLSearchParams({ format, dpi, single_file: singleFile });
  if (pageRange) params.append('page_range', pageRange);

  // Start export job
  const exportResponse = await fetch(
    `${BASE_URL}/documents/${documentId}/export?${params}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    }
  );

  if (!exportResponse.ok) {
    throw new Error(`Export failed: ${exportResponse.statusText}`);
  }

  const { data } = await exportResponse.json();
  const jobId = data.job_id;
  console.log(`Export job started: ${jobId}`);

  // Poll for completion
  while (true) {
    const statusResponse = await fetch(`${BASE_URL}/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const status = await statusResponse.json();

    console.log(`Status: ${status.data.status} - Progress: ${status.data.progress || 0}%`);

    if (status.data.status === 'completed') {
      break;
    } else if (status.data.status === 'failed') {
      throw new Error(`Export failed: ${status.data.error}`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Download the exported file
  const downloadResponse = await fetch(
    `${BASE_URL}/documents/${documentId}/export/${jobId}`,
    { headers: { 'Authorization': `Bearer ${TOKEN}` } }
  );

  const blob = await downloadResponse.blob();

  // Browser: trigger download
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'exported_pages.zip';
  a.click();
  window.URL.revokeObjectURL(url);

  return blob;
}

// Usage
exportDocument('your-document-id', {
  format: 'png',
  dpi: 300,
  pageRange: '1-10',
  singleFile: true
}).then(() => console.log('Export complete!'));'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$baseUrl = 'https://api.giga-pdf.com/api/v1';
$token = 'your_api_token';
$documentId = 'your-document-id';

// Start export job
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "{$baseUrl}/documents/{$documentId}/export?" . http_build_query([
        'format' => 'png',
        'dpi' => 300,
        'page_range' => '1-5',
        'single_file' => 'true'
    ]),
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode !== 202) {
    throw new Exception("Export failed with status {$httpCode}");
}

$result = json_decode($response, true);
$jobId = $result['data']['job_id'];
echo "Export job started: {$jobId}\\n";

// Poll for completion
while (true) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => "{$baseUrl}/jobs/{$jobId}",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"]
    ]);

    $statusResponse = curl_exec($ch);
    curl_close($ch);

    $status = json_decode($statusResponse, true)['data'];
    echo "Status: {$status['status']} - Progress: " . ($status['progress'] ?? 0) . "%\\n";

    if ($status['status'] === 'completed') {
        break;
    } elseif ($status['status'] === 'failed') {
        throw new Exception("Export failed: " . ($status['error'] ?? 'Unknown error'));
    }

    sleep(2);
}

// Download the exported file
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "{$baseUrl}/documents/{$documentId}/export/{$jobId}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"]
]);

$fileContent = curl_exec($ch);
curl_close($ch);

file_put_contents('exported_pages.zip', $fileContent);
echo "Export downloaded successfully!\\n";
?>'''
            }
        ]
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
    summary="Download export result",
    response_description="Binary file stream with appropriate Content-Type and Content-Disposition headers for the exported format",
    description="""
Download the exported file once the export job has completed.

This endpoint returns the exported file directly as a binary response with the
appropriate content type based on the export format.

## Response Content Types

The response content type depends on the format used when starting the export:

| Format | Content-Type | File Extension |
|--------|--------------|----------------|
| **png** | image/png | .png |
| **jpeg** | image/jpeg | .jpeg |
| **webp** | image/webp | .webp |
| **svg** | image/svg+xml | .svg |
| **html** | text/html | .html |
| **txt** | text/plain | .txt |
| **docx** | application/vnd.openxmlformats-officedocument.wordprocessingml.document | .docx |
| **xlsx** | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | .xlsx |
| **zip** (multi-page) | application/zip | .zip |

## Multi-Page Exports

When exporting multiple pages with `single_file=true`, the response will be a ZIP
archive containing all exported pages. The ZIP file structure:

```
export_{document_id}.zip
  ├── page_001.png
  ├── page_002.png
  ├── page_003.png
  └── ...
```

## Important Notes

- The job must be in "completed" status before downloading
- Export results are stored temporarily and will expire after 24 hours
- Large exports may take time; use the job status endpoint to monitor progress
- The `Content-Disposition` header includes the suggested filename
""",
    responses={
        200: {
            "description": "Export file downloaded successfully. Content type varies based on export format.",
            "content": {
                "application/zip": {"schema": {"type": "string", "format": "binary"}},
                "image/png": {"schema": {"type": "string", "format": "binary"}},
                "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                "image/webp": {"schema": {"type": "string", "format": "binary"}},
                "image/svg+xml": {"schema": {"type": "string", "format": "binary"}},
                "text/html": {"schema": {"type": "string"}},
                "text/plain": {"schema": {"type": "string"}},
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {"schema": {"type": "string", "format": "binary"}},
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        401: {"description": "Unauthorized. Missing or invalid authentication token."},
        404: {"description": "Job not found or export result not available. The job_id may be invalid or the job has not completed yet."},
        409: {"description": "Job not completed. The export job is still processing. Check job status first."},
        410: {"description": "Export result has expired. Results are deleted after 24 hours. Re-run the export."},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''# Download export result to file
curl -X GET "https://api.giga-pdf.com/api/v1/documents/{document_id}/export/{job_id}" \\
  -H "Authorization: Bearer $TOKEN" \\
  -o exported_document.zip

# Get content type from headers
curl -I "https://api.giga-pdf.com/api/v1/documents/{document_id}/export/{job_id}" \\
  -H "Authorization: Bearer $TOKEN"

# Example response headers:
# Content-Type: application/zip
# Content-Disposition: attachment; filename="export_abc123.zip"
# Content-Length: 1048576'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests
import os

BASE_URL = "https://api.giga-pdf.com/api/v1"
TOKEN = "your_api_token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

document_id = "your-document-id"
job_id = "your-job-id"

# Download the export result
response = requests.get(
    f"{BASE_URL}/documents/{document_id}/export/{job_id}",
    headers=HEADERS,
    stream=True  # Stream for large files
)
response.raise_for_status()

# Get filename from Content-Disposition header
content_disposition = response.headers.get("Content-Disposition", "")
if "filename=" in content_disposition:
    filename = content_disposition.split("filename=")[1].strip('"')
else:
    # Fallback based on content type
    content_type = response.headers.get("Content-Type", "")
    ext_map = {
        "application/zip": ".zip",
        "image/png": ".png",
        "image/jpeg": ".jpeg",
        "text/html": ".html",
        "text/plain": ".txt"
    }
    ext = ext_map.get(content_type.split(";")[0], ".bin")
    filename = f"export_{document_id}{ext}"

# Save to file (streaming for large files)
with open(filename, "wb") as f:
    for chunk in response.iter_content(chunk_size=8192):
        f.write(chunk)

print(f"Downloaded: {filename} ({os.path.getsize(filename)} bytes)")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const BASE_URL = 'https://api.giga-pdf.com/api/v1';
const TOKEN = 'your_api_token';

async function downloadExport(documentId, jobId) {
  const response = await fetch(
    `${BASE_URL}/documents/${documentId}/export/${jobId}`,
    {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Download failed: ${error.message || response.statusText}`);
  }

  // Get filename from Content-Disposition header
  const contentDisposition = response.headers.get('Content-Disposition') || '';
  let filename = 'export.zip';
  const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
  if (filenameMatch) {
    filename = filenameMatch[1];
  }

  const blob = await response.blob();

  // Browser: trigger download
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);

  console.log(`Downloaded: ${filename} (${blob.size} bytes)`);
  return blob;
}

// Node.js alternative using fs
async function downloadExportNode(documentId, jobId) {
  const fs = require('fs');
  const response = await fetch(
    `${BASE_URL}/documents/${documentId}/export/${jobId}`,
    { headers: { 'Authorization': `Bearer ${TOKEN}` } }
  );

  const buffer = await response.arrayBuffer();
  fs.writeFileSync('export.zip', Buffer.from(buffer));
  console.log('Download complete!');
}

// Usage
downloadExport('your-document-id', 'your-job-id')
  .then(() => console.log('Success!'))
  .catch(err => console.error(err));'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$baseUrl = 'https://api.giga-pdf.com/api/v1';
$token = 'your_api_token';
$documentId = 'your-document-id';
$jobId = 'your-job-id';

// Download export result
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "{$baseUrl}/documents/{$documentId}/export/{$jobId}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"],
    CURLOPT_HEADER => true  // Include headers in response
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

if ($httpCode !== 200) {
    throw new Exception("Download failed with status {$httpCode}");
}

// Separate headers and body
$headers = substr($response, 0, $headerSize);
$body = substr($response, $headerSize);

// Extract filename from Content-Disposition header
$filename = 'export.zip';  // Default
if (preg_match('/filename="?([^"\\r\\n]+)"?/', $headers, $matches)) {
    $filename = $matches[1];
}

// Save the file
file_put_contents($filename, $body);
echo "Downloaded: {$filename} (" . strlen($body) . " bytes)\\n";

// Alternative using Guzzle with streaming
/*
use GuzzleHttp\\Client;

$client = new Client();
$response = $client->get(
    "{$baseUrl}/documents/{$documentId}/export/{$jobId}",
    [
        'headers' => ['Authorization' => "Bearer {$token}"],
        'sink' => 'export.zip'  // Stream directly to file
    ]
);
echo "Download complete!\\n";
*/
?>'''
            }
        ]
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
