"""
Admin documents management endpoints.

Provides document management for the admin panel.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.database import DocumentVersion, StoredDocument

router = APIRouter()


def format_bytes(bytes_val: int) -> str:
    """Format bytes to human readable string."""
    if bytes_val >= 1024 ** 4:
        return f"{bytes_val / (1024 ** 4):.1f} TB"
    elif bytes_val >= 1024 ** 3:
        return f"{bytes_val / (1024 ** 3):.1f} GB"
    elif bytes_val >= 1024 ** 2:
        return f"{bytes_val / (1024 ** 2):.1f} MB"
    elif bytes_val >= 1024:
        return f"{bytes_val / 1024:.1f} KB"
    return f"{bytes_val} B"


class DocumentResponse(BaseModel):
    """Document response model."""
    id: str
    name: str
    owner_id: str
    page_count: int
    file_size_bytes: int
    file_size_formatted: str
    mime_type: str
    current_version: int
    is_deleted: bool
    tags: list | None = None
    created_at: datetime
    updated_at: datetime


class DocumentListResponse(BaseModel):
    """Paginated document list response."""
    documents: list[DocumentResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class DocumentStatsResponse(BaseModel):
    """Document statistics response."""
    total_documents: int
    total_size_bytes: int
    total_size_formatted: str
    documents_by_type: dict
    avg_page_count: float
    deleted_count: int


@router.get(
    "",
    response_model=DocumentListResponse,
    summary="List all documents",
    description="""Returns a paginated list of all PDF documents stored on the platform.

**Admin access required.** This endpoint is restricted to administrators and provides
a global view across all users' documents.

Supports filtering by:
- **search**: partial match on document name (case-insensitive)
- **owner_id**: filter documents belonging to a specific user
- **include_deleted**: include soft-deleted documents in results (default: false)

Results are sorted by last update date (most recent first).""",
    response_description="Paginated list of documents with metadata",
    responses={
        200: {
            "description": "Paginated document list returned successfully",
            "content": {
                "application/json": {
                    "example": {
                        "documents": [
                            {
                                "id": "doc_01HXYZ",
                                "name": "invoice_2024_q1.pdf",
                                "owner_id": "usr_01HABC",
                                "page_count": 4,
                                "file_size_bytes": 204800,
                                "file_size_formatted": "200.0 KB",
                                "mime_type": "application/pdf",
                                "current_version": 2,
                                "is_deleted": False,
                                "tags": ["invoice", "2024"],
                                "created_at": "2024-01-15T10:00:00Z",
                                "updated_at": "2024-03-01T14:30:00Z",
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
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/documents'
                    '?page=1&page_size=20&include_deleted=false" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/documents",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    "    params={\"page\": 1, \"page_size\": 20, \"include_deleted\": False},\n"
                    ")\n"
                    "data = response.json()\n"
                    'print(f"Total documents: {data[\'total\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const params = new URLSearchParams({ page: 1, page_size: 20, include_deleted: false });\n"
                    "const response = await fetch(\n"
                    '  `https://api.giga-pdf.com/api/v1/admin/documents?${params}`,\n'
                    "  { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }\n"
                    ");\n"
                    "const data = await response.json();\n"
                    "console.log(`Total documents: ${data.total}`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get('https://api.giga-pdf.com/api/v1/admin/documents', [\n"
                    "    'headers' => ['Authorization' => 'Bearer ' . $adminToken],\n"
                    "    'query'   => ['page' => 1, 'page_size' => 20, 'include_deleted' => false],\n"
                    "]);\n"
                    "$data = json_decode($response->getBody(), true);\n"
                    "echo 'Total documents: ' . $data['total'];"
                ),
            },
        ]
    },
)
async def list_documents(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    owner_id: str | None = Query(None),
    include_deleted: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """
    List all documents with pagination and filtering.
    """
    # Build query
    query = select(StoredDocument)

    # Apply filters
    if not include_deleted:
        query = query.where(~StoredDocument.is_deleted)

    if search:
        query = query.where(StoredDocument.name.ilike(f"%{search}%"))

    if owner_id:
        query = query.where(StoredDocument.owner_id == owner_id)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(StoredDocument.updated_at.desc())

    # Execute query
    result = await db.execute(query)
    documents = result.scalars().all()

    # Build response
    doc_list = []
    for doc in documents:
        doc_list.append(DocumentResponse(
            id=doc.id,
            name=doc.name,
            owner_id=doc.owner_id,
            page_count=doc.page_count,
            file_size_bytes=doc.file_size_bytes,
            file_size_formatted=format_bytes(doc.file_size_bytes),
            mime_type=doc.mime_type,
            current_version=doc.current_version,
            is_deleted=doc.is_deleted,
            tags=doc.tags if doc.tags else [],
            created_at=doc.created_at,
            updated_at=doc.updated_at,
        ))

    total_pages = (total + page_size - 1) // page_size

    return DocumentListResponse(
        documents=doc_list,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/stats",
    response_model=DocumentStatsResponse,
    summary="Get document statistics",
    description="""Returns aggregated statistics about all PDF documents stored on the platform.

**Admin access required.** Provides a high-level overview useful for dashboard metrics and
capacity planning:

- **total_documents**: count of active (non-deleted) documents
- **total_size_bytes / total_size_formatted**: cumulative storage used by active documents
- **documents_by_type**: breakdown by MIME type (e.g. `application/pdf`, `image/png`)
- **avg_page_count**: average number of pages across active documents
- **deleted_count**: number of soft-deleted documents (not yet permanently removed)""",
    response_description="Aggregated document statistics",
    responses={
        200: {
            "description": "Document statistics returned successfully",
            "content": {
                "application/json": {
                    "example": {
                        "total_documents": 4821,
                        "total_size_bytes": 10737418240,
                        "total_size_formatted": "10.0 GB",
                        "documents_by_type": {
                            "application/pdf": 4650,
                            "image/png": 171,
                        },
                        "avg_page_count": 7.3,
                        "deleted_count": 134,
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
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/documents/stats" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/documents/stats",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    ")\n"
                    "stats = response.json()\n"
                    'print(f"Total storage: {stats[\'total_size_formatted\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    '  "https://api.giga-pdf.com/api/v1/admin/documents/stats",\n'
                    "  { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }\n"
                    ");\n"
                    "const stats = await response.json();\n"
                    "console.log(`Total storage: ${stats.total_size_formatted}`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/documents/stats',\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$stats = json_decode($response->getBody(), true);\n"
                    "echo 'Total storage: ' . $stats['total_size_formatted'];"
                ),
            },
        ]
    },
)
async def get_document_stats(
    db: AsyncSession = Depends(get_db),
):
    """
    Get document statistics.
    """
    # Total documents
    total_result = await db.execute(
        select(func.count()).select_from(StoredDocument).where(
            ~StoredDocument.is_deleted
        )
    )
    total_documents = total_result.scalar() or 0

    # Total size
    size_result = await db.execute(
        select(func.sum(StoredDocument.file_size_bytes)).where(
            ~StoredDocument.is_deleted
        )
    )
    total_size_bytes = size_result.scalar() or 0

    # Average page count
    avg_result = await db.execute(
        select(func.avg(StoredDocument.page_count)).where(
            ~StoredDocument.is_deleted
        )
    )
    avg_page_count = avg_result.scalar() or 0

    # Deleted count
    deleted_result = await db.execute(
        select(func.count()).select_from(StoredDocument).where(
            StoredDocument.is_deleted
        )
    )
    deleted_count = deleted_result.scalar() or 0

    # Documents by MIME type
    mime_result = await db.execute(
        select(
            StoredDocument.mime_type,
            func.count().label("count")
        ).where(
            ~StoredDocument.is_deleted
        ).group_by(StoredDocument.mime_type)
    )
    documents_by_type = {row.mime_type: row.count for row in mime_result.all()}

    return DocumentStatsResponse(
        total_documents=total_documents,
        total_size_bytes=total_size_bytes,
        total_size_formatted=format_bytes(total_size_bytes),
        documents_by_type=documents_by_type,
        avg_page_count=float(avg_page_count) if avg_page_count else 0.0,
        deleted_count=deleted_count,
    )


@router.get(
    "/{document_id}",
    response_model=DocumentResponse,
    summary="Get document details",
    description="""Returns the full metadata of a specific document identified by its ID.

**Admin access required.** Unlike the user-facing endpoint, this admin endpoint returns
details for any document regardless of its owner, including soft-deleted documents.

Use this endpoint to inspect a document before deciding to restore or permanently delete it.""",
    response_description="Complete document metadata",
    responses={
        200: {
            "description": "Document found and returned successfully",
            "content": {
                "application/json": {
                    "example": {
                        "id": "doc_01HXYZ",
                        "name": "contract_signed.pdf",
                        "owner_id": "usr_01HABC",
                        "page_count": 12,
                        "file_size_bytes": 512000,
                        "file_size_formatted": "500.0 KB",
                        "mime_type": "application/pdf",
                        "current_version": 3,
                        "is_deleted": False,
                        "tags": ["contract", "legal"],
                        "created_at": "2024-02-10T09:00:00Z",
                        "updated_at": "2024-02-28T16:45:00Z",
                    }
                }
            },
        },
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "Document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/documents/doc_01HXYZ" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "doc_id = \"doc_01HXYZ\"\n"
                    "response = requests.get(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/documents/{doc_id}",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    ")\n"
                    "doc = response.json()\n"
                    'print(f"Document: {doc[\'name\']} ({doc[\'file_size_formatted\']})")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const docId = \"doc_01HXYZ\";\n"
                    "const response = await fetch(\n"
                    "  `https://api.giga-pdf.com/api/v1/admin/documents/${docId}`,\n"
                    "  { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }\n"
                    ");\n"
                    "const doc = await response.json();\n"
                    "console.log(`Document: ${doc.name} (${doc.file_size_formatted})`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$docId = 'doc_01HXYZ';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    \"https://api.giga-pdf.com/api/v1/admin/documents/{$docId}\",\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$doc = json_decode($response->getBody(), true);\n"
                    "echo 'Document: ' . $doc['name'] . ' (' . $doc['file_size_formatted'] . ')';"
                ),
            },
        ]
    },
)
async def get_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get a specific document's details.
    """
    result = await db.execute(
        select(StoredDocument).where(StoredDocument.id == document_id)
    )
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    return DocumentResponse(
        id=doc.id,
        name=doc.name,
        owner_id=doc.owner_id,
        page_count=doc.page_count,
        file_size_bytes=doc.file_size_bytes,
        file_size_formatted=format_bytes(doc.file_size_bytes),
        mime_type=doc.mime_type,
        current_version=doc.current_version,
        is_deleted=doc.is_deleted,
        tags=doc.tags if doc.tags else [],
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


@router.get(
    "/{document_id}/versions",
    summary="List document versions",
    description="""Returns the complete version history of a document, sorted from newest to oldest.

**Admin access required.** Each entry includes the version number, file size, SHA hash,
an optional comment describing the change, and the ID of the user who created that version.

Useful for auditing document changes or identifying which version to restore from.""",
    response_description="List of document versions ordered by version number descending",
    responses={
        200: {
            "description": "Version history returned successfully",
            "content": {
                "application/json": {
                    "example": {
                        "versions": [
                            {
                                "id": "ver_01HXYZ",
                                "version_number": 3,
                                "file_size_bytes": 512000,
                                "file_size_formatted": "500.0 KB",
                                "file_hash": "sha256:abc123...",
                                "comment": "Updated signature page",
                                "created_by": "usr_01HABC",
                                "created_at": "2024-02-28T16:45:00Z",
                            }
                        ],
                        "total": 3,
                    }
                }
            },
        },
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "Document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/documents/doc_01HXYZ/versions" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "doc_id = \"doc_01HXYZ\"\n"
                    "response = requests.get(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/documents/{doc_id}/versions",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    ")\n"
                    "data = response.json()\n"
                    'print(f"Total versions: {data[\'total\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const docId = \"doc_01HXYZ\";\n"
                    "const response = await fetch(\n"
                    "  `https://api.giga-pdf.com/api/v1/admin/documents/${docId}/versions`,\n"
                    "  { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }\n"
                    ");\n"
                    "const data = await response.json();\n"
                    "console.log(`Total versions: ${data.total}`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$docId = 'doc_01HXYZ';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    \"https://api.giga-pdf.com/api/v1/admin/documents/{$docId}/versions\",\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$data = json_decode($response->getBody(), true);\n"
                    "echo 'Total versions: ' . $data['total'];"
                ),
            },
        ]
    },
)
async def get_document_versions(
    document_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get all versions of a document.
    """
    # Verify document exists
    doc_result = await db.execute(
        select(StoredDocument).where(StoredDocument.id == document_id)
    )
    if not doc_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Document not found")

    # Get versions
    result = await db.execute(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version_number.desc())
    )
    versions = result.scalars().all()

    return {
        "versions": [
            {
                "id": v.id,
                "version_number": v.version_number,
                "file_size_bytes": v.file_size_bytes,
                "file_size_formatted": format_bytes(v.file_size_bytes),
                "file_hash": v.file_hash,
                "comment": v.comment,
                "created_by": v.created_by,
                "created_at": v.created_at,
            }
            for v in versions
        ],
        "total": len(versions),
    }


@router.delete(
    "/{document_id}",
    summary="Delete a document",
    description="""Deletes a document, either as a soft delete (recoverable) or a permanent hard delete.

**Admin access required.** This is a privileged operation that bypasses user-level ownership checks.

- **Soft delete** (default, `permanent=false`): sets `is_deleted=true` and records `deleted_at`.
  The document remains in the database and can be restored via `POST /{document_id}/restore`.
- **Hard delete** (`permanent=true`): permanently removes the document record from the database.
  **This action is irreversible.**

Use permanent deletion only when you are certain the document and all its versions should be
purged (e.g. GDPR right-to-erasure requests).""",
    response_description="Confirmation message indicating whether the document was soft or hard deleted",
    responses={
        200: {
            "description": "Document deleted successfully",
            "content": {
                "application/json": {
                    "examples": {
                        "soft_delete": {
                            "summary": "Soft delete",
                            "value": {"message": "Document doc_01HXYZ soft deleted successfully"},
                        },
                        "hard_delete": {
                            "summary": "Hard delete",
                            "value": {"message": "Document doc_01HXYZ permanently deleted successfully"},
                        },
                    }
                }
            },
        },
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "Document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    "# Soft delete (default)\n"
                    'curl -X DELETE "https://api.giga-pdf.com/api/v1/admin/documents/doc_01HXYZ" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"\n\n'
                    "# Permanent hard delete\n"
                    'curl -X DELETE "https://api.giga-pdf.com/api/v1/admin/documents/doc_01HXYZ?permanent=true" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "doc_id = \"doc_01HXYZ\"\n"
                    "# Soft delete\n"
                    "response = requests.delete(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/documents/{doc_id}",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    ")\n"
                    "print(response.json()['message'])"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const docId = \"doc_01HXYZ\";\n"
                    "// Soft delete\n"
                    "const response = await fetch(\n"
                    "  `https://api.giga-pdf.com/api/v1/admin/documents/${docId}`,\n"
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
                    "$docId = 'doc_01HXYZ';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "// Soft delete\n"
                    "$response = $client->delete(\n"
                    "    \"https://api.giga-pdf.com/api/v1/admin/documents/{$docId}\",\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$result = json_decode($response->getBody(), true);\n"
                    "echo $result['message'];"
                ),
            },
        ]
    },
)
async def delete_document(
    document_id: str,
    permanent: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a document.

    By default, performs a soft delete. Use permanent=true for hard delete.
    """
    result = await db.execute(
        select(StoredDocument).where(StoredDocument.id == document_id)
    )
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if permanent:
        await db.delete(doc)
    else:
        doc.is_deleted = True
        doc.deleted_at = datetime.now()

    await db.commit()

    action = "permanently deleted" if permanent else "soft deleted"
    return {"message": f"Document {document_id} {action} successfully"}


@router.post(
    "/{document_id}/restore",
    summary="Restore a soft-deleted document",
    description="""Restores a previously soft-deleted document, making it active again.

**Admin access required.** This endpoint undoes a soft delete by setting `is_deleted=false`
and clearing the `deleted_at` timestamp.

Only documents that have been soft-deleted can be restored. Permanently deleted documents
cannot be recovered. If the document ID does not correspond to a soft-deleted document,
a 404 error is returned.""",
    response_description="Confirmation message indicating the document has been restored",
    responses={
        200: {
            "description": "Document restored successfully",
            "content": {
                "application/json": {
                    "example": {"message": "Document doc_01HXYZ restored successfully"}
                }
            },
        },
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "Deleted document not found (either never existed or already hard-deleted)"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X POST "https://api.giga-pdf.com/api/v1/admin/documents/doc_01HXYZ/restore" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "doc_id = \"doc_01HXYZ\"\n"
                    "response = requests.post(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/documents/{doc_id}/restore",\n'
                    "    headers={\"Authorization\": \"Bearer \" + ADMIN_TOKEN},\n"
                    ")\n"
                    "print(response.json()['message'])"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const docId = \"doc_01HXYZ\";\n"
                    "const response = await fetch(\n"
                    "  `https://api.giga-pdf.com/api/v1/admin/documents/${docId}/restore`,\n"
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
                    "$docId = 'doc_01HXYZ';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->post(\n"
                    "    \"https://api.giga-pdf.com/api/v1/admin/documents/{$docId}/restore\",\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$result = json_decode($response->getBody(), true);\n"
                    "echo $result['message'];"
                ),
            },
        ]
    },
)
async def restore_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Restore a soft-deleted document.
    """
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == document_id,
            StoredDocument.is_deleted
        )
    )
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Deleted document not found")

    doc.is_deleted = False
    doc.deleted_at = None

    await db.commit()

    return {"message": f"Document {document_id} restored successfully"}
