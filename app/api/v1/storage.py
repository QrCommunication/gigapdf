"""
Persistent storage endpoints.

Handles saving, loading, versioning, and organizing documents in persistent storage.
"""

import asyncio
import hashlib
import io
import json
import logging
import time
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, get_db_session
from app.middleware.auth import AuthenticatedUser
from app.middleware.error_handler import (
    InvalidOperationError,
    NotFoundError,
)
from app.middleware.request_id import get_request_id
from app.models.database import DocumentVersion, Folder, StoredDocument
from app.schemas.responses.common import APIResponse, MetaInfo, PaginationInfo
from app.services.activity_service import ActivityAction, activity_service
from app.services.document_service import document_service
from app.services.quota_service import quota_service
from app.services.s3_service import s3_service
from app.utils.helpers import generate_uuid, now_utc

_logger = logging.getLogger(__name__)

router = APIRouter()


def _count_pdf_pages_sync(pdf_bytes: bytes) -> int:
    """Count PDF pages synchronously via pikepdf (CPU-bound).

    Extracted as a module-level function so it can be safely offloaded
    to a thread pool with asyncio.to_thread() from async handlers,
    preventing the event loop from blocking during PDF parsing.
    """
    import pikepdf  # lazy import — only needed for page counting

    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        return len(pdf.pages)


class CreateFolderRequest(BaseModel):
    """Request to create a folder."""

    name: str = Field(
        description="Folder name",
        min_length=1,
        max_length=255,
    )
    parent_id: str | None = Field(
        default=None,
        description="Parent folder ID (null for root)",
    )


@router.post(
    "/documents",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Save document to storage",
    description="""
Save a PDF document directly to persistent storage via multipart upload.

The frontend sends the rendered PDF bytes (produced by the TypeScript pdf-engine) along
with document metadata as form fields. No active editing session is required.

## Features
- Automatic version tracking (initial version = 1)
- Tag-based organization for searchability
- Folder hierarchy support
- Storage quota enforcement (personal or organization-based)
- PDF magic-bytes validation (`%PDF-`)
- File size limit: 100 MB

## Multipart Form Fields
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | file | Yes | PDF file bytes |
| name | string | Yes | Display name (1-255 characters) |
| folder_id | string | No | Target folder UUID (null for root) |
| tags | string | No | JSON array of tag strings, e.g. `["contract","legal"]` |
| version_comment | string | No | Comment describing this version |
""",
    responses={
        201: {
            "description": "Document saved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "name": "Contract Agreement 2024",
                            "page_count": 15,
                            "version": 1,
                            "created_at": "2024-01-15T10:30:00Z",
                            "quota_source": "personal"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {"description": "Invalid request or storage quota exceeded"},
        404: {"description": "Document or folder not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/storage/documents" \\
  -H "Authorization: Bearer $TOKEN" \\
  -F "file=@document.pdf;type=application/pdf" \\
  -F "name=Contract Agreement 2024" \\
  -F "folder_id=660e8400-e29b-41d4-a716-446655440001" \\
  -F 'tags=["contract","legal","2024"]' \\
  -F "version_comment=Initial version" '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests, json

with open("document.pdf", "rb") as f:
    response = requests.post(
        "https://api.giga-pdf.com/api/v1/storage/documents",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("document.pdf", f, "application/pdf")},
        data={
            "name": "Contract Agreement 2024",
            "folder_id": folder_id,
            "tags": json.dumps(["contract", "legal", "2024"]),
            "version_comment": "Initial version",
        },
    )

stored_doc = response.json()["data"]
print(f"Saved as: {stored_doc['stored_document_id']}")
print(f"Version: {stored_doc['version']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const formData = new FormData();
formData.append("file", pdfBlob, "document.pdf");
formData.append("name", "Contract Agreement 2024");
formData.append("folder_id", folderId);
formData.append("tags", JSON.stringify(["contract", "legal", "2024"]));
formData.append("version_comment", "Initial version");

const response = await fetch("https://api.giga-pdf.com/api/v1/storage/documents", {
  method: "POST",
  headers: { "Authorization": `Bearer ${token}` },
  body: formData,
});

const { data: storedDoc } = await response.json();
console.log(`Saved as: ${storedDoc.stored_document_id}`);
console.log(`Version: ${storedDoc.version}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();
$response = $client->post("https://api.giga-pdf.com/api/v1/storage/documents", [
    "headers" => ["Authorization" => "Bearer " . $token],
    "multipart" => [
        ["name" => "file", "contents" => fopen("document.pdf", "r"), "filename" => "document.pdf"],
        ["name" => "name", "contents" => "Contract Agreement 2024"],
        ["name" => "folder_id", "contents" => $folderId],
        ["name" => "tags", "contents" => json_encode(["contract", "legal", "2024"])],
        ["name" => "version_comment", "contents" => "Initial version"],
    ],
]);

$storedDoc = json_decode($response->getBody(), true)["data"];
echo "Saved as: " . $storedDoc["stored_document_id"] . "\\n";
echo "Version: " . $storedDoc["version"] . "\\n";'''
            }
        ]
    },
)
async def save_document(
    user: AuthenticatedUser,
    file: UploadFile = File(..., description="PDF file bytes"),
    name: str = Form(..., min_length=1, max_length=255, description="Display name for the document"),
    folder_id: str | None = Form(default=None, description="Folder UUID (null for root)"),
    tags: str | None = Form(default=None, description='JSON array of tags, e.g. ["contract","legal"]'),
    version_comment: str | None = Form(default=None, description="Comment describing this version"),
) -> APIResponse[dict]:
    """Save a PDF document to persistent storage.

    The frontend sends the rendered PDF bytes (produced by the TypeScript pdf-engine)
    directly as a multipart upload — no active editing session is required.

    Atomicity guarantee (Saga pattern):
      1. Validate PDF bytes (magic bytes + size) + quota.
      2. Commit DB records (StoredDocument + DocumentVersion) first.
      3. Upload to S3 after successful commit.
      4. If S3 upload fails after commit → delete the orphan S3 key (compensation)
         and re-raise so the caller gets a clean error.
         The DB records remain; a reconciliation job can clean them up or
         the next save attempt will reuse/overwrite the same s3_key.
    """
    start_time = time.time()

    # IMPORTANT: ne pas mettre "name" dans extra={} — c'est un attribut
    # réservé de logging.LogRecord. Le passer cause :
    #   KeyError: "Attempt to overwrite 'name' in LogRecord"
    # qui transforme un upload OK en HTTP 500 silencieux. Renommer en
    # "document_name" pour préserver l'info sans collision.
    _logger.info(
        "save_document: starting save",
        extra={"document_name": name, "user_id": user.user_id},
    )

    # ── 1. Read + validate PDF bytes ────────────────────────────────────
    pdf_bytes = await file.read()
    file_size = len(pdf_bytes)

    _FILE_SIZE_LIMIT = 100 * 1024 * 1024  # 100 MB
    if file_size > _FILE_SIZE_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"File too large: {file_size} bytes (limit: {_FILE_SIZE_LIMIT} bytes)",
        )

    if not pdf_bytes.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Invalid PDF format: missing %PDF- header")

    file_hash = hashlib.sha256(pdf_bytes).hexdigest()
    _logger.debug("save_document: received %d bytes (sha256=%s)", file_size, file_hash[:16])

    # ── 2. Count pages via pikepdf (offloaded — CPU-bound, not async-safe) ─
    try:
        page_count = await asyncio.to_thread(_count_pdf_pages_sync, pdf_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot read PDF structure: {exc}") from exc

    # ── 3. Parse tags (JSON array string → list[str]) ────────────────────
    parsed_tags: list[str] = []
    if tags:
        try:
            parsed_tags = json.loads(tags)
            if not isinstance(parsed_tags, list):
                raise ValueError("tags must be a JSON array")
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid tags format: {exc}") from exc

    # ── 4. Quota check ──────────────────────────────────────────────────
    effective_limits = await quota_service.get_effective_limits(user.user_id)

    if effective_limits.storage_used_bytes + file_size > effective_limits.storage_limit_bytes:
        raise InvalidOperationError(
            f"Storage quota exceeded. Used: {effective_limits.storage_used_bytes}, "
            f"Limit: {effective_limits.storage_limit_bytes}"
        )

    if effective_limits.document_limit != -1 and effective_limits.document_count >= effective_limits.document_limit:
        raise InvalidOperationError(
            f"Document limit exceeded. Limit: {effective_limits.document_limit}"
        )

    # ── 5. Derive IDs before DB commit so S3 key is deterministic ───────
    stored_doc_id = generate_uuid()
    s3_key = s3_service.get_document_key(user.user_id, stored_doc_id, 1)

    # ── 6. Commit DB records first (rollback-safe) ───────────────────────
    # If anything inside the `async with` block raises, SQLAlchemy rolls
    # back automatically — no S3 side-effect has happened yet.
    async with get_db_session() as session:
        stored_doc = StoredDocument(
            id=stored_doc_id,
            name=name,
            owner_id=user.user_id,
            folder_id=folder_id,
            page_count=page_count,
            current_version=1,
            file_size_bytes=file_size,
            tags=parsed_tags,
        )
        session.add(stored_doc)

        version = DocumentVersion(
            document_id=stored_doc_id,
            version_number=1,
            file_path=s3_key,
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment=version_comment,
            created_by=user.user_id,
        )
        session.add(version)
        # session commits on __aexit__ — DB is durable at this point

    _logger.info("save_document: DB committed (stored_doc_id=%s)", stored_doc_id)

    # ── 7. Upload to S3 after DB commit (compensation on failure) ────────
    try:
        s3_service.upload_file(
            file_data=pdf_bytes,
            key=s3_key,
            content_type="application/pdf",
            metadata={
                "document_id": stored_doc_id,
                "user_id": user.user_id,
                "version": "1",
                "name": name,
            },
        )
        _logger.info("save_document: S3 upload OK (key=%s)", s3_key)
    except Exception as exc:
        # Compensation: the DB row references this s3_key but the file is
        # absent. Attempt a best-effort delete of any partial upload, then
        # surface the error. The DB rows are left in place; the orphan-gc
        # Celery task will reconcile them.
        _logger.error(
            "save_document: S3 upload failed after DB commit — "
            "compensation: deleting partial s3_key=%s (doc=%s)",
            s3_key,
            stored_doc_id,
            exc_info=True,
        )
        s3_service.delete_file(s3_key)  # best-effort; ignore return value

        raise InvalidOperationError(
            f"Document saved to database but file upload failed: {exc}"
        ) from exc

    # ── 8. Update quota counters ─────────────────────────────────────────
    if effective_limits.is_tenant_based and effective_limits.tenant_id:
        await quota_service.update_tenant_storage(
            effective_limits.tenant_id, file_size, delta_documents=1
        )
    else:
        await quota_service.update_storage_usage(
            user.user_id, file_size, delta_documents=1
        )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_doc_id,
            "name": name,
            "page_count": page_count,
            "version": 1,
            "created_at": stored_doc.created_at.isoformat(),
            "quota_source": "tenant" if effective_limits.is_tenant_based else "personal",
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/documents",
    response_model=APIResponse[dict],
    summary="List stored documents",
    description="""
List all documents in persistent storage for the authenticated user.

This endpoint provides paginated access to stored documents with powerful filtering and search capabilities.

## Query Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | integer | 1 | Page number (1-based) |
| per_page | integer | 20 | Items per page (1-100) |
| folder_id | string | null | Filter by folder UUID, empty string for root |
| search | string | null | Search in document names |
| tags | string | null | Filter by tags (comma-separated) |

## Response Structure
- **items**: Array of document objects
- **pagination**: Pagination metadata (total, page, per_page, total_pages)
""",
    responses={
        200: {
            "description": "Documents retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "items": [
                                {
                                    "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                                    "name": "Contract Agreement 2024",
                                    "page_count": 15,
                                    "version": 2,
                                    "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                                    "tags": ["contract", "legal"],
                                    "file_size_bytes": 1048576,
                                    "created_at": "2024-01-15T10:30:00Z",
                                    "modified_at": "2024-01-16T14:20:00Z"
                                }
                            ],
                            "pagination": {
                                "total": 42,
                                "page": 1,
                                "per_page": 20,
                                "total_pages": 3
                            }
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/storage/documents?page=1&per_page=20&search=contract" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

response = requests.get(
    "https://api.giga-pdf.com/api/v1/storage/documents",
    params={
        "page": 1,
        "per_page": 20,
        "search": "contract",
        "tags": "legal,2024"
    },
    headers={"Authorization": f"Bearer {token}"}
)

data = response.json()["data"]
for doc in data["items"]:
    print(f"{doc['name']} - {doc['page_count']} pages")

pagination = data["pagination"]
print(f"Page {pagination['page']} of {pagination['total_pages']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const params = new URLSearchParams({
  page: "1",
  per_page: "20",
  search: "contract",
  tags: "legal,2024"
});

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents?${params}`,
  {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data } = await response.json();
data.items.forEach(doc => {
  console.log(`${doc.name} - ${doc.page_count} pages`);
});
console.log(`Page ${data.pagination.page} of ${data.pagination.total_pages}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();
$response = $client->get("https://api.giga-pdf.com/api/v1/storage/documents", [
    "headers" => ["Authorization" => "Bearer " . $token],
    "query" => [
        "page" => 1,
        "per_page" => 20,
        "search" => "contract",
        "tags" => "legal,2024"
    ]
]);

$data = json_decode($response->getBody(), true)["data"];
foreach ($data["items"] as $doc) {
    echo $doc["name"] . " - " . $doc["page_count"] . " pages\\n";
}
echo "Page " . $data["pagination"]["page"] . " of " . $data["pagination"]["total_pages"] . "\\n";'''
            }
        ]
    },
)
async def list_stored_documents(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    folder_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    tags: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """List stored documents with pagination."""
    start_time = time.time()

    # Build base query
    base_query = select(StoredDocument).where(
        StoredDocument.owner_id == user.user_id,
        ~StoredDocument.is_deleted,
    )

    # Filter by folder
    # - None (not provided): no filter, return all documents
    # - '' (empty string): filter for root-level documents (folder_id IS NULL)
    # - UUID: filter for specific folder
    if folder_id is not None:
        if folder_id == '' or folder_id.lower() == 'null':
            # Empty string or 'null' means filter for root-level documents (no folder)
            base_query = base_query.where(StoredDocument.folder_id.is_(None))
        else:
            # Validate that folder_id is a valid UUID before querying
            try:
                uuid.UUID(folder_id)  # Validate UUID format
                base_query = base_query.where(StoredDocument.folder_id == folder_id)
            except ValueError:
                # Invalid UUID format - treat as root-level filter
                base_query = base_query.where(StoredDocument.folder_id.is_(None))

    # Search by name
    if search:
        base_query = base_query.where(StoredDocument.name.ilike(f"%{search}%"))

    # Filter by tags
    if tags:
        tag_list = [t.strip() for t in tags.split(",")]
        base_query = base_query.where(StoredDocument.tags.op("&&")(tag_list))

    # Get total count
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Order and paginate
    offset = (page - 1) * per_page
    paginated_query = base_query.order_by(StoredDocument.updated_at.desc()).offset(offset).limit(per_page)
    result = await db.execute(paginated_query)
    documents = result.scalars().all()

    # Format results
    items = []
    for doc in documents:
        items.append({
            "stored_document_id": doc.id,
            "name": doc.name,
            "page_count": doc.page_count,
            "version": doc.current_version,
            "folder_id": doc.folder_id,
            "tags": doc.tags or [],
            "file_size_bytes": doc.file_size_bytes or 0,
            "created_at": doc.created_at.isoformat(),
            "modified_at": doc.updated_at.isoformat(),
            "thumbnail_url": doc.thumbnail_path,
        })

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


@router.post(
    "/documents/{stored_document_id}/load",
    response_model=APIResponse[dict],
    summary="Load stored document to session",
    description="""
Load a document from persistent storage into an active editing session.

This endpoint downloads the latest version of a stored document and creates a new editing session. The returned document_id can be used with all document manipulation APIs (annotations, text editing, page operations, etc.).

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document |

## Use Cases
- Resume editing a previously saved document
- Create a working copy of a stored document
- Access document for annotation or modification

## Response
Returns a session document_id that can be used with the Document APIs.
""",
    responses={
        200: {
            "description": "Document loaded successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "880e8400-e29b-41d4-a716-446655440003",
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "name": "Contract Agreement 2024",
                            "page_count": 15
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
        404: {"description": "Stored document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/load" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}/load",
    headers={"Authorization": f"Bearer {token}"}
)

session = response.json()["data"]
document_id = session["document_id"]
print(f"Loaded '{session['name']}' with {session['page_count']} pages")
print(f"Session document ID: {document_id}")

# Now use document_id with Document APIs for editing'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/load`,
  {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data: session } = await response.json();
const documentId = session.document_id;
console.log(`Loaded '${session.name}' with ${session.page_count} pages`);
console.log(`Session document ID: ${documentId}`);

// Now use documentId with Document APIs for editing'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$storedDocId = "770e8400-e29b-41d4-a716-446655440002";
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$storedDocId}/load",
    ["headers" => ["Authorization" => "Bearer " . $token]]
);

$session = json_decode($response->getBody(), true)["data"];
$documentId = $session["document_id"];
echo "Loaded '" . $session["name"] . "' with " . $session["page_count"] . " pages\\n";
echo "Session document ID: " . $documentId . "\\n";

// Now use $documentId with Document APIs for editing'''
            }
        ]
    },
)
async def load_stored_document(
    stored_document_id: str,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Load stored document to session."""
    start_time = time.time()

    # Get stored document
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
            ~StoredDocument.is_deleted,
        )
    )
    stored_doc = result.scalar_one_or_none()

    if not stored_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    # Download from S3
    s3_key = s3_service.get_document_key(
        user.user_id, stored_document_id, stored_doc.current_version
    )

    try:
        file_data = s3_service.download_file(s3_key)
    except Exception as e:
        raise NotFoundError(f"Document file not found in storage: {str(e)}")

    # Upload to session
    document_id, document = await document_service.upload_document(
        file_data=file_data,
        filename=f"{stored_doc.name}.pdf",
        owner_id=user.user_id,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": document_id,
            "stored_document_id": stored_document_id,
            "name": stored_doc.name,
            "page_count": document.metadata.page_count,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/documents/{stored_document_id}/versions",
    response_model=APIResponse[dict],
    summary="List document versions",
    description="""
List all versions of a stored document with their metadata.

Every time a document is saved to storage, a new version is created. This endpoint returns the complete version history, allowing you to track changes over time and restore previous versions.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document |

## Response Structure
- **stored_document_id**: The document's unique identifier
- **current_version**: The latest version number
- **versions**: Array of version objects (newest first)
  - version: Version number
  - created_at: ISO 8601 timestamp
  - created_by: User ID who created this version
  - comment: Optional version comment
  - size_bytes: File size of this version
""",
    responses={
        200: {
            "description": "Versions retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "current_version": 3,
                            "versions": [
                                {
                                    "version": 3,
                                    "created_at": "2024-01-17T09:15:00Z",
                                    "created_by": "user-uuid",
                                    "comment": "Final review changes",
                                    "size_bytes": 1150000
                                },
                                {
                                    "version": 2,
                                    "created_at": "2024-01-16T14:20:00Z",
                                    "created_by": "user-uuid",
                                    "comment": "Updated terms on page 5",
                                    "size_bytes": 1120000
                                },
                                {
                                    "version": 1,
                                    "created_at": "2024-01-15T10:30:00Z",
                                    "created_by": "user-uuid",
                                    "comment": "Initial version",
                                    "size_bytes": 1048576
                                }
                            ]
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
        404: {"description": "Stored document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/versions" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}/versions",
    headers={"Authorization": f"Bearer {token}"}
)

data = response.json()["data"]
print(f"Current version: {data['current_version']}")

for version in data["versions"]:
    print(f"v{version['version']}: {version['comment']} ({version['size_bytes']} bytes)")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/versions`,
  {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data } = await response.json();
console.log(`Current version: ${data.current_version}`);

data.versions.forEach(version => {
  console.log(`v${version.version}: ${version.comment} (${version.size_bytes} bytes)`);
});'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$storedDocId = "770e8400-e29b-41d4-a716-446655440002";
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$storedDocId}/versions",
    ["headers" => ["Authorization" => "Bearer " . $token]]
);

$data = json_decode($response->getBody(), true)["data"];
echo "Current version: " . $data["current_version"] . "\\n";

foreach ($data["versions"] as $version) {
    echo "v" . $version["version"] . ": " . $version["comment"] . " (" . $version["size_bytes"] . " bytes)\\n";
}'''
            }
        ]
    },
)
async def list_versions(
    stored_document_id: str,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """List document versions."""
    start_time = time.time()

    # Verify ownership
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
        )
    )
    stored_doc = result.scalar_one_or_none()

    if not stored_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    # Get versions
    versions_result = await db.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_id == stored_document_id
        ).order_by(DocumentVersion.version_number.desc())
    )
    versions = versions_result.scalars().all()

    version_list = []
    for v in versions:
        version_list.append({
            "version": v.version_number,
            "created_at": v.created_at.isoformat(),
            "created_by": v.created_by,
            "comment": v.comment,
            "size_bytes": v.file_size_bytes,
        })

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "current_version": stored_doc.current_version,
            "versions": version_list,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/documents/{stored_document_id}/versions",
    response_model=APIResponse[dict],
    summary="Create new version",
    description="""
Create a new version of a stored document via multipart PDF upload.

The frontend sends the rendered PDF bytes (produced by the TypeScript pdf-engine) directly,
without requiring an active editing session. Previous versions are preserved, allowing for
version history tracking and rollback capabilities.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document to update |

## Multipart Form Fields
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | file | Yes | PDF file bytes |
| comment | string | No | Description of changes in this version |

## Use Cases
- Save incremental changes while editing
- Create checkpoints before major modifications
- Track document evolution with descriptive comments

## File Constraints
- Maximum size: 100 MB
- Must be a valid PDF (starts with `%PDF-`)
""",
    responses={
        201: {
            "description": "Version created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "version": 4,
                            "created_at": "2024-01-18T11:45:00Z"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T11:45:00Z"}
                    }
                }
            }
        },
        404: {"description": "Stored document or session document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/versions" \\
  -H "Authorization: Bearer $TOKEN" \\
  -F "file=@document.pdf;type=application/pdf" \\
  -F "comment=Updated legal terms on page 5" '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
with open("document.pdf", "rb") as f:
    response = requests.post(
        f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}/versions",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("document.pdf", f, "application/pdf")},
        data={"comment": "Updated legal terms on page 5"},
    )

new_version = response.json()["data"]
print(f"Created version {new_version['version']}")
print(f"Saved at: {new_version['created_at']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";

const formData = new FormData();
formData.append("file", pdfBlob, "document.pdf");
formData.append("comment", "Updated legal terms on page 5");

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/versions`,
  {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: formData,
  }
);

const { data: newVersion } = await response.json();
console.log(`Created version ${newVersion.version}`);
console.log(`Saved at: ${newVersion.created_at}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$storedDocId = "770e8400-e29b-41d4-a716-446655440002";
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$storedDocId}/versions",
    [
        "headers" => ["Authorization" => "Bearer " . $token],
        "multipart" => [
            ["name" => "file", "contents" => fopen("document.pdf", "r"), "filename" => "document.pdf"],
            ["name" => "comment", "contents" => "Updated legal terms on page 5"],
        ],
    ]
);

$newVersion = json_decode($response->getBody(), true)["data"];
echo "Created version " . $newVersion["version"] . "\\n";
echo "Saved at: " . $newVersion["created_at"] . "\\n";'''
            }
        ]
    },
)
async def create_version(
    stored_document_id: str,
    user: AuthenticatedUser,
    file: UploadFile = File(..., description="PDF file bytes"),
    comment: str | None = Form(default=None, description="Description of changes in this version"),
) -> APIResponse[dict]:
    """Create a new version of a stored document via multipart PDF upload.

    The frontend sends the rendered PDF bytes directly — no active editing session required.

    Atomicity guarantee (Saga pattern):
      1. Validate PDF bytes (magic bytes + size) + verify DB ownership.
      2. Commit new DocumentVersion + updated StoredDocument to DB first.
      3. Upload new version to S3 after successful commit.
      4. If S3 upload fails → compensate by deleting the partial upload
         and rolling back current_version in a separate DB transaction,
         then re-raise so the caller gets a clean error.
    """
    start_time = time.time()

    # ── 1. Read + validate PDF bytes ────────────────────────────────────
    doc_bytes = await file.read()
    file_size = len(doc_bytes)

    _FILE_SIZE_LIMIT = 100 * 1024 * 1024  # 100 MB
    if file_size > _FILE_SIZE_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"File too large: {file_size} bytes (limit: {_FILE_SIZE_LIMIT} bytes)",
        )

    if not doc_bytes.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Invalid PDF format: missing %PDF- header")

    file_hash = hashlib.sha256(doc_bytes).hexdigest()
    _logger.debug("create_version: received %d bytes (sha256=%s)", file_size, file_hash[:16])

    # ── 2. Count pages via pikepdf (offloaded — CPU-bound, not async-safe) ─
    try:
        page_count = await asyncio.to_thread(_count_pdf_pages_sync, doc_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot read PDF structure: {exc}") from exc

    # ── 3. Commit DB records first ───────────────────────────────────────
    new_version_number: int
    s3_key: str

    async with get_db_session() as session:
        result = await session.execute(
            select(StoredDocument).where(
                StoredDocument.id == stored_document_id,
                StoredDocument.owner_id == user.user_id,
            )
        )
        stored_doc = result.scalar_one_or_none()

        if not stored_doc:
            raise NotFoundError(f"Stored document not found: {stored_document_id}")

        new_version_number = stored_doc.current_version + 1
        s3_key = s3_service.get_document_key(user.user_id, stored_document_id, new_version_number)

        version = DocumentVersion(
            document_id=stored_document_id,
            version_number=new_version_number,
            file_path=s3_key,
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment=comment,
            created_by=user.user_id,
        )
        session.add(version)

        stored_doc.current_version = new_version_number
        stored_doc.page_count = page_count
        stored_doc.file_size_bytes = file_size
        # session commits on __aexit__ — version row + updated StoredDocument are durable

    _logger.info(
        "create_version: DB committed (stored_doc_id=%s, version=%d)",
        stored_document_id,
        new_version_number,
    )

    # ── 4. Upload to S3 after DB commit (compensation on failure) ────────
    try:
        s3_service.upload_file(
            file_data=doc_bytes,
            key=s3_key,
            content_type="application/pdf",
            metadata={
                "document_id": stored_document_id,
                "user_id": user.user_id,
                "version": str(new_version_number),
            },
        )
        _logger.info(
            "create_version: S3 upload OK (key=%s)", s3_key
        )
    except Exception as exc:
        # Compensation: revert current_version in DB and delete any partial upload.
        _logger.error(
            "create_version: S3 upload failed after DB commit — "
            "compensation: reverting version to %d, deleting s3_key=%s",
            new_version_number - 1,
            s3_key,
            exc_info=True,
        )
        s3_service.delete_file(s3_key)  # best-effort; ignore return value

        # Revert DB: roll back version bump and delete orphan DocumentVersion row.
        try:
            async with get_db_session() as rollback_session:
                result = await rollback_session.execute(
                    select(StoredDocument).where(
                        StoredDocument.id == stored_document_id,
                    )
                )
                stored_doc_rb = result.scalar_one_or_none()
                if stored_doc_rb:
                    stored_doc_rb.current_version = new_version_number - 1

                ver_result = await rollback_session.execute(
                    select(DocumentVersion).where(
                        DocumentVersion.document_id == stored_document_id,
                        DocumentVersion.version_number == new_version_number,
                    )
                )
                orphan_version = ver_result.scalar_one_or_none()
                if orphan_version:
                    await rollback_session.delete(orphan_version)
        except Exception as rb_exc:
            _logger.error(
                "create_version: compensation DB rollback also failed: %s", rb_exc
            )

        raise InvalidOperationError(
            f"Version {new_version_number} committed to database but file upload failed: {exc}"
        ) from exc

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "version": new_version_number,
            "created_at": version.created_at.isoformat(),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


class RenameDocumentRequest(BaseModel):
    """Request to rename a document."""

    name: str = Field(
        description="New name for the document",
        min_length=1,
        max_length=255,
    )


@router.patch(
    "/documents/{stored_document_id}",
    response_model=APIResponse[dict],
    summary="Rename stored document",
    description="""
Rename a document in persistent storage.

This endpoint updates the display name of a stored document. The rename operation is logged in the activity history for audit purposes.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document to rename |

## Request Body
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | New display name (1-255 characters) |

## Notes
- Renaming does not affect version history
- The rename is recorded in the activity log
""",
    responses={
        200: {
            "description": "Document renamed successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "name": "Updated Contract 2024",
                            "updated_at": "2024-01-18T12:00:00Z"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T12:00:00Z"}
                    }
                }
            }
        },
        404: {"description": "Stored document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Updated Contract 2024"}'  '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}",
    headers={"Authorization": f"Bearer {token}"},
    json={"name": "Updated Contract 2024"}
)

renamed = response.json()["data"]
print(f"Document renamed to: {renamed['name']}")
print(f"Updated at: {renamed['updated_at']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}`,
  {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Updated Contract 2024" })
  }
);

const { data: renamed } = await response.json();
console.log(`Document renamed to: ${renamed.name}`);
console.log(`Updated at: ${renamed.updated_at}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$storedDocId = "770e8400-e29b-41d4-a716-446655440002";
$client = new GuzzleHttp\\Client();
$response = $client->patch(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$storedDocId}",
    [
        "headers" => [
            "Authorization" => "Bearer " . $token,
            "Content-Type" => "application/json"
        ],
        "json" => ["name" => "Updated Contract 2024"]
    ]
);

$renamed = json_decode($response->getBody(), true)["data"];
echo "Document renamed to: " . $renamed["name"] . "\\n";
echo "Updated at: " . $renamed["updated_at"] . "\\n";'''
            }
        ]
    },
)
async def rename_stored_document(
    stored_document_id: str,
    request: RenameDocumentRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Rename stored document."""
    start_time = time.time()

    # Get stored document
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
            ~StoredDocument.is_deleted,
        )
    )
    stored_doc = result.scalar_one_or_none()

    if not stored_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    # Store old name for activity log
    old_name = stored_doc.name

    # Update name
    stored_doc.name = request.name
    stored_doc.updated_at = now_utc()
    await db.commit()

    # Log the rename activity
    await activity_service.log_activity(
        user_id=user.user_id,
        action=ActivityAction.RENAME,
        document_id=stored_document_id,
        user_email=user.email,
        extra_data={"old_name": old_name, "new_name": request.name},
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "name": request.name,
            "updated_at": stored_doc.updated_at.isoformat(),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.delete(
    "/documents/{stored_document_id}",
    response_model=APIResponse[dict],
    summary="Delete stored document",
    description="""
Delete a document from persistent storage using soft delete.

This endpoint performs a soft delete, marking the document as deleted without physically removing it from storage. This allows for potential recovery and maintains audit trails.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document to delete |

## Behavior
- Document is marked as deleted with timestamp
- Storage quota is immediately updated (freed space)
- Activity is logged for audit purposes
- All versions are preserved (soft deleted)

## Notes
- Quota is adjusted based on source (personal or organization)
- Deleted documents are not returned in list queries
""",
    responses={
        200: {
            "description": "Document deleted successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "deleted": True,
                            "quota_source": "personal"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T12:30:00Z"}
                    }
                }
            }
        },
        404: {"description": "Stored document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X DELETE "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
response = requests.delete(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}",
    headers={"Authorization": f"Bearer {token}"}
)

result = response.json()["data"]
if result["deleted"]:
    print(f"Document {stored_doc_id} deleted")
    print(f"Quota source: {result['quota_source']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}`,
  {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data: result } = await response.json();
if (result.deleted) {
  console.log(`Document ${storedDocId} deleted`);
  console.log(`Quota source: ${result.quota_source}`);
}'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$storedDocId = "770e8400-e29b-41d4-a716-446655440002";
$client = new GuzzleHttp\\Client();
$response = $client->delete(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$storedDocId}",
    ["headers" => ["Authorization" => "Bearer " . $token]]
);

$result = json_decode($response->getBody(), true)["data"];
if ($result["deleted"]) {
    echo "Document " . $storedDocId . " deleted\\n";
    echo "Quota source: " . $result["quota_source"] . "\\n";
}'''
            }
        ]
    },
)
async def delete_stored_document(
    stored_document_id: str,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Delete stored document (soft delete)."""
    start_time = time.time()
    _logger.info(f"Deleting document {stored_document_id} for user {user.user_id}")

    try:
        # Get effective limits to determine quota source (tenant or personal)
        effective_limits = await quota_service.get_effective_limits(user.user_id)
    except Exception as e:
        _logger.error(f"Error getting effective limits: {e}", exc_info=True)
        raise

    # Get stored document
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
            ~StoredDocument.is_deleted,
        )
    )
    stored_doc = result.scalar_one_or_none()

    if not stored_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    file_size = stored_doc.file_size_bytes or 0

    # Soft delete
    stored_doc.is_deleted = True
    stored_doc.deleted_at = now_utc()
    await db.commit()

    # Update quota (tenant or personal based on membership) - only if file_size > 0
    if file_size > 0:
        if effective_limits.is_tenant_based and effective_limits.tenant_id:
            await quota_service.update_tenant_storage(
                effective_limits.tenant_id, -file_size, delta_documents=-1
            )
        else:
            await quota_service.update_storage_usage(
                user.user_id, -file_size, delta_documents=-1
            )

    # Log the delete activity
    await activity_service.log_activity(
        user_id=user.user_id,
        action=ActivityAction.DELETE,
        document_id=stored_document_id,
        user_email=user.email,
        extra_data={"file_size_bytes": file_size},
        tenant_id=effective_limits.tenant_id if effective_limits.is_tenant_based else None,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "deleted": True,
            "quota_source": "tenant" if effective_limits.is_tenant_based else "personal",
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/folders",
    response_model=APIResponse[dict],
    summary="List folders",
    description="""
List all folders for the authenticated user.

Returns a flat list of all folders with parent_id relationships that can be used to build a tree structure. Folders are ordered by path for easier hierarchical display.

## Response Structure
- **folders**: Array of folder objects
  - folder_id: Unique folder identifier
  - name: Folder display name
  - parent_id: Parent folder UUID (null for root folders)
  - path: Full path string for hierarchy
  - created_at: ISO 8601 creation timestamp

## Building a Folder Tree
Use parent_id relationships to construct the folder hierarchy. Root folders have parent_id = null.
""",
    responses={
        200: {
            "description": "Folders retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folders": [
                                {
                                    "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                                    "name": "Legal Documents",
                                    "parent_id": None,
                                    "path": "/",
                                    "created_at": "2024-01-10T08:00:00Z"
                                },
                                {
                                    "folder_id": "660e8400-e29b-41d4-a716-446655440002",
                                    "name": "Contracts",
                                    "parent_id": "660e8400-e29b-41d4-a716-446655440001",
                                    "path": "/660e8400-e29b-41d4-a716-446655440001/",
                                    "created_at": "2024-01-10T08:15:00Z"
                                }
                            ]
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/storage/folders" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

response = requests.get(
    "https://api.giga-pdf.com/api/v1/storage/folders",
    headers={"Authorization": f"Bearer {token}"}
)

folders = response.json()["data"]["folders"]

# Build folder tree
root_folders = [f for f in folders if f["parent_id"] is None]
for folder in root_folders:
    print(f"/{folder['name']}")
    children = [f for f in folders if f["parent_id"] == folder["folder_id"]]
    for child in children:
        print(f"  /{child['name']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const response = await fetch("https://api.giga-pdf.com/api/v1/storage/folders", {
  method: "GET",
  headers: { "Authorization": `Bearer ${token}` }
});

const { data: { folders } } = await response.json();

// Build folder tree
const rootFolders = folders.filter(f => f.parent_id === null);
rootFolders.forEach(folder => {
  console.log(`/${folder.name}`);
  const children = folders.filter(f => f.parent_id === folder.folder_id);
  children.forEach(child => {
    console.log(`  /${child.name}`);
  });
});'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();
$response = $client->get("https://api.giga-pdf.com/api/v1/storage/folders", [
    "headers" => ["Authorization" => "Bearer " . $token]
]);

$folders = json_decode($response->getBody(), true)["data"]["folders"];

// Build folder tree
$rootFolders = array_filter($folders, fn($f) => $f["parent_id"] === null);
foreach ($rootFolders as $folder) {
    echo "/" . $folder["name"] . "\\n";
    $children = array_filter($folders, fn($f) => $f["parent_id"] === $folder["folder_id"]);
    foreach ($children as $child) {
        echo "  /" . $child["name"] . "\\n";
    }
}'''
            }
        ]
    },
)
async def list_folders(
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """List user folders."""
    start_time = time.time()

    result = await db.execute(
        select(Folder).where(
            Folder.owner_id == user.user_id
        ).order_by(Folder.path)
    )
    folders = result.scalars().all()

    folder_list = []
    for folder in folders:
        folder_list.append({
            "folder_id": folder.id,
            "name": folder.name,
            "parent_id": folder.parent_id,
            "path": folder.path,
            "created_at": folder.created_at.isoformat(),
        })

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"folders": folder_list},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/folders",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create folder",
    description="""
Create a new folder for organizing documents.

Folders can be nested to create a hierarchical structure. The path is automatically calculated based on the parent folder.

## Request Body
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Folder name (1-255 characters) |
| parent_id | string | No | Parent folder UUID (null for root) |

## Path Calculation
- Root folders have path = "/"
- Nested folders have path = "{parent_path}{parent_id}/"
""",
    responses={
        201: {
            "description": "Folder created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folder_id": "660e8400-e29b-41d4-a716-446655440003",
                            "name": "Legal Documents",
                            "parent_id": None,
                            "path": "/",
                            "created_at": "2024-01-18T13:00:00Z"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T13:00:00Z"}
                    }
                }
            }
        },
        404: {"description": "Parent folder not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''# Create root folder
curl -X POST "https://api.giga-pdf.com/api/v1/storage/folders" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Legal Documents"}'

# Create nested folder
curl -X POST "https://api.giga-pdf.com/api/v1/storage/folders" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Contracts", "parent_id": "660e8400-e29b-41d4-a716-446655440001"}' '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

# Create root folder
response = requests.post(
    "https://api.giga-pdf.com/api/v1/storage/folders",
    headers={"Authorization": f"Bearer {token}"},
    json={"name": "Legal Documents"}
)
root_folder = response.json()["data"]
print(f"Created folder: {root_folder['folder_id']}")

# Create nested folder
response = requests.post(
    "https://api.giga-pdf.com/api/v1/storage/folders",
    headers={"Authorization": f"Bearer {token}"},
    json={"name": "Contracts", "parent_id": root_folder["folder_id"]}
)
nested_folder = response.json()["data"]
print(f"Created nested folder: {nested_folder['path']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''// Create root folder
let response = await fetch("https://api.giga-pdf.com/api/v1/storage/folders", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ name: "Legal Documents" })
});
const rootFolder = (await response.json()).data;
console.log(`Created folder: ${rootFolder.folder_id}`);

// Create nested folder
response = await fetch("https://api.giga-pdf.com/api/v1/storage/folders", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ name: "Contracts", parent_id: rootFolder.folder_id })
});
const nestedFolder = (await response.json()).data;
console.log(`Created nested folder: ${nestedFolder.path}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();

// Create root folder
$response = $client->post("https://api.giga-pdf.com/api/v1/storage/folders", [
    "headers" => [
        "Authorization" => "Bearer " . $token,
        "Content-Type" => "application/json"
    ],
    "json" => ["name" => "Legal Documents"]
]);
$rootFolder = json_decode($response->getBody(), true)["data"];
echo "Created folder: " . $rootFolder["folder_id"] . "\\n";

// Create nested folder
$response = $client->post("https://api.giga-pdf.com/api/v1/storage/folders", [
    "headers" => [
        "Authorization" => "Bearer " . $token,
        "Content-Type" => "application/json"
    ],
    "json" => ["name" => "Contracts", "parent_id" => $rootFolder["folder_id"]]
]);
$nestedFolder = json_decode($response->getBody(), true)["data"];
echo "Created nested folder: " . $nestedFolder["path"] . "\\n";'''
            }
        ]
    },
)
async def create_folder(
    request: CreateFolderRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Create a new folder."""
    start_time = time.time()

    # Calculate path
    if request.parent_id:
        result = await db.execute(
            select(Folder).where(
                Folder.id == request.parent_id,
                Folder.owner_id == user.user_id,
            )
        )
        parent = result.scalar_one_or_none()
        if not parent:
            raise NotFoundError(f"Parent folder not found: {request.parent_id}")
        path = f"{parent.path}{parent.id}/"
    else:
        path = "/"

    # Create folder
    folder_id = generate_uuid()
    created_at = now_utc()
    folder = Folder(
        id=folder_id,
        name=request.name,
        owner_id=user.user_id,
        parent_id=request.parent_id,
        path=path,
        created_at=created_at,
    )
    db.add(folder)
    await db.commit()

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "folder_id": folder_id,
            "name": request.name,
            "parent_id": request.parent_id,
            "path": path,
            "created_at": created_at.isoformat(),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.delete(
    "/folders/{folder_id}",
    response_model=APIResponse[dict],
    summary="Delete folder",
    description="""
Delete a folder and optionally its contents.

By default, folders containing documents cannot be deleted (returns 400 error). Use the cascade parameter to soft-delete all documents within the folder along with the folder itself.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| folder_id | string | UUID of the folder to delete |

## Query Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| cascade | boolean | false | If true, soft-delete all documents in folder |

## Behavior
- Without cascade: Fails if folder contains documents
- With cascade: Soft-deletes all documents, then deletes folder
- Child folders are also deleted (SQL cascade)
""",
    responses={
        200: {
            "description": "Folder deleted successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                            "deleted": True
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T13:30:00Z"}
                    }
                }
            }
        },
        400: {"description": "Folder not empty (use cascade=true to delete contents)"},
        404: {"description": "Folder not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''# Delete empty folder
curl -X DELETE "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440001" \\
  -H "Authorization: Bearer $TOKEN"

# Delete folder with contents
curl -X DELETE "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440001?cascade=true" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

folder_id = "660e8400-e29b-41d4-a716-446655440001"

# Try to delete folder
response = requests.delete(
    f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}",
    headers={"Authorization": f"Bearer {token}"}
)

if response.status_code == 400:
    # Folder not empty, retry with cascade
    response = requests.delete(
        f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}",
        params={"cascade": True},
        headers={"Authorization": f"Bearer {token}"}
    )

result = response.json()["data"]
print(f"Folder deleted: {result['deleted']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const folderId = "660e8400-e29b-41d4-a716-446655440001";

// Try to delete folder
let response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/folders/${folderId}`,
  {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

if (response.status === 400) {
  // Folder not empty, retry with cascade
  response = await fetch(
    `https://api.giga-pdf.com/api/v1/storage/folders/${folderId}?cascade=true`,
    {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    }
  );
}

const { data: result } = await response.json();
console.log(`Folder deleted: ${result.deleted}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$folderId = "660e8400-e29b-41d4-a716-446655440001";
$client = new GuzzleHttp\\Client();

try {
    // Try to delete folder
    $response = $client->delete(
        "https://api.giga-pdf.com/api/v1/storage/folders/{$folderId}",
        ["headers" => ["Authorization" => "Bearer " . $token]]
    );
} catch (GuzzleHttp\\Exception\\ClientException $e) {
    if ($e->getResponse()->getStatusCode() === 400) {
        // Folder not empty, retry with cascade
        $response = $client->delete(
            "https://api.giga-pdf.com/api/v1/storage/folders/{$folderId}",
            [
                "headers" => ["Authorization" => "Bearer " . $token],
                "query" => ["cascade" => true]
            ]
        );
    }
}

$result = json_decode($response->getBody(), true)["data"];
echo "Folder deleted: " . ($result["deleted"] ? "true" : "false") . "\\n";'''
            }
        ]
    },
)
async def delete_folder(
    folder_id: str,
    user: AuthenticatedUser,
    cascade: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Delete folder."""
    start_time = time.time()

    # Get folder
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id,
            Folder.owner_id == user.user_id,
        )
    )
    folder = result.scalar_one_or_none()

    if not folder:
        raise NotFoundError(f"Folder not found: {folder_id}")

    # Check if folder has documents
    count_result = await db.execute(
        select(func.count()).select_from(StoredDocument).where(
            StoredDocument.folder_id == folder_id,
            ~StoredDocument.is_deleted,
        )
    )
    doc_count = count_result.scalar() or 0

    if doc_count > 0 and not cascade:
        raise InvalidOperationError(
            f"Folder contains {doc_count} documents. Use cascade=true to delete all."
        )

    # Delete documents if cascade
    if cascade:
        docs_result = await db.execute(
            select(StoredDocument).where(
                StoredDocument.folder_id == folder_id
            )
        )
        docs = docs_result.scalars().all()
        for doc in docs:
            doc.is_deleted = True
            doc.deleted_at = now_utc()

    # Delete folder (cascade delete children via SQLAlchemy relationship)
    await db.delete(folder)
    await db.commit()

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "folder_id": folder_id,
            "deleted": True,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


class MoveDocumentRequest(BaseModel):
    """Request to move a document to a folder."""

    folder_id: str | None = Field(
        default=None,
        description="Target folder ID (null for root)",
    )


@router.patch(
    "/documents/{stored_document_id}/move",
    response_model=APIResponse[dict],
    summary="Move document to folder",
    description="""
Move a document to a different folder.

This endpoint allows reorganizing documents by moving them between folders. The move operation is logged in the activity history for audit purposes.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the document to move |

## Request Body
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| folder_id | string | No | Target folder UUID (null to move to root) |

## Notes
- Moving to root: set folder_id to null
- Activity is logged with old and new folder IDs
""",
    responses={
        200: {
            "description": "Document moved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                            "moved": True
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T14:00:00Z"}
                    }
                }
            }
        },
        404: {"description": "Document or folder not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''# Move to folder
curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/move" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"folder_id": "660e8400-e29b-41d4-a716-446655440001"}'

# Move to root
curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/move" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"folder_id": null}' '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

doc_id = "770e8400-e29b-41d4-a716-446655440002"
target_folder = "660e8400-e29b-41d4-a716-446655440001"

response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{doc_id}/move",
    headers={"Authorization": f"Bearer {token}"},
    json={"folder_id": target_folder}
)

result = response.json()["data"]
print(f"Document moved to folder: {result['folder_id']}")

# Move to root
response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{doc_id}/move",
    headers={"Authorization": f"Bearer {token}"},
    json={"folder_id": None}
)'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const docId = "770e8400-e29b-41d4-a716-446655440002";
const targetFolder = "660e8400-e29b-41d4-a716-446655440001";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${docId}/move`,
  {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ folder_id: targetFolder })
  }
);

const { data: result } = await response.json();
console.log(`Document moved to folder: ${result.folder_id}`);

// Move to root
await fetch(`https://api.giga-pdf.com/api/v1/storage/documents/${docId}/move`, {
  method: "PATCH",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ folder_id: null })
});'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$docId = "770e8400-e29b-41d4-a716-446655440002";
$targetFolder = "660e8400-e29b-41d4-a716-446655440001";
$client = new GuzzleHttp\\Client();

$response = $client->patch(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$docId}/move",
    [
        "headers" => [
            "Authorization" => "Bearer " . $token,
            "Content-Type" => "application/json"
        ],
        "json" => ["folder_id" => $targetFolder]
    ]
);

$result = json_decode($response->getBody(), true)["data"];
echo "Document moved to folder: " . $result["folder_id"] . "\\n";

// Move to root
$client->patch(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$docId}/move",
    [
        "headers" => [
            "Authorization" => "Bearer " . $token,
            "Content-Type" => "application/json"
        ],
        "json" => ["folder_id" => null]
    ]
);'''
            }
        ]
    },
)
async def move_document(
    stored_document_id: str,
    request: MoveDocumentRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Move document to a folder."""
    start_time = time.time()

    # Get document
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
            ~StoredDocument.is_deleted,
        )
    )
    document = result.scalar_one_or_none()

    if not document:
        raise NotFoundError(f"Document not found: {stored_document_id}")

    # Verify target folder exists (if provided)
    if request.folder_id:
        folder_result = await db.execute(
            select(Folder).where(
                Folder.id == request.folder_id,
                Folder.owner_id == user.user_id,
            )
        )
        folder = folder_result.scalar_one_or_none()
        if not folder:
            raise NotFoundError(f"Folder not found: {request.folder_id}")

    # Move document
    old_folder_id = document.folder_id
    document.folder_id = request.folder_id
    document.updated_at = now_utc()
    await db.commit()

    # Log the move activity
    await activity_service.log_activity(
        user_id=user.user_id,
        action=ActivityAction.MOVE,
        document_id=stored_document_id,
        user_email=user.email,
        extra_data={"old_folder_id": old_folder_id, "new_folder_id": request.folder_id},
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "folder_id": request.folder_id,
            "moved": True,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


class MoveFolderRequest(BaseModel):
    """Request to move a folder to another folder."""

    parent_id: str | None = Field(
        default=None,
        description="Target parent folder ID (null for root)",
    )


@router.patch(
    "/folders/{folder_id}/move",
    response_model=APIResponse[dict],
    summary="Move folder to another folder",
    description="""
Move a folder to a different parent folder.

This endpoint allows reorganizing the folder hierarchy by moving folders. All descendant folders and their paths are automatically updated.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| folder_id | string | UUID of the folder to move |

## Request Body
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| parent_id | string | No | Target parent folder UUID (null for root) |

## Validation Rules
- Cannot move a folder into itself
- Cannot move a folder into one of its descendants (circular reference)

## Notes
- All descendant folder paths are automatically updated
- Moving to root: set parent_id to null
""",
    responses={
        200: {
            "description": "Folder moved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folder_id": "660e8400-e29b-41d4-a716-446655440002",
                            "parent_id": "660e8400-e29b-41d4-a716-446655440001",
                            "path": "/660e8400-e29b-41d4-a716-446655440001/",
                            "moved": True
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T14:30:00Z"}
                    }
                }
            }
        },
        400: {"description": "Cannot move folder into itself or its descendant"},
        404: {"description": "Folder or target parent not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''# Move to parent folder
curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440002/move" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"parent_id": "660e8400-e29b-41d4-a716-446655440001"}'

# Move to root
curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440002/move" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"parent_id": null}' '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

folder_id = "660e8400-e29b-41d4-a716-446655440002"
target_parent = "660e8400-e29b-41d4-a716-446655440001"

response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}/move",
    headers={"Authorization": f"Bearer {token}"},
    json={"parent_id": target_parent}
)

result = response.json()["data"]
print(f"Folder moved to: {result['path']}")

# Move to root
response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}/move",
    headers={"Authorization": f"Bearer {token}"},
    json={"parent_id": None}
)'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const folderId = "660e8400-e29b-41d4-a716-446655440002";
const targetParent = "660e8400-e29b-41d4-a716-446655440001";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/folders/${folderId}/move`,
  {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ parent_id: targetParent })
  }
);

const { data: result } = await response.json();
console.log(`Folder moved to: ${result.path}`);

// Move to root
await fetch(`https://api.giga-pdf.com/api/v1/storage/folders/${folderId}/move`, {
  method: "PATCH",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ parent_id: null })
});'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$folderId = "660e8400-e29b-41d4-a716-446655440002";
$targetParent = "660e8400-e29b-41d4-a716-446655440001";
$client = new GuzzleHttp\\Client();

$response = $client->patch(
    "https://api.giga-pdf.com/api/v1/storage/folders/{$folderId}/move",
    [
        "headers" => [
            "Authorization" => "Bearer " . $token,
            "Content-Type" => "application/json"
        ],
        "json" => ["parent_id" => $targetParent]
    ]
);

$result = json_decode($response->getBody(), true)["data"];
echo "Folder moved to: " . $result["path"] . "\\n";

// Move to root
$client->patch(
    "https://api.giga-pdf.com/api/v1/storage/folders/{$folderId}/move",
    [
        "headers" => [
            "Authorization" => "Bearer " . $token,
            "Content-Type" => "application/json"
        ],
        "json" => ["parent_id" => null]
    ]
);'''
            }
        ]
    },
)
async def move_folder(
    folder_id: str,
    request: MoveFolderRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Move folder to another folder."""
    start_time = time.time()

    # Can't move folder into itself
    if folder_id == request.parent_id:
        raise InvalidOperationError("Cannot move folder into itself")

    # Get folder to move
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id,
            Folder.owner_id == user.user_id,
        )
    )
    folder = result.scalar_one_or_none()

    if not folder:
        raise NotFoundError(f"Folder not found: {folder_id}")

    # Verify target parent folder exists (if provided)
    new_path = "/"
    if request.parent_id:
        parent_result = await db.execute(
            select(Folder).where(
                Folder.id == request.parent_id,
                Folder.owner_id == user.user_id,
            )
        )
        parent_folder = parent_result.scalar_one_or_none()
        if not parent_folder:
            raise NotFoundError(f"Parent folder not found: {request.parent_id}")

        # Check if target is a descendant of the folder being moved
        if parent_folder.path.startswith(folder.path + folder.id + "/"):
            raise InvalidOperationError("Cannot move folder into its own descendant")

        new_path = f"{parent_folder.path}{parent_folder.id}/"

    # Update folder
    old_path = folder.path
    folder.parent_id = request.parent_id
    folder.path = new_path
    folder.updated_at = now_utc()

    # Update paths of all descendants
    descendants_result = await db.execute(
        select(Folder).where(
            Folder.owner_id == user.user_id,
            Folder.path.startswith(old_path + folder_id + "/"),
        )
    )
    descendants = descendants_result.scalars().all()

    for descendant in descendants:
        # Replace old path prefix with new path prefix
        descendant.path = descendant.path.replace(
            old_path + folder_id + "/",
            new_path + folder_id + "/",
            1
        )

    await db.commit()

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "folder_id": folder_id,
            "parent_id": request.parent_id,
            "path": new_path,
            "moved": True,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/folders/{folder_id}/stats",
    response_model=APIResponse[dict],
    summary="Get folder statistics",
    description="""
Get comprehensive statistics for a folder including total size and counts (recursive).

This endpoint calculates statistics for the specified folder and all its descendants, providing a complete picture of the folder's contents.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| folder_id | string | UUID of the folder to analyze |

## Response Structure
- **folder_id**: The analyzed folder's UUID
- **total_size_bytes**: Combined size of all documents (recursive)
- **document_count**: Total number of documents (recursive)
- **folder_count**: Number of subfolders (not including the folder itself)

## Use Cases
- Display folder size in file browser UI
- Check folder contents before deletion
- Monitor storage usage by folder
""",
    responses={
        200: {
            "description": "Folder statistics retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                            "total_size_bytes": 52428800,
                            "document_count": 15,
                            "folder_count": 3
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T15:00:00Z"}
                    }
                }
            }
        },
        404: {"description": "Folder not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440001/stats" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

folder_id = "660e8400-e29b-41d4-a716-446655440001"
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}/stats",
    headers={"Authorization": f"Bearer {token}"}
)

stats = response.json()["data"]
size_mb = stats["total_size_bytes"] / (1024 * 1024)
print(f"Folder size: {size_mb:.2f} MB")
print(f"Documents: {stats['document_count']}")
print(f"Subfolders: {stats['folder_count']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const folderId = "660e8400-e29b-41d4-a716-446655440001";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/folders/${folderId}/stats`,
  {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data: stats } = await response.json();
const sizeMB = (stats.total_size_bytes / (1024 * 1024)).toFixed(2);
console.log(`Folder size: ${sizeMB} MB`);
console.log(`Documents: ${stats.document_count}`);
console.log(`Subfolders: ${stats.folder_count}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$folderId = "660e8400-e29b-41d4-a716-446655440001";
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "https://api.giga-pdf.com/api/v1/storage/folders/{$folderId}/stats",
    ["headers" => ["Authorization" => "Bearer " . $token]]
);

$stats = json_decode($response->getBody(), true)["data"];
$sizeMB = number_format($stats["total_size_bytes"] / (1024 * 1024), 2);
echo "Folder size: " . $sizeMB . " MB\\n";
echo "Documents: " . $stats["document_count"] . "\\n";
echo "Subfolders: " . $stats["folder_count"] . "\\n";'''
            }
        ]
    },
)
async def get_folder_stats(
    folder_id: str,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Get folder statistics (size, document count, etc.)."""
    start_time = time.time()

    # Get folder
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id,
            Folder.owner_id == user.user_id,
        )
    )
    folder = result.scalar_one_or_none()

    if not folder:
        raise NotFoundError(f"Folder not found: {folder_id}")

    # Get all folders in this subtree (including the folder itself)
    folder_ids = [folder_id]
    descendants_result = await db.execute(
        select(Folder.id).where(
            Folder.owner_id == user.user_id,
            Folder.path.startswith(folder.path + folder_id + "/"),
        )
    )
    folder_ids.extend([f[0] for f in descendants_result.all()])

    # Count subfolders (excluding the folder itself)
    subfolder_count = len(folder_ids) - 1

    # Get document stats for all folders in subtree
    stats_result = await db.execute(
        select(
            func.count(StoredDocument.id),
            func.coalesce(func.sum(StoredDocument.file_size_bytes), 0)
        ).where(
            StoredDocument.owner_id == user.user_id,
            StoredDocument.folder_id.in_(folder_ids),
            ~StoredDocument.is_deleted,
        )
    )
    stats = stats_result.one()
    document_count = stats[0] or 0
    total_size = stats[1] or 0

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "folder_id": folder_id,
            "total_size_bytes": total_size,
            "document_count": document_count,
            "folder_count": subfolder_count,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
