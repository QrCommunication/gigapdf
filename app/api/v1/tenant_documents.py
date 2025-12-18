"""
Tenant Document Sharing API.

Allows users to share their documents with tenant members.
Document owners retain ownership but can grant read or edit access
to other members of the same tenant.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload

from app.core.database import get_db_session
from app.middleware.request_id import get_request_id
from app.models.database import StoredDocument, UserQuota
from app.models.tenant import (
    Tenant,
    TenantMember,
    TenantDocument,
    TenantRole,
    TenantPermission,
    TenantStatus,
    ROLE_PERMISSIONS,
)
from app.schemas.responses.common import APIResponse, MetaInfo
from app.utils.helpers import now_utc

router = APIRouter()


# Pydantic schemas
class ShareDocumentRequest(BaseModel):
    """Request to share a document with tenant."""
    document_id: str = Field(description="Document UUID to share")
    access_level: str = Field(
        default="read",
        description="Access level: 'read' for view-only, 'write' for edit access"
    )


class SharedDocumentResponse(BaseModel):
    """Shared document response."""
    id: str
    document_id: str
    document_name: str
    access_level: str
    owner_id: str
    owner_email: Optional[str]
    shared_by_id: str
    shared_by_email: Optional[str]
    added_at: str
    file_size_bytes: int
    page_count: int


class TenantMembershipResponse(BaseModel):
    """User's tenant membership info."""
    tenant_id: str
    tenant_name: str
    tenant_slug: str
    role: str
    permissions: list[str]
    is_active: bool
    joined_at: str


class TenantDocumentListResponse(BaseModel):
    """List of shared documents in tenant."""
    documents: list[SharedDocumentResponse]
    total: int
    page: int
    page_size: int


# Helper function to get current user (you should replace with your actual auth)
async def get_current_user_id() -> str:
    """
    Get current authenticated user ID.
    Replace this with your actual authentication mechanism.
    """
    # This is a placeholder - integrate with your auth system
    # For now, we'll expect it to be passed via header or use a test user
    return "test-user-id"


async def get_user_quota_by_user_id(user_id: str) -> Optional[UserQuota]:
    """Get UserQuota by user_id string."""
    async with get_db_session() as session:
        stmt = select(UserQuota).where(UserQuota.user_id == user_id)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()


async def get_user_tenant_membership(
    user_quota_id: str, tenant_id: Optional[str] = None
) -> Optional[TenantMember]:
    """Get user's active tenant membership."""
    async with get_db_session() as session:
        stmt = (
            select(TenantMember)
            .options(selectinload(TenantMember.tenant))
            .where(
                and_(
                    TenantMember.user_id == user_quota_id,
                    TenantMember.is_active == True,
                )
            )
        )
        if tenant_id:
            stmt = stmt.where(TenantMember.tenant_id == tenant_id)

        result = await session.execute(stmt)
        return result.scalars().first()


def has_permission(membership: TenantMember, permission: TenantPermission) -> bool:
    """Check if member has a specific permission."""
    if membership.custom_permissions:
        return permission.value in membership.custom_permissions.split(",")
    role_perms = ROLE_PERMISSIONS.get(membership.role, [])
    return permission in role_perms


@router.get(
    "/my-tenants",
    response_model=APIResponse[list[TenantMembershipResponse]],
    summary="Get user's tenant memberships",
    description="""
Get all organizations/tenants the current user belongs to.

Returns tenant information along with user's role and permissions in each.
Used to display organization options in the user interface.

## Response Fields
- **tenant_id**: Organization UUID
- **tenant_name**: Organization display name
- **tenant_slug**: URL-friendly identifier
- **role**: User's role (owner, admin, manager, member, viewer)
- **permissions**: List of granted permissions
- **is_active**: Whether membership is active

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/tenant-documents/my-tenants?user_id=USER_ID" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    "http://localhost:8000/api/v1/tenant-documents/my-tenants",
    headers={"Authorization": f"Bearer {token}"},
    params={"user_id": user_id}
)
tenants = response.json()["data"]
for t in tenants:
    print(f"Organization: {t['tenant_name']} - Role: {t['role']}")
```

## Example (JavaScript)
```javascript
const response = await fetch(
  `http://localhost:8000/api/v1/tenant-documents/my-tenants?user_id=${userId}`,
  { headers: { 'Authorization': `Bearer ${token}` } }
);
const { data: tenants } = await response.json();
tenants.forEach(t => console.log(`${t.tenant_name}: ${t.role}`));
```

## Example (PHP)
```php
$ch = curl_init("http://localhost:8000/api/v1/tenant-documents/my-tenants?user_id={$user_id}");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"]
]);
$data = json_decode(curl_exec($ch), true);
$tenants = $data['data'];
```
""",
)
async def get_my_tenants(
    user_id: str = Query(..., description="User ID")
) -> APIResponse[list[TenantMembershipResponse]]:
    """Get all tenants the user belongs to."""
    user_quota = await get_user_quota_by_user_id(user_id)
    if not user_quota:
        return APIResponse(
            success=True,
            data=[],
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )

    async with get_db_session() as session:
        stmt = (
            select(TenantMember)
            .options(selectinload(TenantMember.tenant))
            .where(
                and_(
                    TenantMember.user_id == user_quota.id,
                    TenantMember.is_active == True,
                )
            )
        )
        result = await session.execute(stmt)
        memberships = result.scalars().all()

        response = []
        for m in memberships:
            if m.tenant.status != TenantStatus.ACTIVE:
                continue
            permissions = (
                m.custom_permissions.split(",") if m.custom_permissions
                else [p.value for p in ROLE_PERMISSIONS.get(m.role, [])]
            )
            response.append(TenantMembershipResponse(
                tenant_id=str(m.tenant_id),
                tenant_name=m.tenant.name,
                tenant_slug=m.tenant.slug,
                role=m.role.value,
                permissions=permissions,
                is_active=m.is_active,
                joined_at=m.joined_at.isoformat(),
            ))

        return APIResponse(
            success=True,
            data=response,
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.get(
    "/{tenant_id}/documents",
    response_model=APIResponse[TenantDocumentListResponse],
    summary="Get shared documents in tenant",
    description="""
Get all documents shared within an organization that the user can access.

Returns documents shared by all members, with access levels and owner information.
Supports pagination for large document collections.

## Response Fields
- **documents**: List of shared documents with metadata
- **total**: Total number of shared documents
- **page**: Current page number
- **page_size**: Items per page

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/tenant-documents/{tenant_id}/documents?user_id=USER_ID&page=1&page_size=20" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/tenant-documents/{tenant_id}/documents",
    headers={"Authorization": f"Bearer {token}"},
    params={"user_id": user_id, "page": 1, "page_size": 20}
)
data = response.json()["data"]
for doc in data["documents"]:
    print(f"{doc['document_name']} - {doc['access_level']} - Owner: {doc['owner_email']}")
```

## Example (JavaScript)
```javascript
const response = await fetch(
  `http://localhost:8000/api/v1/tenant-documents/${tenantId}/documents?user_id=${userId}`,
  { headers: { 'Authorization': `Bearer ${token}` } }
);
const { data } = await response.json();
data.documents.forEach(doc => {
  console.log(`${doc.document_name}: ${doc.access_level}`);
});
```

## Example (PHP)
```php
$ch = curl_init("http://localhost:8000/api/v1/tenant-documents/{$tenant_id}/documents?user_id={$user_id}");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"]
]);
$result = json_decode(curl_exec($ch), true);
$documents = $result['data']['documents'];
```
""",
)
async def get_tenant_documents(
    tenant_id: str,
    user_id: str = Query(..., description="User ID"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> APIResponse[TenantDocumentListResponse]:
    """Get all shared documents in a tenant."""
    user_quota = await get_user_quota_by_user_id(user_id)
    if not user_quota:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify user is a member of this tenant
    membership = await get_user_tenant_membership(user_quota.id, tenant_id)
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this tenant"
        )

    if not has_permission(membership, TenantPermission.VIEW_DOCUMENTS):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to view documents"
        )

    async with get_db_session() as session:
        # Count total
        count_stmt = select(TenantDocument).where(TenantDocument.tenant_id == tenant_id)
        count_result = await session.execute(count_stmt)
        total = len(count_result.scalars().all())

        # Get paginated documents
        offset = (page - 1) * page_size
        stmt = (
            select(TenantDocument)
            .options(
                selectinload(TenantDocument.document),
                selectinload(TenantDocument.added_by),
            )
            .where(TenantDocument.tenant_id == tenant_id)
            .order_by(TenantDocument.added_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        result = await session.execute(stmt)
        tenant_docs = result.scalars().all()

        # Get document owners
        doc_responses = []
        for td in tenant_docs:
            doc = td.document
            if not doc or doc.is_deleted:
                continue

            # Get owner info
            owner_stmt = select(UserQuota).where(UserQuota.user_id == doc.owner_id)
            owner_result = await session.execute(owner_stmt)
            owner = owner_result.scalar_one_or_none()

            doc_responses.append(SharedDocumentResponse(
                id=str(td.id),
                document_id=str(td.document_id),
                document_name=doc.name,
                access_level=td.access_level,
                owner_id=doc.owner_id,
                owner_email=owner.email if owner else None,
                shared_by_id=str(td.added_by_id),
                shared_by_email=td.added_by.email if td.added_by else None,
                added_at=td.added_at.isoformat(),
                file_size_bytes=doc.file_size_bytes,
                page_count=doc.page_count,
            ))

        return APIResponse(
            success=True,
            data=TenantDocumentListResponse(
                documents=doc_responses,
                total=total,
                page=page,
                page_size=page_size,
            ),
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.post(
    "/{tenant_id}/share",
    response_model=APIResponse[SharedDocumentResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Share document with organization",
    description="""
Share your document with all members of an organization.

**Important**: Only document owners can share their documents.
If the document is already shared, the access level will be updated.

## Access Levels
- **read**: Members can view but not modify the document
- **write**: Members can view and edit the document

## Request Body
- **document_id**: UUID of the document to share (must be owned by the user)
- **access_level**: Either 'read' or 'write'

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/tenant-documents/{tenant_id}/share?user_id=USER_ID" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"document_id": "uuid", "access_level": "read"}'
```

## Example (Python)
```python
import requests

# Share a document with read access
response = requests.post(
    f"http://localhost:8000/api/v1/tenant-documents/{tenant_id}/share",
    headers={"Authorization": f"Bearer {token}"},
    params={"user_id": user_id},
    json={
        "document_id": "document-uuid-here",
        "access_level": "read"  # or "write" for edit access
    }
)
shared_doc = response.json()["data"]
print(f"Shared: {shared_doc['document_name']}")
```

## Example (JavaScript)
```javascript
const response = await fetch(
  `http://localhost:8000/api/v1/tenant-documents/${tenantId}/share?user_id=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      document_id: documentId,
      access_level: 'write'
    })
  }
);
const { data: sharedDoc } = await response.json();
```

## Example (PHP)
```php
$ch = curl_init("http://localhost:8000/api/v1/tenant-documents/{$tenant_id}/share?user_id={$user_id}");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        "Authorization: Bearer {$token}"
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'document_id' => $document_id,
        'access_level' => 'read'
    ])
]);
$result = json_decode(curl_exec($ch), true);
```
""",
)
async def share_document_with_tenant(
    tenant_id: str,
    request: ShareDocumentRequest,
    user_id: str = Query(..., description="User ID"),
) -> APIResponse[SharedDocumentResponse]:
    """Share a document with tenant members."""
    user_quota = await get_user_quota_by_user_id(user_id)
    if not user_quota:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify user is a member of this tenant
    membership = await get_user_tenant_membership(user_quota.id, tenant_id)
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this tenant"
        )

    if not has_permission(membership, TenantPermission.SHARE_DOCUMENTS):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to share documents"
        )

    # Validate access level
    if request.access_level not in ["read", "write"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid access level. Must be 'read' or 'write'"
        )

    async with get_db_session() as session:
        # Get the document
        doc_stmt = select(StoredDocument).where(
            and_(
                StoredDocument.id == request.document_id,
                StoredDocument.is_deleted == False,
            )
        )
        doc_result = await session.execute(doc_stmt)
        document = doc_result.scalar_one_or_none()

        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not found"
            )

        # Verify user owns the document
        if document.owner_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only share documents you own"
            )

        # Check if already shared
        existing_stmt = select(TenantDocument).where(
            and_(
                TenantDocument.tenant_id == tenant_id,
                TenantDocument.document_id == request.document_id,
            )
        )
        existing_result = await session.execute(existing_stmt)
        existing = existing_result.scalar_one_or_none()

        if existing:
            # Update access level
            existing.access_level = request.access_level
            await session.commit()

            return APIResponse(
                success=True,
                data=SharedDocumentResponse(
                    id=str(existing.id),
                    document_id=str(existing.document_id),
                    document_name=document.name,
                    access_level=existing.access_level,
                    owner_id=document.owner_id,
                    owner_email=user_quota.email,
                    shared_by_id=str(existing.added_by_id),
                    shared_by_email=user_quota.email,
                    added_at=existing.added_at.isoformat(),
                    file_size_bytes=document.file_size_bytes,
                    page_count=document.page_count,
                ),
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        # Create new share
        tenant_doc = TenantDocument(
            id=uuid4(),
            tenant_id=tenant_id,
            document_id=request.document_id,
            added_by_id=user_quota.id,
            access_level=request.access_level,
            added_at=datetime.utcnow(),
        )
        session.add(tenant_doc)
        await session.commit()
        await session.refresh(tenant_doc)

        return APIResponse(
            success=True,
            data=SharedDocumentResponse(
                id=str(tenant_doc.id),
                document_id=str(tenant_doc.document_id),
                document_name=document.name,
                access_level=tenant_doc.access_level,
                owner_id=document.owner_id,
                owner_email=user_quota.email,
                shared_by_id=str(tenant_doc.added_by_id),
                shared_by_email=user_quota.email,
                added_at=tenant_doc.added_at.isoformat(),
                file_size_bytes=document.file_size_bytes,
                page_count=document.page_count,
            ),
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.delete(
    "/{tenant_id}/documents/{document_id}",
    response_model=APIResponse[dict],
    summary="Unshare document from tenant",
    description="""
Remove a document from tenant sharing.

Only the document owner or tenant admins can unshare documents.

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/tenant-documents/{tenant_id}/documents/{document_id}" \\
  -H "Authorization: Bearer <token>"
```
""",
)
async def unshare_document(
    tenant_id: str,
    document_id: str,
    user_id: str = Query(..., description="User ID"),
) -> APIResponse[dict]:
    """Remove document from tenant sharing."""
    user_quota = await get_user_quota_by_user_id(user_id)
    if not user_quota:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify user is a member of this tenant
    membership = await get_user_tenant_membership(user_quota.id, tenant_id)
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this tenant"
        )

    async with get_db_session() as session:
        # Get the shared document
        stmt = (
            select(TenantDocument)
            .options(selectinload(TenantDocument.document))
            .where(
                and_(
                    TenantDocument.tenant_id == tenant_id,
                    TenantDocument.document_id == document_id,
                )
            )
        )
        result = await session.execute(stmt)
        tenant_doc = result.scalar_one_or_none()

        if not tenant_doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not shared with this tenant"
            )

        # Check permission: must be owner or admin
        is_owner = tenant_doc.document and tenant_doc.document.owner_id == user_id
        is_admin = membership.role in [TenantRole.OWNER, TenantRole.ADMIN]

        if not is_owner and not is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the document owner or tenant admins can unshare"
            )

        doc_name = tenant_doc.document.name if tenant_doc.document else "Unknown"
        await session.delete(tenant_doc)
        await session.commit()

        return APIResponse(
            success=True,
            data={"message": f"Document '{doc_name}' removed from tenant sharing"},
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.patch(
    "/{tenant_id}/documents/{document_id}/access",
    response_model=APIResponse[SharedDocumentResponse],
    summary="Update document access level",
    description="""
Update the access level for a shared document.

Only the document owner can change access levels.

## Example (curl)
```bash
curl -X PATCH "http://localhost:8000/api/v1/tenant-documents/{tenant_id}/documents/{document_id}/access" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"access_level": "write"}'
```
""",
)
async def update_document_access(
    tenant_id: str,
    document_id: str,
    access_level: str = Query(..., description="New access level: 'read' or 'write'"),
    user_id: str = Query(..., description="User ID"),
) -> APIResponse[SharedDocumentResponse]:
    """Update access level for a shared document."""
    if access_level not in ["read", "write"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid access level. Must be 'read' or 'write'"
        )

    user_quota = await get_user_quota_by_user_id(user_id)
    if not user_quota:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    async with get_db_session() as session:
        # Get the shared document
        stmt = (
            select(TenantDocument)
            .options(selectinload(TenantDocument.document))
            .where(
                and_(
                    TenantDocument.tenant_id == tenant_id,
                    TenantDocument.document_id == document_id,
                )
            )
        )
        result = await session.execute(stmt)
        tenant_doc = result.scalar_one_or_none()

        if not tenant_doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not shared with this tenant"
            )

        # Verify user owns the document
        if not tenant_doc.document or tenant_doc.document.owner_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the document owner can change access level"
            )

        tenant_doc.access_level = access_level
        await session.commit()

        return APIResponse(
            success=True,
            data=SharedDocumentResponse(
                id=str(tenant_doc.id),
                document_id=str(tenant_doc.document_id),
                document_name=tenant_doc.document.name,
                access_level=tenant_doc.access_level,
                owner_id=tenant_doc.document.owner_id,
                owner_email=user_quota.email,
                shared_by_id=str(tenant_doc.added_by_id),
                shared_by_email=user_quota.email,
                added_at=tenant_doc.added_at.isoformat(),
                file_size_bytes=tenant_doc.document.file_size_bytes,
                page_count=tenant_doc.document.page_count,
            ),
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.get(
    "/{tenant_id}/can-access/{document_id}",
    response_model=APIResponse[dict],
    summary="Check document access",
    description="""
Check if user can access a document and at what level.

Returns access level ('none', 'read', 'write', 'owner') and permissions.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/tenant-documents/{tenant_id}/can-access/{document_id}?user_id=xxx" \\
  -H "Authorization: Bearer <token>"
```
""",
)
async def check_document_access(
    tenant_id: str,
    document_id: str,
    user_id: str = Query(..., description="User ID"),
) -> APIResponse[dict]:
    """Check what access level a user has for a document."""
    user_quota = await get_user_quota_by_user_id(user_id)
    if not user_quota:
        return APIResponse(
            success=True,
            data={
                "has_access": False,
                "access_level": "none",
                "can_view": False,
                "can_edit": False,
                "is_owner": False,
            },
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )

    async with get_db_session() as session:
        # Check if user owns the document
        doc_stmt = select(StoredDocument).where(
            and_(
                StoredDocument.id == document_id,
                StoredDocument.is_deleted == False,
            )
        )
        doc_result = await session.execute(doc_stmt)
        document = doc_result.scalar_one_or_none()

        if not document:
            return APIResponse(
                success=True,
                data={
                    "has_access": False,
                    "access_level": "none",
                    "can_view": False,
                    "can_edit": False,
                    "is_owner": False,
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        # Owner has full access
        if document.owner_id == user_id:
            return APIResponse(
                success=True,
                data={
                    "has_access": True,
                    "access_level": "owner",
                    "can_view": True,
                    "can_edit": True,
                    "is_owner": True,
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        # Check if user is member of tenant
        membership = await get_user_tenant_membership(user_quota.id, tenant_id)
        if not membership:
            return APIResponse(
                success=True,
                data={
                    "has_access": False,
                    "access_level": "none",
                    "can_view": False,
                    "can_edit": False,
                    "is_owner": False,
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        # Check if document is shared with tenant
        share_stmt = select(TenantDocument).where(
            and_(
                TenantDocument.tenant_id == tenant_id,
                TenantDocument.document_id == document_id,
            )
        )
        share_result = await session.execute(share_stmt)
        share = share_result.scalar_one_or_none()

        if not share:
            return APIResponse(
                success=True,
                data={
                    "has_access": False,
                    "access_level": "none",
                    "can_view": False,
                    "can_edit": False,
                    "is_owner": False,
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        can_view = has_permission(membership, TenantPermission.VIEW_DOCUMENTS)
        can_edit = share.access_level == "write" and has_permission(
            membership, TenantPermission.EDIT_DOCUMENTS
        )

        return APIResponse(
            success=True,
            data={
                "has_access": can_view,
                "access_level": share.access_level,
                "can_view": can_view,
                "can_edit": can_edit,
                "is_owner": False,
            },
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )
