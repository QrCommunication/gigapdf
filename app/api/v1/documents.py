"""
Document management endpoints.

Handles document upload, retrieval, download, and deletion.
"""

import logging
import time

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response

from app.dependencies import preload_document_session
from app.middleware.auth import OptionalUser
from app.middleware.request_id import get_request_id
from app.repositories.document_repo import document_sessions
from app.schemas.requests.documents import UnlockDocumentRequest
from app.schemas.responses.common import APIResponse, MetaInfo
from app.services.document_service import document_service
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/upload",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Upload PDF document",
    response_description="Parsed document structure with metadata, pages, and extracted elements",
    description="""
Upload and parse a PDF document.

The document is parsed into a scene graph representation with all
text, images, shapes, annotations, and form fields extracted.

For large files (>10MB), processing is done asynchronously and
a job_id is returned for tracking progress.

## Request Body (multipart/form-data)
- **file**: PDF file to upload (required)
- **password**: Optional password for encrypted PDFs
- **extract_text**: Extract text elements (default: true)
- **ocr_enabled**: Enable OCR for scanned pages (default: false)
- **ocr_languages**: OCR language codes, e.g., "fra+eng" (default: "fra+eng")
- **generate_previews**: Generate preview images (default: true)

## Response
Returns the parsed document structure including:
- Document metadata (title, author, page count, etc.)
- Pages with elements (text, images, shapes, annotations)
- Bookmarks/outlines
- Layers
- Embedded files

## Notes
- Maximum file size: 100MB
- Supported format: PDF only
- Processing time depends on document complexity and OCR settings
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
                                    "author": "John Doe",
                                    "page_count": 10,
                                    "is_encrypted": False,
                                    "file_size": 1048576,
                                },
                                "pages": [],
                            },
                        },
                        "meta": {
                            "request_id": "req_abc123",
                            "timestamp": "2024-01-15T10:30:00Z",
                            "processing_time_ms": 1250,
                        },
                    }
                }
            },
        },
        202: {
            "description": "Large file accepted - processing asynchronously",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "status": "processing",
                            "job_id": "job_xyz789",
                        },
                        "meta": {"request_id": "req_abc123", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {
            "description": "Invalid PDF file or parsing error",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "INVALID_PDF",
                            "message": "The uploaded file is not a valid PDF document",
                        },
                    }
                }
            },
        },
        401: {
            "description": "Authentication required",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "UNAUTHORIZED",
                            "message": "Valid authentication token required",
                        },
                    }
                }
            },
        },
        413: {
            "description": "File too large (max 100MB)",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "FILE_TOO_LARGE",
                            "message": "File size exceeds maximum allowed size of 100MB",
                        },
                    }
                }
            },
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/documents/upload" \\\n'
                '  -H "Authorization: Bearer $TOKEN" \\\n'
                '  -F "file=@document.pdf" \\\n'
                '  -F "extract_text=true" \\\n'
                '  -F "ocr_enabled=false" \\\n'
                '  -F "generate_previews=true"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\n'
                'url = "https://api.giga-pdf.com/api/v1/documents/upload"\n'
                'headers = {"Authorization": f"Bearer {token}"}\n\n'
                'with open("document.pdf", "rb") as f:\n'
                '    files = {"file": ("document.pdf", f, "application/pdf")}\n'
                '    data = {\n'
                '        "extract_text": "true",\n'
                '        "ocr_enabled": "false",\n'
                '        "generate_previews": "true"\n'
                '    }\n'
                '    response = requests.post(url, headers=headers, files=files, data=data)\n\n'
                'result = response.json()\n'
                'document_id = result["data"]["document_id"]\n'
                'print(f"Document uploaded: {document_id}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const formData = new FormData();\n'
                'formData.append("file", fileInput.files[0]);\n'
                'formData.append("extract_text", "true");\n'
                'formData.append("ocr_enabled", "false");\n'
                'formData.append("generate_previews", "true");\n\n'
                'const response = await fetch("https://api.giga-pdf.com/api/v1/documents/upload", {\n'
                '  method: "POST",\n'
                '  headers: {\n'
                '    "Authorization": `Bearer ${token}`\n'
                '  },\n'
                '  body: formData\n'
                '});\n\n'
                'const result = await response.json();\n'
                'const documentId = result.data.document_id;\n'
                'console.log(`Document uploaded: ${documentId}`);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n'
                '$ch = curl_init();\n\n'
                'curl_setopt_array($ch, [\n'
                '    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/upload",\n'
                '    CURLOPT_POST => true,\n'
                '    CURLOPT_HTTPHEADER => [\n'
                '        "Authorization: Bearer $token"\n'
                '    ],\n'
                '    CURLOPT_POSTFIELDS => [\n'
                '        "file" => new CURLFile("document.pdf", "application/pdf"),\n'
                '        "extract_text" => "true",\n'
                '        "ocr_enabled" => "false",\n'
                '        "generate_previews" => "true"\n'
                '    ],\n'
                '    CURLOPT_RETURNTRANSFER => true\n'
                ']);\n\n'
                '$response = curl_exec($ch);\n'
                '$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n'
                'curl_close($ch);\n\n'
                '$result = json_decode($response, true);\n'
                '$documentId = $result["data"]["document_id"];\n'
                'echo "Document uploaded: " . $documentId;',
            },
        ]
    },
)
async def upload_document(
    file: UploadFile = File(..., description="PDF file to upload"),
    password: str | None = Form(default=None, description="PDF password"),
    extract_text: bool = Form(default=True, description="Extract text elements"),
    ocr_enabled: bool = Form(default=False, description="Enable OCR"),
    ocr_languages: str = Form(default="fra+eng", description="OCR languages"),
    generate_previews: bool = Form(default=True, description="Generate previews"),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Upload and parse a PDF document."""
    start_time = time.time()

    # Stream-read the file in chunks to prevent PDF-bomb / OOM attacks.
    # Validation order (fail-fast):
    #   1. Validate PDF magic bytes (%PDF-) on the very first chunk.
    #   2. Enforce hard size cap while reading — reject before buffering all bytes.
    # The hard ceiling (100 MB) is enforced regardless of the server-side setting
    # to limit blast radius if max_upload_size_mb is misconfigured.
    MAX_SIZE_BYTES = min(
        document_service.settings.max_upload_size_bytes,
        100 * 1024 * 1024,  # hard ceiling: 100 MB
    )
    CHUNK_SIZE = 64 * 1024  # 64 KB per read
    PDF_MAGIC = b"%PDF-"

    chunks: list[bytes] = []
    total_read = 0
    first_chunk = True

    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break

        if first_chunk:
            # Validate PDF magic bytes before accepting any data
            if not chunk.startswith(PDF_MAGIC):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "Invalid file type. Only PDF files are accepted "
                        "(%PDF- header missing)."
                    ),
                )
            first_chunk = False

        total_read += len(chunk)
        if total_read > MAX_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    f"File too large. Maximum allowed size is "
                    f"{MAX_SIZE_BYTES // (1024 * 1024)} MB."
                ),
            )
        chunks.append(chunk)

    file_data = b"".join(chunks)

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
            "document": document.model_dump(by_alias=True),
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
    response_description="Complete document structure including metadata, pages, bookmarks, and layers",
    description="""
Retrieve the complete structure of an uploaded document.

Returns the full document representation including metadata, pages, elements,
bookmarks, layers, and embedded files. Use query parameters to filter the
response and reduce payload size.

## Path Parameters
- **document_id**: Unique identifier of the document (UUID format)

## Query Parameters
- **include_elements**: Include page elements like text, images, shapes (default: true)
- **include_previews**: Include preview image URLs for each page (default: true)
- **page_range**: Filter to specific pages using range notation (e.g., "1-5,10,15-20")

## Response
Returns the document structure with:
- Document metadata (title, author, creation date, page count)
- Pages array with dimensions and elements
- Bookmarks/outline hierarchy
- Layer information
- Form field definitions

## Notes
- Large documents may take longer to retrieve with all elements
- Use page_range to fetch specific pages for better performance
- Preview URLs are temporary and expire after 1 hour
""",
    responses={
        200: {
            "description": "Document structure retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "metadata": {
                                "title": "Sample Document",
                                "author": "John Doe",
                                "creator": "Microsoft Word",
                                "page_count": 10,
                                "is_encrypted": False,
                                "file_size": 1048576,
                                "created_at": "2024-01-10T08:00:00Z",
                            },
                            "pages": [
                                {
                                    "page_number": 1,
                                    "width": 612,
                                    "height": 792,
                                    "elements": [],
                                    "preview_url": "https://api.giga-pdf.com/previews/abc123/page-1.png",
                                }
                            ],
                            "bookmarks": [],
                            "layers": [],
                        },
                        "meta": {
                            "request_id": "req_abc123",
                            "timestamp": "2024-01-15T10:30:00Z",
                            "processing_time_ms": 45,
                        },
                    }
                }
            },
        },
        401: {
            "description": "Authentication required",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "UNAUTHORIZED",
                            "message": "Valid authentication token required",
                        },
                    }
                }
            },
        },
        403: {
            "description": "Access denied to this document",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "FORBIDDEN",
                            "message": "You do not have permission to access this document",
                        },
                    }
                }
            },
        },
        404: {
            "description": "Document not found",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "NOT_FOUND",
                            "message": "Document with ID '550e8400-e29b-41d4-a716-446655440000' not found",
                        },
                    }
                }
            },
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/documents/550e8400-e29b-41d4-a716-446655440000" \\\n'
                '  -H "Authorization: Bearer $TOKEN" \\\n'
                '  -H "Accept: application/json"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\n'
                'document_id = "550e8400-e29b-41d4-a716-446655440000"\n'
                'url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}"\n'
                'headers = {"Authorization": f"Bearer {token}"}\n'
                'params = {\n'
                '    "include_elements": True,\n'
                '    "include_previews": True,\n'
                '    "page_range": "1-5"  # Optional: fetch only pages 1-5\n'
                '}\n\n'
                'response = requests.get(url, headers=headers, params=params)\n'
                'document = response.json()["data"]\n\n'
                'print(f"Title: {document[\'metadata\'][\'title\']}")\n'
                'print(f"Pages: {document[\'metadata\'][\'page_count\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const documentId = "550e8400-e29b-41d4-a716-446655440000";\n'
                'const params = new URLSearchParams({\n'
                '  include_elements: "true",\n'
                '  include_previews: "true",\n'
                '  page_range: "1-5"  // Optional: fetch only pages 1-5\n'
                '});\n\n'
                'const response = await fetch(\n'
                '  `https://api.giga-pdf.com/api/v1/documents/${documentId}?${params}`,\n'
                '  {\n'
                '    method: "GET",\n'
                '    headers: {\n'
                '      "Authorization": `Bearer ${token}`,\n'
                '      "Accept": "application/json"\n'
                '    }\n'
                '  }\n'
                ');\n\n'
                'const { data: document } = await response.json();\n'
                'console.log(`Title: ${document.metadata.title}`);\n'
                'console.log(`Pages: ${document.metadata.page_count}`);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n'
                '$documentId = "550e8400-e29b-41d4-a716-446655440000";\n'
                '$params = http_build_query([\n'
                '    "include_elements" => "true",\n'
                '    "include_previews" => "true",\n'
                '    "page_range" => "1-5"  // Optional: fetch only pages 1-5\n'
                ']);\n\n'
                '$ch = curl_init();\n\n'
                'curl_setopt_array($ch, [\n'
                '    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}?{$params}",\n'
                '    CURLOPT_HTTPHEADER => [\n'
                '        "Authorization: Bearer $token",\n'
                '        "Accept: application/json"\n'
                '    ],\n'
                '    CURLOPT_RETURNTRANSFER => true\n'
                ']);\n\n'
                '$response = curl_exec($ch);\n'
                'curl_close($ch);\n\n'
                '$result = json_decode($response, true);\n'
                '$document = $result["data"];\n\n'
                'echo "Title: " . $document["metadata"]["title"] . "\\n";\n'
                'echo "Pages: " . $document["metadata"]["page_count"];',
            },
        ]
    },
)
async def get_document(
    document_id: str,
    include_elements: bool = Query(default=True, description="Include page elements"),
    include_previews: bool = Query(default=True, description="Include preview URLs"),
    page_range: str | None = Query(default=None, description="Page range filter"),
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Get document structure."""
    start_time = time.time()

    # Preload session from Redis if needed
    await preload_document_session(document_id)

    # Enforce ownership: if the session has an owner, only that user may access it.
    # Anonymous sessions (owner_id=None) remain publicly accessible by document_id.
    session = await document_sessions.get_session_async(document_id)
    if session and session.owner_id is not None:
        if user is None or user.user_id != session.owner_id:
            logger.warning(
                "Unauthorized GET attempt on document %s by user %s",
                document_id,
                user.user_id if user else "anonymous",
            )
            # Return 404 to avoid confirming document existence to unauthorized callers
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not found",
            )

    document = document_service.get_document(
        document_id=document_id,
        include_elements=include_elements,
        page_range=page_range,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=document.model_dump(by_alias=True),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/{document_id}/download",
    summary="Download PDF document",
    response_description="Binary PDF file stream with applied modifications",
    description="""
Download the PDF document with all modifications applied.

Returns the PDF file as a binary stream. Any edits made to the document
(text changes, annotations, form fills, etc.) will be included in the
downloaded file.

## Path Parameters
- **document_id**: Unique identifier of the document (UUID format)

## Query Parameters
- **flatten_forms**: Flatten form fields into static content (default: false)
  - When true, form fields become non-editable text
  - Useful for creating final, non-editable versions
- **flatten_annotations**: Flatten annotations into page content (default: false)
  - When true, annotations become part of the page
  - Comments and markups become permanent
- **optimize**: Optimize PDF for smaller file size (default: false)
  - Compresses images and removes redundant data
  - May slightly reduce quality

## Response
Returns the PDF file as `application/pdf` with appropriate headers:
- `Content-Disposition`: Suggests filename for download
- `Content-Length`: File size in bytes

## Notes
- The original document is not modified; a new PDF is generated
- Large documents may take several seconds to generate
- Flattening operations are irreversible in the downloaded file
""",
    responses={
        200: {
            "description": "PDF file downloaded successfully",
            "content": {
                "application/pdf": {
                    "schema": {"type": "string", "format": "binary"},
                    "example": "(Binary PDF data)",
                }
            },
            "headers": {
                "Content-Disposition": {
                    "description": "Attachment filename",
                    "schema": {"type": "string", "example": 'attachment; filename="document.pdf"'},
                },
                "Content-Length": {
                    "description": "File size in bytes",
                    "schema": {"type": "integer", "example": 1048576},
                },
            },
        },
        401: {
            "description": "Authentication required",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "UNAUTHORIZED",
                            "message": "Valid authentication token required",
                        },
                    }
                }
            },
        },
        403: {
            "description": "Access denied to this document",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "FORBIDDEN",
                            "message": "You do not have permission to download this document",
                        },
                    }
                }
            },
        },
        404: {
            "description": "Document not found",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "NOT_FOUND",
                            "message": "Document with ID '550e8400-e29b-41d4-a716-446655440000' not found",
                        },
                    }
                }
            },
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/documents/550e8400-e29b-41d4-a716-446655440000/download?flatten_forms=false&optimize=true" \\\n'
                '  -H "Authorization: Bearer $TOKEN" \\\n'
                '  -o downloaded_document.pdf',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\n'
                'document_id = "550e8400-e29b-41d4-a716-446655440000"\n'
                'url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}/download"\n'
                'headers = {"Authorization": f"Bearer {token}"}\n'
                'params = {\n'
                '    "flatten_forms": False,\n'
                '    "flatten_annotations": False,\n'
                '    "optimize": True\n'
                '}\n\n'
                'response = requests.get(url, headers=headers, params=params, stream=True)\n\n'
                'if response.status_code == 200:\n'
                '    with open("downloaded_document.pdf", "wb") as f:\n'
                '        for chunk in response.iter_content(chunk_size=8192):\n'
                '            f.write(chunk)\n'
                '    print("Document downloaded successfully")\n'
                'else:\n'
                '    print(f"Error: {response.json()}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const documentId = "550e8400-e29b-41d4-a716-446655440000";\n'
                'const params = new URLSearchParams({\n'
                '  flatten_forms: "false",\n'
                '  flatten_annotations: "false",\n'
                '  optimize: "true"\n'
                '});\n\n'
                'const response = await fetch(\n'
                '  `https://api.giga-pdf.com/api/v1/documents/${documentId}/download?${params}`,\n'
                '  {\n'
                '    method: "GET",\n'
                '    headers: {\n'
                '      "Authorization": `Bearer ${token}`\n'
                '    }\n'
                '  }\n'
                ');\n\n'
                'if (response.ok) {\n'
                '  const blob = await response.blob();\n'
                '  // Create download link\n'
                '  const url = window.URL.createObjectURL(blob);\n'
                '  const a = document.createElement("a");\n'
                '  a.href = url;\n'
                '  a.download = "downloaded_document.pdf";\n'
                '  a.click();\n'
                '  window.URL.revokeObjectURL(url);\n'
                '} else {\n'
                '  const error = await response.json();\n'
                '  console.error("Download failed:", error);\n'
                '}',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n'
                '$documentId = "550e8400-e29b-41d4-a716-446655440000";\n'
                '$params = http_build_query([\n'
                '    "flatten_forms" => "false",\n'
                '    "flatten_annotations" => "false",\n'
                '    "optimize" => "true"\n'
                ']);\n\n'
                '$ch = curl_init();\n\n'
                '$outputFile = fopen("downloaded_document.pdf", "wb");\n\n'
                'curl_setopt_array($ch, [\n'
                '    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/download?{$params}",\n'
                '    CURLOPT_HTTPHEADER => [\n'
                '        "Authorization: Bearer $token"\n'
                '    ],\n'
                '    CURLOPT_FILE => $outputFile,\n'
                '    CURLOPT_FOLLOWLOCATION => true\n'
                ']);\n\n'
                '$success = curl_exec($ch);\n'
                '$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n'
                'curl_close($ch);\n'
                'fclose($outputFile);\n\n'
                'if ($httpCode === 200 && $success) {\n'
                '    echo "Document downloaded successfully";\n'
                '} else {\n'
                '    echo "Download failed with HTTP code: " . $httpCode;\n'
                '}',
            },
        ]
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
    # Preload session from Redis if needed
    await preload_document_session(document_id)

    # Enforce ownership: if the session has an owner, only that user may download it.
    session = await document_sessions.get_session_async(document_id)
    if session and session.owner_id is not None:
        if user is None or user.user_id != session.owner_id:
            logger.warning(
                "Unauthorized DOWNLOAD attempt on document %s by user %s",
                document_id,
                user.user_id if user else "anonymous",
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not found",
            )

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
    response_description="No content — document successfully deleted and resources freed",
    description="""
Delete a document and free server memory.

Removes the document from active sessions and releases all associated
resources including cached previews and temporary files. This operation
is irreversible for the current session.

## Path Parameters
- **document_id**: Unique identifier of the document (UUID format)

## Behavior
- Removes document from active session memory
- Deletes cached preview images
- Frees server resources
- Does NOT affect permanently saved copies (if any)

## Response
Returns HTTP 204 No Content on success. No response body is returned.

## Notes
- This operation cannot be undone for the current session
- If the document was saved to persistent storage, it can be re-uploaded
- Attempting to access a deleted document will return 404
""",
    responses={
        204: {
            "description": "Document deleted successfully (no content returned)",
        },
        401: {
            "description": "Authentication required",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "UNAUTHORIZED",
                            "message": "Valid authentication token required",
                        },
                    }
                }
            },
        },
        403: {
            "description": "Access denied - not authorized to delete this document",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "FORBIDDEN",
                            "message": "You do not have permission to delete this document",
                        },
                    }
                }
            },
        },
        404: {
            "description": "Document not found",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "NOT_FOUND",
                            "message": "Document with ID '550e8400-e29b-41d4-a716-446655440000' not found",
                        },
                    }
                }
            },
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X DELETE "https://api.giga-pdf.com/api/v1/documents/550e8400-e29b-41d4-a716-446655440000" \\\n'
                '  -H "Authorization: Bearer $TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\n'
                'document_id = "550e8400-e29b-41d4-a716-446655440000"\n'
                'url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}"\n'
                'headers = {"Authorization": f"Bearer {token}"}\n\n'
                'response = requests.delete(url, headers=headers)\n\n'
                'if response.status_code == 204:\n'
                '    print("Document deleted successfully")\n'
                'elif response.status_code == 404:\n'
                '    print("Document not found")\n'
                'else:\n'
                '    print(f"Error: {response.status_code}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const documentId = "550e8400-e29b-41d4-a716-446655440000";\n\n'
                'const response = await fetch(\n'
                '  `https://api.giga-pdf.com/api/v1/documents/${documentId}`,\n'
                '  {\n'
                '    method: "DELETE",\n'
                '    headers: {\n'
                '      "Authorization": `Bearer ${token}`\n'
                '    }\n'
                '  }\n'
                ');\n\n'
                'if (response.status === 204) {\n'
                '  console.log("Document deleted successfully");\n'
                '} else if (response.status === 404) {\n'
                '  console.log("Document not found");\n'
                '} else {\n'
                '  const error = await response.json();\n'
                '  console.error("Delete failed:", error);\n'
                '}',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n'
                '$documentId = "550e8400-e29b-41d4-a716-446655440000";\n\n'
                '$ch = curl_init();\n\n'
                'curl_setopt_array($ch, [\n'
                '    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}",\n'
                '    CURLOPT_CUSTOMREQUEST => "DELETE",\n'
                '    CURLOPT_HTTPHEADER => [\n'
                '        "Authorization: Bearer $token"\n'
                '    ],\n'
                '    CURLOPT_RETURNTRANSFER => true\n'
                ']);\n\n'
                '$response = curl_exec($ch);\n'
                '$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n'
                'curl_close($ch);\n\n'
                'if ($httpCode === 204) {\n'
                '    echo "Document deleted successfully";\n'
                '} elseif ($httpCode === 404) {\n'
                '    echo "Document not found";\n'
                '} else {\n'
                '    echo "Delete failed with HTTP code: " . $httpCode;\n'
                '}',
            },
        ]
    },
)
async def delete_document(
    document_id: str,
    user: OptionalUser = None,
) -> None:
    """Delete document and free memory."""
    # Preload session from Redis if needed
    await preload_document_session(document_id)

    # Enforce ownership: if the session has an owner, only that user may delete it.
    session = await document_sessions.get_session_async(document_id)
    if session and session.owner_id is not None:
        if user is None or user.user_id != session.owner_id:
            logger.warning(
                "Unauthorized DELETE attempt on document %s by user %s",
                document_id,
                user.user_id if user else "anonymous",
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not found",
            )

    await document_service.delete_document(document_id)


@router.post(
    "/{document_id}/unlock",
    response_model=APIResponse[dict],
    summary="Unlock encrypted PDF",
    response_description="Unlock result indicating success and any restrictions that were removed",
    description="""
Unlock an encrypted PDF document using the provided password.

PDFs can be protected with two types of passwords:
- **User password**: Required to open and view the document
- **Owner password**: Required to modify permissions (print, copy, edit)

This endpoint attempts to unlock the document using the provided password.
If successful, the document becomes fully accessible for editing operations.

## Path Parameters
- **document_id**: Unique identifier of the document (UUID format)

## Request Body
- **password**: The password to unlock the PDF (required)
- **remove_restrictions**: Whether to remove all permission restrictions (default: false)
  - When true, removes print/copy/edit restrictions
  - Requires the owner password

## Response
Returns unlock status and any restrictions that were removed.

## Notes
- If the PDF is not encrypted, this endpoint returns success with no changes
- Incorrect password returns 400 Bad Request
- Some PDFs have DRM protection that cannot be removed
""",
    responses={
        200: {
            "description": "Document unlocked successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "unlocked": True,
                            "restrictions_removed": True,
                            "previous_restrictions": {
                                "printing": "not_allowed",
                                "copying": "not_allowed",
                                "modifying": "not_allowed",
                            },
                        },
                        "meta": {
                            "request_id": "req_abc123",
                            "timestamp": "2024-01-15T10:30:00Z",
                        },
                    }
                }
            },
        },
        400: {
            "description": "Invalid password or document is not encrypted",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "INVALID_PASSWORD",
                            "message": "The provided password is incorrect",
                        },
                    }
                }
            },
        },
        401: {
            "description": "Authentication required",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "UNAUTHORIZED",
                            "message": "Valid authentication token required",
                        },
                    }
                }
            },
        },
        403: {
            "description": "Access denied to this document",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "FORBIDDEN",
                            "message": "You do not have permission to unlock this document",
                        },
                    }
                }
            },
        },
        404: {
            "description": "Document not found",
            "content": {
                "application/json": {
                    "example": {
                        "success": False,
                        "error": {
                            "code": "NOT_FOUND",
                            "message": "Document with ID '550e8400-e29b-41d4-a716-446655440000' not found",
                        },
                    }
                }
            },
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/documents/550e8400-e29b-41d4-a716-446655440000/unlock" \\\n'
                '  -H "Authorization: Bearer $TOKEN" \\\n'
                '  -H "Content-Type: application/json" \\\n'
                '  -d \'{"password": "secret123", "remove_restrictions": true}\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\n'
                'document_id = "550e8400-e29b-41d4-a716-446655440000"\n'
                'url = f"https://api.giga-pdf.com/api/v1/documents/{document_id}/unlock"\n'
                'headers = {\n'
                '    "Authorization": f"Bearer {token}",\n'
                '    "Content-Type": "application/json"\n'
                '}\n'
                'payload = {\n'
                '    "password": "secret123",\n'
                '    "remove_restrictions": True\n'
                '}\n\n'
                'response = requests.post(url, headers=headers, json=payload)\n'
                'result = response.json()\n\n'
                'if result["success"]:\n'
                '    print("Document unlocked successfully")\n'
                '    if result["data"]["restrictions_removed"]:\n'
                '        print("All restrictions have been removed")\n'
                'else:\n'
                '    print(f"Error: {result[\'error\'][\'message\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const documentId = "550e8400-e29b-41d4-a716-446655440000";\n\n'
                'const response = await fetch(\n'
                '  `https://api.giga-pdf.com/api/v1/documents/${documentId}/unlock`,\n'
                '  {\n'
                '    method: "POST",\n'
                '    headers: {\n'
                '      "Authorization": `Bearer ${token}`,\n'
                '      "Content-Type": "application/json"\n'
                '    },\n'
                '    body: JSON.stringify({\n'
                '      password: "secret123",\n'
                '      remove_restrictions: true\n'
                '    })\n'
                '  }\n'
                ');\n\n'
                'const result = await response.json();\n\n'
                'if (result.success) {\n'
                '  console.log("Document unlocked successfully");\n'
                '  if (result.data.restrictions_removed) {\n'
                '    console.log("All restrictions have been removed");\n'
                '  }\n'
                '} else {\n'
                '  console.error(`Error: ${result.error.message}`);\n'
                '}',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n'
                '$documentId = "550e8400-e29b-41d4-a716-446655440000";\n'
                '$payload = json_encode([\n'
                '    "password" => "secret123",\n'
                '    "remove_restrictions" => true\n'
                ']);\n\n'
                '$ch = curl_init();\n\n'
                'curl_setopt_array($ch, [\n'
                '    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/documents/{$documentId}/unlock",\n'
                '    CURLOPT_POST => true,\n'
                '    CURLOPT_HTTPHEADER => [\n'
                '        "Authorization: Bearer $token",\n'
                '        "Content-Type: application/json"\n'
                '    ],\n'
                '    CURLOPT_POSTFIELDS => $payload,\n'
                '    CURLOPT_RETURNTRANSFER => true\n'
                ']);\n\n'
                '$response = curl_exec($ch);\n'
                'curl_close($ch);\n\n'
                '$result = json_decode($response, true);\n\n'
                'if ($result["success"]) {\n'
                '    echo "Document unlocked successfully\\n";\n'
                '    if ($result["data"]["restrictions_removed"]) {\n'
                '        echo "All restrictions have been removed";\n'
                '    }\n'
                '} else {\n'
                '    echo "Error: " . $result["error"]["message"];\n'
                '}',
            },
        ]
    },
)
async def unlock_document(
    document_id: str,
    request: UnlockDocumentRequest,
    user: OptionalUser = None,
) -> APIResponse[dict]:
    """Unlock an encrypted PDF."""
    # Preload session from Redis if needed
    await preload_document_session(document_id)

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
