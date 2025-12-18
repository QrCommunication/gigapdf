"""
Persistent storage endpoints.

Handles saving, loading, versioning, and organizing documents in persistent storage.
"""

import time
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.middleware.auth import AuthenticatedUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo, PaginationInfo
from app.services.activity_service import activity_service, ActivityAction
from app.utils.helpers import generate_uuid, now_utc

router = APIRouter()


class SaveDocumentRequest(BaseModel):
    """Request to save a document to storage."""

    document_id: str = Field(
        description="Document ID from active session to save",
    )
    name: str = Field(
        description="Display name for the document",
        min_length=1,
        max_length=255,
    )
    folder_id: Optional[str] = Field(
        default=None,
        description="Folder ID to save into (null for root)",
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Tags for organizing documents",
    )
    version_comment: Optional[str] = Field(
        default=None,
        description="Comment describing this version",
    )


class CreateFolderRequest(BaseModel):
    """Request to create a folder."""

    name: str = Field(
        description="Folder name",
        min_length=1,
        max_length=255,
    )
    parent_id: Optional[str] = Field(
        default=None,
        description="Parent folder ID (null for root)",
    )


class CreateVersionRequest(BaseModel):
    """Request to create a new version."""

    document_id: str = Field(
        description="Document ID from active session",
    )
    comment: Optional[str] = Field(
        default=None,
        description="Version comment",
    )


@router.post(
    "/documents",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Save document to storage",
    description="""
Save a document from the active session to persistent storage.

This creates a permanent copy of the document that persists beyond the session.
The document can be organized into folders and tagged for easier retrieval.

## Request Body
```json
{
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Contract Agreement 2024",
  "folder_id": "660e8400-e29b-41d4-a716-446655440001",
  "tags": ["contract", "legal", "2024"],
  "version_comment": "Initial version"
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/storage/documents" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "document_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My Document",
    "tags": ["important"]
  }'
```

## Example (Python)
```python
import requests

# Sauvegarder un document dans le stockage persistant
response = requests.post(
    "http://localhost:8000/api/v1/storage/documents",
    headers={"Authorization": "Bearer <token>"},
    json={
        "document_id": document_id,
        "name": "Contract Agreement 2024",
        "folder_id": folder_id,
        "tags": ["contract", "legal", "2024"],
        "version_comment": "Initial version"
    }
)
stored_doc = response.json()["data"]
stored_id = stored_doc["stored_document_id"]
```

## Example (JavaScript)
```javascript
// Enregistrer un document
const response = await fetch('/api/v1/storage/documents', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    document_id: documentId,
    name: 'My Document',
    folder_id: folderId,
    tags: ['important', 'draft']
  })
});
const result = await response.json();
const storedId = result.data.stored_document_id;
```

## Example (PHP)
```php
// Sauvegarder un document
$client = new GuzzleHttp\\Client();
$response = $client->post('http://localhost:8000/api/v1/storage/documents', [
    'headers' => [
        'Authorization' => 'Bearer <token>',
        'Content-Type' => 'application/json'
    ],
    'json' => [
        'document_id' => $documentId,
        'name' => 'Contract Agreement 2024',
        'folder_id' => $folderId,
        'tags' => ['contract', 'legal', '2024']
    ]
]);
$storedDoc = json_decode($response->getBody(), true)['data'];
```
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
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {"description": "Invalid request or storage quota exceeded"},
        404: {"description": "Document or folder not found"},
    },
)
async def save_document(
    request: SaveDocumentRequest,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Save document to persistent storage."""
    start_time = time.time()

    from app.models.database import StoredDocument, DocumentVersion
    from app.core.database import get_db_session
    from app.repositories.document_repo import document_sessions
    from app.services.quota_service import quota_service
    import hashlib
    from pathlib import Path

    # Get document from session
    doc_session = document_sessions.get_session(request.document_id)
    if not doc_session:
        from app.middleware.error_handler import DocumentNotFoundError
        raise DocumentNotFoundError(request.document_id)

    # Get document bytes first to check size
    from app.core.pdf_engine import pdf_engine
    doc_bytes = pdf_engine.save_document(request.document_id)
    file_size = len(doc_bytes)

    # Get effective limits (considers tenant membership)
    effective_limits = await quota_service.get_effective_limits(user.user_id)

    # Check if quota allows (using effective limits - tenant or personal)
    if effective_limits.storage_used_bytes + file_size > effective_limits.storage_limit_bytes:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError(
            f"Storage quota exceeded. Used: {effective_limits.storage_used_bytes}, "
            f"Limit: {effective_limits.storage_limit_bytes}"
        )

    if effective_limits.document_limit != -1 and effective_limits.document_count >= effective_limits.document_limit:
        from app.middleware.error_handler import InvalidOperationError
        raise InvalidOperationError(
            f"Document limit exceeded. Limit: {effective_limits.document_limit}"
        )

    # Calculate file hash
    file_hash = hashlib.sha256(doc_bytes).hexdigest()

    async with get_db_session() as session:
        # Create stored document record
        stored_doc_id = generate_uuid()
        stored_doc = StoredDocument(
            id=stored_doc_id,
            name=request.name,
            owner_id=user.user_id,
            folder_id=request.folder_id,
            page_count=doc_session.scene_graph.metadata.page_count,
            current_version=1,
            file_size_bytes=file_size,
            tags=request.tags,
        )
        session.add(stored_doc)

        # Upload file to S3
        from app.services.s3_service import s3_service
        s3_key = s3_service.get_document_key(user.user_id, stored_doc_id, 1)

        try:
            s3_result = s3_service.upload_file(
                file_data=doc_bytes,
                key=s3_key,
                content_type="application/pdf",
                metadata={
                    "document_id": stored_doc_id,
                    "user_id": user.user_id,
                    "version": "1",
                    "name": request.name,
                }
            )
        except Exception as e:
            from app.middleware.error_handler import InvalidOperationError
            raise InvalidOperationError(f"Failed to upload to S3: {str(e)}")

        # Create version record with S3 path
        version = DocumentVersion(
            document_id=stored_doc_id,
            version_number=1,
            file_path=s3_key,  # Store S3 key instead of local path
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment=request.version_comment,
            created_by=user.user_id,
        )
        session.add(version)

    # Update quota (tenant or personal based on membership)
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
            "name": request.name,
            "page_count": stored_doc.page_count,
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

Supports pagination, filtering by folder, and searching by name or tags.

## Query Parameters
- **page**: Page number (default: 1)
- **per_page**: Items per page (default: 20, max: 100)
- **folder_id**: Filter by folder (null for root)
- **search**: Search in name and tags
- **tags**: Filter by tags (comma-separated)

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/storage/documents?page=1&per_page=20" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Lister les documents sauvegardés
response = requests.get(
    "http://localhost:8000/api/v1/storage/documents",
    params={"page": 1, "per_page": 20, "folder_id": folder_id},
    headers={"Authorization": "Bearer <token>"}
)
documents = response.json()["data"]["items"]
pagination = response.json()["data"]["pagination"]
```

## Example (JavaScript)
```javascript
// Récupérer la liste des documents
const params = new URLSearchParams({
  page: '1',
  per_page: '20',
  search: 'contract'
});
const response = await fetch(`/api/v1/storage/documents?${params}`, {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
const documents = result.data.items;
```

## Example (PHP)
```php
// Lister les documents stockés
$client = new GuzzleHttp\\Client();
$response = $client->get('http://localhost:8000/api/v1/storage/documents', [
    'headers' => ['Authorization' => 'Bearer <token>'],
    'query' => ['page' => 1, 'per_page' => 20, 'search' => 'contract']
]);
$data = json_decode($response->getBody(), true)['data'];
$documents = $data['items'];
```
""",
    responses={
        200: {"description": "Documents retrieved successfully"},
    },
)
async def list_stored_documents(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    folder_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    tags: Optional[str] = Query(default=None),
) -> APIResponse[dict]:
    """List stored documents with pagination."""
    start_time = time.time()

    from app.models.database import StoredDocument
    from app.core.database import get_db_session
    from sqlalchemy import select, func

    async with get_db_session() as session:
        # Build base query
        base_query = select(StoredDocument).where(
            StoredDocument.owner_id == user.user_id,
            StoredDocument.is_deleted == False,
        )

        # Filter by folder
        if folder_id is not None:
            base_query = base_query.where(StoredDocument.folder_id == folder_id)

        # Search by name
        if search:
            base_query = base_query.where(StoredDocument.name.ilike(f"%{search}%"))

        # Filter by tags
        if tags:
            tag_list = [t.strip() for t in tags.split(",")]
            base_query = base_query.where(StoredDocument.tags.op("&&")(tag_list))

        # Get total count
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await session.execute(count_query)
        total = total_result.scalar() or 0

        # Order and paginate
        offset = (page - 1) * per_page
        paginated_query = base_query.order_by(StoredDocument.updated_at.desc()).offset(offset).limit(per_page)
        result = await session.execute(paginated_query)
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

This creates a new document session from the stored document,
allowing you to edit it using the regular document APIs.

## Path Parameters
- **stored_document_id**: Stored document identifier (UUID v4)

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/storage/documents/{stored_document_id}/load" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Charger un document stocké dans une session
response = requests.post(
    f"http://localhost:8000/api/v1/storage/documents/{stored_doc_id}/load",
    headers={"Authorization": "Bearer <token>"}
)
session_doc = response.json()["data"]
document_id = session_doc["document_id"]  # Use this for editing
```

## Example (JavaScript)
```javascript
// Charger un document pour édition
const response = await fetch(
  `/api/v1/storage/documents/${storedDocId}/load`,
  {
    method: 'POST',
    headers: { 'Authorization': 'Bearer <token>' }
  }
);
const result = await response.json();
const documentId = result.data.document_id;
```

## Example (PHP)
```php
// Charger un document dans une session
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "http://localhost:8000/api/v1/storage/documents/{$storedDocId}/load",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$sessionDoc = json_decode($response->getBody(), true)['data'];
$documentId = $sessionDoc['document_id'];
```
""",
    responses={
        200: {"description": "Document loaded successfully"},
        404: {"description": "Stored document not found"},
    },
)
async def load_stored_document(
    stored_document_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Load stored document to session."""
    start_time = time.time()

    from app.models.database import StoredDocument
    from app.core.database import get_db_session
    from app.services.document_service import document_service
    from sqlalchemy import select

    async with get_db_session() as session:
        # Get stored document
        result = await session.execute(
            select(StoredDocument).where(
                StoredDocument.id == stored_document_id,
                StoredDocument.owner_id == user.user_id,
                StoredDocument.is_deleted == False,
            )
        )
        stored_doc = result.scalar_one_or_none()

        if not stored_doc:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError(f"Stored document not found: {stored_document_id}")

        # Download from S3
        from app.services.s3_service import s3_service
        s3_key = s3_service.get_document_key(
            user.user_id, stored_document_id, stored_doc.current_version
        )

        try:
            file_data = s3_service.download_file(s3_key)
        except Exception as e:
            from app.middleware.error_handler import NotFoundError
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
List all versions of a stored document.

Each time you save changes to a stored document, a new version is created.
This endpoint returns the version history with comments and metadata.

## Path Parameters
- **stored_document_id**: Stored document identifier (UUID v4)

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/storage/documents/{stored_document_id}/versions" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Lister les versions d'un document
response = requests.get(
    f"http://localhost:8000/api/v1/storage/documents/{stored_doc_id}/versions",
    headers={"Authorization": "Bearer <token>"}
)
versions = response.json()["data"]["versions"]
```

## Example (JavaScript)
```javascript
// Récupérer l'historique des versions
const response = await fetch(
  `/api/v1/storage/documents/${storedDocId}/versions`,
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer <token>' }
  }
);
const result = await response.json();
const versions = result.data.versions;
```

## Example (PHP)
```php
// Lister les versions d'un document
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "http://localhost:8000/api/v1/storage/documents/{$storedDocId}/versions",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
$versions = json_decode($response->getBody(), true)['data']['versions'];
```
""",
    responses={
        200: {"description": "Versions retrieved successfully"},
        404: {"description": "Stored document not found"},
    },
)
async def list_versions(
    stored_document_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """List document versions."""
    start_time = time.time()

    from app.models.database import StoredDocument, DocumentVersion
    from app.core.database import get_db_session
    from sqlalchemy import select

    async with get_db_session() as session:
        # Verify ownership
        result = await session.execute(
            select(StoredDocument).where(
                StoredDocument.id == stored_document_id,
                StoredDocument.owner_id == user.user_id,
            )
        )
        stored_doc = result.scalar_one_or_none()

        if not stored_doc:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError(f"Stored document not found: {stored_document_id}")

        # Get versions
        versions_result = await session.execute(
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
Create a new version of a stored document from an active session.

This saves the current state of the document as a new version,
preserving the previous versions for history.

## Path Parameters
- **stored_document_id**: Stored document identifier (UUID v4)

## Request Body
```json
{
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "comment": "Updated legal terms on page 5"
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/storage/documents/{stored_document_id}/versions" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"document_id": "...", "comment": "Fixed typos"}'
```

## Example (Python)
```python
import requests

# Créer une nouvelle version
response = requests.post(
    f"http://localhost:8000/api/v1/storage/documents/{stored_doc_id}/versions",
    headers={"Authorization": "Bearer <token>"},
    json={
        "document_id": document_id,
        "comment": "Updated legal terms on page 5"
    }
)
new_version = response.json()["data"]
```

## Example (JavaScript)
```javascript
// Enregistrer une nouvelle version
const response = await fetch(
  `/api/v1/storage/documents/${storedDocId}/versions`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      document_id: documentId,
      comment: 'Fixed typos'
    })
  }
);
const result = await response.json();
```

## Example (PHP)
```php
// Créer une nouvelle version
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "http://localhost:8000/api/v1/storage/documents/{$storedDocId}/versions",
    [
        'headers' => [
            'Authorization' => 'Bearer <token>',
            'Content-Type' => 'application/json'
        ],
        'json' => [
            'document_id' => $documentId,
            'comment' => 'Updated legal terms'
        ]
    ]
);
```
""",
    responses={
        201: {"description": "Version created successfully"},
        404: {"description": "Stored document not found"},
    },
)
async def create_version(
    stored_document_id: str,
    request: CreateVersionRequest,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Create new version from session document."""
    start_time = time.time()

    from app.models.database import StoredDocument, DocumentVersion
    from app.core.database import get_db_session
    from app.repositories.document_repo import document_sessions
    from sqlalchemy import select
    import hashlib
    from pathlib import Path

    # Get document from session
    doc_session = document_sessions.get_session(request.document_id)
    if not doc_session:
        from app.middleware.error_handler import DocumentNotFoundError
        raise DocumentNotFoundError(request.document_id)

    async with get_db_session() as session:
        # Verify ownership
        result = await session.execute(
            select(StoredDocument).where(
                StoredDocument.id == stored_document_id,
                StoredDocument.owner_id == user.user_id,
            )
        )
        stored_doc = result.scalar_one_or_none()

        if not stored_doc:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError(f"Stored document not found: {stored_document_id}")

        # Get document bytes
        from app.core.pdf_engine import pdf_engine
        doc_bytes = pdf_engine.save_document(request.document_id)
        file_size = len(doc_bytes)
        file_hash = hashlib.sha256(doc_bytes).hexdigest()

        # Increment version
        new_version_number = stored_doc.current_version + 1

        # Upload to S3
        from app.services.s3_service import s3_service
        s3_key = s3_service.get_document_key(
            user.user_id, stored_document_id, new_version_number
        )

        try:
            s3_service.upload_file(
                file_data=doc_bytes,
                key=s3_key,
                content_type="application/pdf",
                metadata={
                    "document_id": stored_document_id,
                    "user_id": user.user_id,
                    "version": str(new_version_number),
                }
            )
        except Exception as e:
            from app.middleware.error_handler import InvalidOperationError
            raise InvalidOperationError(f"Failed to upload to S3: {str(e)}")

        # Create version record with S3 key
        version = DocumentVersion(
            document_id=stored_document_id,
            version_number=new_version_number,
            file_path=s3_key,  # Store S3 key
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment=request.comment,
            created_by=user.user_id,
        )
        session.add(version)

        # Update stored document
        stored_doc.current_version = new_version_number
        stored_doc.page_count = doc_session.scene_graph.metadata.page_count
        stored_doc.file_size_bytes = file_size

        # Session commits automatically on exit

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

## Path Parameters
- **stored_document_id**: Stored document identifier (UUID v4)

## Request Body
```json
{
  "name": "New Document Name"
}
```

## Example (curl)
```bash
curl -X PATCH "http://localhost:8000/api/v1/storage/documents/{stored_document_id}" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "New Name"}'
```

## Example (Python)
```python
import requests

# Renommer un document
response = requests.patch(
    f"http://localhost:8000/api/v1/storage/documents/{stored_doc_id}",
    headers={"Authorization": "Bearer <token>"},
    json={"name": "New Document Name"}
)
renamed_doc = response.json()["data"]
```

## Example (JavaScript)
```javascript
// Renommer un document
const response = await fetch(
  `/api/v1/storage/documents/${storedDocId}`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: 'New Document Name' })
  }
);
const result = await response.json();
```

## Example (PHP)
```php
// Renommer un document
$client = new GuzzleHttp\\Client();
$response = $client->patch(
    "http://localhost:8000/api/v1/storage/documents/{$storedDocId}",
    [
        'headers' => [
            'Authorization' => 'Bearer <token>',
            'Content-Type' => 'application/json'
        ],
        'json' => ['name' => 'New Document Name']
    ]
);
$renamedDoc = json_decode($response->getBody(), true)['data'];
```
""",
    responses={
        200: {"description": "Document renamed successfully"},
        404: {"description": "Stored document not found"},
    },
)
async def rename_stored_document(
    stored_document_id: str,
    request: RenameDocumentRequest,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Rename stored document."""
    start_time = time.time()

    from app.models.database import StoredDocument
    from app.core.database import get_db_session
    from sqlalchemy import select

    async with get_db_session() as session:
        # Get stored document
        result = await session.execute(
            select(StoredDocument).where(
                StoredDocument.id == stored_document_id,
                StoredDocument.owner_id == user.user_id,
                StoredDocument.is_deleted == False,
            )
        )
        stored_doc = result.scalar_one_or_none()

        if not stored_doc:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError(f"Stored document not found: {stored_document_id}")

        # Store old name for activity log
        old_name = stored_doc.name

        # Update name
        stored_doc.name = request.name
        stored_doc.updated_at = now_utc()

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
Delete a document from persistent storage (soft delete).

The document is marked as deleted but not physically removed,
allowing for recovery if needed.

## Path Parameters
- **stored_document_id**: Stored document identifier (UUID v4)

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/storage/documents/{stored_document_id}" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Supprimer un document
response = requests.delete(
    f"http://localhost:8000/api/v1/storage/documents/{stored_doc_id}",
    headers={"Authorization": "Bearer <token>"}
)
```

## Example (JavaScript)
```javascript
// Supprimer un document
const response = await fetch(
  `/api/v1/storage/documents/${storedDocId}`,
  {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer <token>' }
  }
);
```

## Example (PHP)
```php
// Supprimer un document
$client = new GuzzleHttp\\Client();
$response = $client->delete(
    "http://localhost:8000/api/v1/storage/documents/{$storedDocId}",
    ['headers' => ['Authorization' => 'Bearer <token>']]
);
```
""",
    responses={
        200: {"description": "Document deleted successfully"},
        404: {"description": "Stored document not found"},
    },
)
async def delete_stored_document(
    stored_document_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Delete stored document (soft delete)."""
    import logging
    logger = logging.getLogger(__name__)

    start_time = time.time()
    logger.info(f"Deleting document {stored_document_id} for user {user.user_id}")

    from app.models.database import StoredDocument
    from app.core.database import get_db_session
    from app.services.quota_service import quota_service
    from sqlalchemy import select

    try:
        # Get effective limits to determine quota source (tenant or personal)
        effective_limits = await quota_service.get_effective_limits(user.user_id)
    except Exception as e:
        logger.error(f"Error getting effective limits: {e}", exc_info=True)
        raise

    async with get_db_session() as session:
        # Get stored document
        result = await session.execute(
            select(StoredDocument).where(
                StoredDocument.id == stored_document_id,
                StoredDocument.owner_id == user.user_id,
                StoredDocument.is_deleted == False,
            )
        )
        stored_doc = result.scalar_one_or_none()

        if not stored_doc:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError(f"Stored document not found: {stored_document_id}")

        file_size = stored_doc.file_size_bytes or 0

        # Soft delete
        stored_doc.is_deleted = True
        stored_doc.deleted_at = now_utc()

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

Folders are returned in a flat list with parent_id relationships.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/storage/folders" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Lister les dossiers
response = requests.get(
    "http://localhost:8000/api/v1/storage/folders",
    headers={"Authorization": "Bearer <token>"}
)
folders = response.json()["data"]["folders"]
```

## Example (JavaScript)
```javascript
// Récupérer les dossiers
const response = await fetch('/api/v1/storage/folders', {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <token>' }
});
const result = await response.json();
const folders = result.data.folders;
```

## Example (PHP)
```php
// Lister les dossiers
$client = new GuzzleHttp\\Client();
$response = $client->get('http://localhost:8000/api/v1/storage/folders', [
    'headers' => ['Authorization' => 'Bearer <token>']
]);
$folders = json_decode($response->getBody(), true)['data']['folders'];
```
""",
    responses={
        200: {"description": "Folders retrieved successfully"},
    },
)
async def list_folders(
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """List user folders."""
    start_time = time.time()

    from app.models.database import Folder
    from app.core.database import get_db_session
    from sqlalchemy import select

    async with get_db_session() as session:
        result = await session.execute(
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

Folders can be nested by specifying a parent_id.

## Request Body
```json
{
  "name": "Legal Documents",
  "parent_id": null
}
```

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/storage/folders" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Legal Documents"}'
```

## Example (Python)
```python
import requests

# Créer un dossier
response = requests.post(
    "http://localhost:8000/api/v1/storage/folders",
    headers={"Authorization": "Bearer <token>"},
    json={"name": "Legal Documents", "parent_id": None}
)
folder = response.json()["data"]
```

## Example (JavaScript)
```javascript
// Créer un nouveau dossier
const response = await fetch('/api/v1/storage/folders', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Legal Documents',
    parent_id: null
  })
});
const result = await response.json();
```

## Example (PHP)
```php
// Créer un dossier
$client = new GuzzleHttp\\Client();
$response = $client->post('http://localhost:8000/api/v1/storage/folders', [
    'headers' => [
        'Authorization' => 'Bearer <token>',
        'Content-Type' => 'application/json'
    ],
    'json' => ['name' => 'Legal Documents', 'parent_id' => null]
]);
$folder = json_decode($response->getBody(), true)['data'];
```
""",
    responses={
        201: {"description": "Folder created successfully"},
    },
)
async def create_folder(
    request: CreateFolderRequest,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Create a new folder."""
    start_time = time.time()

    from app.models.database import Folder
    from app.core.database import get_db_session
    from sqlalchemy import select

    async with get_db_session() as session:
        # Calculate path
        if request.parent_id:
            result = await session.execute(
                select(Folder).where(
                    Folder.id == request.parent_id,
                    Folder.owner_id == user.user_id,
                )
            )
            parent = result.scalar_one_or_none()
            if not parent:
                from app.middleware.error_handler import NotFoundError
                raise NotFoundError(f"Parent folder not found: {request.parent_id}")
            path = f"{parent.path}{parent.id}/"
        else:
            path = "/"

        # Create folder
        folder_id = generate_uuid()
        folder = Folder(
            id=folder_id,
            name=request.name,
            owner_id=user.user_id,
            parent_id=request.parent_id,
            path=path,
        )
        session.add(folder)
        # Session commits automatically on exit

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data={
                "folder_id": folder_id,
                "name": request.name,
                "parent_id": request.parent_id,
                "path": path,
                "created_at": folder.created_at.isoformat(),
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

By default, folders with documents cannot be deleted.
Use the cascade parameter to delete all contents.

## Path Parameters
- **folder_id**: Folder identifier (UUID v4)

## Query Parameters
- **cascade**: Delete all documents in folder (default: false)

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/storage/folders/{folder_id}?cascade=true" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

# Supprimer un dossier avec son contenu
response = requests.delete(
    f"http://localhost:8000/api/v1/storage/folders/{folder_id}",
    params={"cascade": True},
    headers={"Authorization": "Bearer <token>"}
)
```

## Example (JavaScript)
```javascript
// Supprimer un dossier
const response = await fetch(
  `/api/v1/storage/folders/${folderId}?cascade=true`,
  {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer <token>' }
  }
);
```

## Example (PHP)
```php
// Supprimer un dossier
$client = new GuzzleHttp\\Client();
$response = $client->delete(
    "http://localhost:8000/api/v1/storage/folders/{$folderId}",
    [
        'headers' => ['Authorization' => 'Bearer <token>'],
        'query' => ['cascade' => true]
    ]
);
```
""",
    responses={
        200: {"description": "Folder deleted successfully"},
        400: {"description": "Folder not empty (use cascade=true)"},
        404: {"description": "Folder not found"},
    },
)
async def delete_folder(
    folder_id: str,
    user: AuthenticatedUser,
    cascade: bool = Query(default=False),
) -> APIResponse[dict]:
    """Delete folder."""
    start_time = time.time()

    from app.models.database import Folder, StoredDocument
    from app.core.database import get_db_session
    from sqlalchemy import select, func

    async with get_db_session() as session:
        # Get folder
        result = await session.execute(
            select(Folder).where(
                Folder.id == folder_id,
                Folder.owner_id == user.user_id,
            )
        )
        folder = result.scalar_one_or_none()

        if not folder:
            from app.middleware.error_handler import NotFoundError
            raise NotFoundError(f"Folder not found: {folder_id}")

        # Check if folder has documents
        count_result = await session.execute(
            select(func.count()).select_from(StoredDocument).where(
                StoredDocument.folder_id == folder_id,
                StoredDocument.is_deleted == False,
            )
        )
        doc_count = count_result.scalar() or 0

        if doc_count > 0 and not cascade:
            from app.middleware.error_handler import InvalidOperationError
            raise InvalidOperationError(
                f"Folder contains {doc_count} documents. Use cascade=true to delete all."
            )

        # Delete documents if cascade
        if cascade:
            docs_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.folder_id == folder_id
                )
            )
            docs = docs_result.scalars().all()
            for doc in docs:
                doc.is_deleted = True
                doc.deleted_at = now_utc()

        # Delete folder (cascade delete children via SQLAlchemy relationship)
        await session.delete(folder)
        # Session commits automatically on exit

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
