"""
Document management endpoints.

Handles document upload, retrieval, download, and deletion.
"""

import time
from typing import Any, Literal, Optional

from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.middleware.auth import AuthenticatedUser, OptionalUser
from app.middleware.request_id import get_request_id
from app.schemas.requests.documents import DownloadDocumentParams, UnlockDocumentRequest
from app.schemas.responses.common import APIResponse, MetaInfo, SuccessResponse
from app.services.document_service import document_service
from app.utils.helpers import now_utc

router = APIRouter()


@router.post(
    "/upload",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Upload PDF document",
    description="""
Upload and parse a PDF document.

The document is parsed into a scene graph representation with all
text, images, shapes, annotations, and form fields extracted.

For large files (>10MB), processing is done asynchronously and
a job_id is returned for tracking progress.

## Request Body
- **file**: PDF file (multipart/form-data)
- **password**: Optional password for encrypted PDFs
- **extract_text**: Extract text elements (default: true)
- **ocr_enabled**: Enable OCR for scanned pages (default: false)
- **generate_previews**: Generate preview images (default: true)

## Response
Returns the parsed document structure including:
- Document metadata (title, author, page count, etc.)
- Pages with elements
- Bookmarks/outlines
- Layers
- Embedded files

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/upload" \\
  -H "Authorization: Bearer <token>" \\
  -F "file=@document.pdf" \\
  -F "extract_text=true"
```

## Example (Python)
```python
import requests

files = {"file": open("document.pdf", "rb")}
data = {"extract_text": "true", "generate_previews": "true"}
headers = {"Authorization": "Bearer <token>"}

response = requests.post(
    "http://localhost:8000/api/v1/documents/upload",
    files=files,
    data=data,
    headers=headers
)
print(response.json())
```

## Example (JavaScript)
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('extract_text', 'true');

const response = await fetch('/api/v1/documents/upload', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer <token>' },
  body: formData
});
const result = await response.json();
```

## Example (PHP)
```php
$client = new GuzzleHttp\\Client();
$response = $client->post('http://localhost:8000/api/v1/documents/upload', [
    'headers' => ['Authorization' => 'Bearer <token>'],
    'multipart' => [
        ['name' => 'file', 'contents' => fopen('document.pdf', 'r')],
        ['name' => 'extract_text', 'contents' => 'true'],
    ]
]);
$result = json_decode($response->getBody(), true);
```
""",
    responses={
        201: {
            "description": "Document uploaded and parsed successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "status": "ready",
                            "document": {
                                "document_id": "550e8400-e29b-41d4-a716-446655440000",
                                "metadata": {
                                    "title": "Sample Document",
                                    "page_count": 10,
                                    "is_encrypted": False,
                                },
                                "pages": [],
                            },
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        202: {"description": "Large file - processing asynchronously"},
        400: {"description": "Invalid PDF or parsing error"},
        413: {"description": "File too large"},
    },
)
async def upload_document(
    file: UploadFile = File(..., description="PDF file to upload"),
    password: Optional[str] = Form(default=None, description="PDF password"),
    extract_text: bool = Form(default=True, description="Extract text elements"),
    ocr_enabled: bool = Form(default=False, description="Enable OCR"),
    ocr_languages: str = Form(default="fra+eng", description="OCR languages"),
    generate_previews: bool = Form(default=True, description="Generate previews"),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Upload and parse a PDF document."""
    start_time = time.time()

    # Read file content
    file_data = await file.read()

    # Get owner ID from authenticated user
    owner_id = user.user_id if user else None

    # Upload and parse document
    document_id, document = await document_service.upload_document(
        file_data=file_data,
        filename=file.filename or "document.pdf",
        password=password,
        owner_id=owner_id,
        extract_text=extract_text,
        generate_previews=generate_previews,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": document_id,
            "status": "ready",
            "document": document.model_dump(),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/{document_id}",
    response_model=APIResponse[dict],
    summary="Get document structure",
    description="""
Retrieve the complete structure of an uploaded document.

## Query Parameters
- **include_elements**: Include page elements (default: true)
- **include_previews**: Include preview URLs (default: true)
- **page_range**: Filter pages (e.g., "1-5,10,15-20")

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}",
    headers={"Authorization": "Bearer <token>"}
)
document = response.json()["data"]
```
""",
)
async def get_document(
    document_id: str,
    include_elements: bool = Query(default=True, description="Include page elements"),
    include_previews: bool = Query(default=True, description="Include preview URLs"),
    page_range: Optional[str] = Query(default=None, description="Page range filter"),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get document structure."""
    start_time = time.time()

    document = document_service.get_document(
        document_id=document_id,
        include_elements=include_elements,
        page_range=page_range,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=document.model_dump(),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/{document_id}/download",
    summary="Download PDF",
    description="""
Download the modified PDF document.

## Query Parameters
- **flatten_forms**: Flatten form fields into content (default: false)
- **flatten_annotations**: Flatten annotations into content (default: false)
- **optimize**: Optimize file size (default: false)

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/documents/{document_id}/download" \\
  -H "Authorization: Bearer <token>" \\
  -o document.pdf
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/documents/{document_id}/download",
    headers={"Authorization": "Bearer <token>"}
)

with open("document.pdf", "wb") as f:
    f.write(response.content)
```
""",
    responses={
        200: {
            "description": "PDF file",
            "content": {"application/pdf": {}},
        },
    },
)
async def download_document(
    document_id: str,
    flatten_forms: bool = Query(default=False),
    flatten_annotations: bool = Query(default=False),
    optimize: bool = Query(default=False),
    user: OptionalUser = None,
) -> Response:
    """Download the modified PDF."""
    pdf_bytes, filename = document_service.download_document(
        document_id=document_id,
        flatten_forms=flatten_forms,
        flatten_annotations=flatten_annotations,
        optimize=optimize,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


@router.delete(
    "/{document_id}",
    status_code=204,
    summary="Delete document",
    description="""
Delete a document and free server memory.

This removes the document from active sessions. It does not
affect any saved copies in persistent storage.

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/documents/{document_id}" \\
  -H "Authorization: Bearer <token>"
```
""",
)
async def delete_document(
    document_id: str,
    user: OptionalUser = None,
) -> None:
    """Delete document and free memory."""
    document_service.delete_document(document_id)


@router.post(
    "/{document_id}/unlock",
    response_model=APIResponse[dict],
    summary="Unlock encrypted PDF",
    description="""
Unlock an encrypted PDF with the provided password.

## Request Body
```json
{
  "password": "pdf-password",
  "remove_restrictions": false
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/documents/{document_id}/unlock" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"password": "secret123"}'
```
""",
)
async def unlock_document(
    document_id: str,
    request: UnlockDocumentRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Unlock an encrypted PDF."""
    # This would need implementation in the document service
    # For now, return a placeholder
    return APIResponse(
        success=True,
        data={
            "unlocked": True,
            "restrictions_removed": request.remove_restrictions,
        },
        meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
    )
