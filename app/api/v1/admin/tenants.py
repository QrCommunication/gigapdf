"""
Admin API endpoints for tenant management.

Provides CRUD operations for tenants, member management, and permissions.
"""

import secrets
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.database import StoredDocument, UserQuota
from app.models.tenant import (
    Tenant,
    TenantDocument,
    TenantInvitation,
    TenantMember,
    TenantRole,
    TenantStatus,
)

router = APIRouter()


# ============== Pydantic Schemas ==============

class TenantCreate(BaseModel):
    """Schema for creating a new tenant."""
    name: str = Field(..., min_length=2, max_length=255)
    slug: str = Field(..., min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    email: EmailStr
    description: str | None = None
    phone: str | None = None
    website: str | None = None
    max_members: int = Field(default=5, ge=1, le=1000)
    storage_limit_bytes: int = Field(default=5 * 1024 * 1024 * 1024)  # 5GB


class TenantUpdate(BaseModel):
    """Schema for updating a tenant."""
    name: str | None = Field(None, min_length=2, max_length=255)
    description: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    website: str | None = None
    logo_url: str | None = None
    status: TenantStatus | None = None
    max_members: int | None = Field(None, ge=1, le=1000)
    storage_limit_bytes: int | None = None
    allow_member_invites: bool | None = None
    require_2fa: bool | None = None


class TenantResponse(BaseModel):
    """Schema for tenant response."""
    id: UUID
    name: str
    slug: str
    description: str | None
    logo_url: str | None
    email: str
    phone: str | None
    website: str | None
    status: TenantStatus
    member_count: int = 0
    document_count: int = 0
    storage_used_bytes: int
    storage_limit_bytes: int
    storage_used_formatted: str
    storage_limit_formatted: str
    storage_percentage: float
    max_members: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MemberCreate(BaseModel):
    """Schema for adding a member to a tenant."""
    user_id: UUID
    role: TenantRole = TenantRole.MEMBER


class MemberUpdate(BaseModel):
    """Schema for updating a member's role."""
    role: TenantRole | None = None
    is_active: bool | None = None
    custom_permissions: list[str] | None = None


class MemberResponse(BaseModel):
    """Schema for member response."""
    id: UUID
    user_id: UUID
    user_email: str | None
    role: TenantRole
    is_active: bool
    permissions: list[str]
    joined_at: datetime
    last_active_at: datetime | None

    class Config:
        from_attributes = True


class InvitationCreate(BaseModel):
    """Schema for creating an invitation."""
    email: EmailStr
    role: TenantRole = TenantRole.MEMBER
    expires_in_days: int = Field(default=7, ge=1, le=30)


class InvitationResponse(BaseModel):
    """Schema for invitation response."""
    id: UUID
    email: str
    role: TenantRole
    token: str
    is_accepted: bool
    expires_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True


class DocumentShareRequest(BaseModel):
    """Schema for sharing a document with a tenant."""
    document_id: UUID
    access_level: str = Field(default="read", pattern=r"^(read|write|admin)$")


class TenantDocumentResponse(BaseModel):
    """Schema for tenant document response."""
    id: UUID
    document_id: UUID
    document_name: str
    access_level: str
    added_by_email: str | None
    added_at: datetime

    class Config:
        from_attributes = True


# ============== Helper Functions ==============

def format_bytes(bytes_value: int) -> str:
    """Format bytes as human-readable string."""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if abs(bytes_value) < 1024:
            return f"{bytes_value:.1f} {unit}"
        bytes_value /= 1024
    return f"{bytes_value:.1f} PB"


# ============== Tenant Endpoints ==============

@router.get(
    "",
    response_model=dict,
    summary="List all tenants",
    description="""
List all organizations/tenants with pagination and optional filters.

## Parameters
- **page**: Page number (default: 1)
- **page_size**: Items per page (default: 20, max: 100)
- **status**: Filter by status (active, suspended, trial, cancelled)
- **search**: Search by name or email

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/admin/tenants?page=1&page_size=10" \\
  -H "Authorization: Bearer <admin_token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    "http://localhost:8000/api/v1/admin/tenants",
    headers={"Authorization": "Bearer <admin_token>"},
    params={"page": 1, "page_size": 10, "status": "active"}
)
tenants = response.json()["tenants"]
```

## Example (JavaScript)
```javascript
const response = await fetch(
  'http://localhost:8000/api/v1/admin/tenants?page=1&status=active',
  { headers: { 'Authorization': 'Bearer <admin_token>' } }
);
const { tenants } = await response.json();
```

## Example (PHP)
```php
$ch = curl_init('http://localhost:8000/api/v1/admin/tenants?page=1');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer <admin_token>']
]);
$data = json_decode(curl_exec($ch), true);
$tenants = $data['tenants'];
```
""",
)
async def list_tenants(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: TenantStatus | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List all tenants with pagination and filters."""
    query = select(Tenant)

    if status:
        query = query.where(Tenant.status == status)

    if search:
        search_term = f"%{search}%"
        query = query.where(
            (Tenant.name.ilike(search_term)) | (Tenant.email.ilike(search_term))
        )

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Get paginated results
    query = query.order_by(Tenant.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    tenants = result.scalars().all()

    # Get member and document counts for each tenant
    tenant_responses = []
    for tenant in tenants:
        # Count members
        member_count_query = select(func.count()).where(TenantMember.tenant_id == tenant.id)
        member_count = (await db.execute(member_count_query)).scalar() or 0

        # Count documents
        doc_count_query = select(func.count()).where(TenantDocument.tenant_id == tenant.id)
        doc_count = (await db.execute(doc_count_query)).scalar() or 0

        tenant_responses.append({
            "id": tenant.id,
            "name": tenant.name,
            "slug": tenant.slug,
            "description": tenant.description,
            "logo_url": tenant.logo_url,
            "email": tenant.email,
            "phone": tenant.phone,
            "website": tenant.website,
            "status": tenant.status,
            "member_count": member_count,
            "document_count": doc_count,
            "storage_used_bytes": tenant.storage_used_bytes,
            "storage_limit_bytes": tenant.storage_limit_bytes,
            "storage_used_formatted": format_bytes(tenant.storage_used_bytes),
            "storage_limit_formatted": format_bytes(tenant.storage_limit_bytes),
            "storage_percentage": (tenant.storage_used_bytes / tenant.storage_limit_bytes * 100) if tenant.storage_limit_bytes > 0 else 0,
            "max_members": tenant.max_members,
            "created_at": tenant.created_at,
            "updated_at": tenant.updated_at,
        })

    return {
        "tenants": tenant_responses,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.post(
    "",
    response_model=TenantResponse,
    status_code=201,
    summary="Create a new tenant/organization",
    description="""
Create a new organization/tenant. New tenants start with a 14-day trial period.

## Request Body
- **name**: Organization display name (required)
- **slug**: Unique URL-friendly identifier (required, lowercase alphanumeric and hyphens)
- **email**: Organization contact email (required)
- **description**: Organization description
- **phone**: Contact phone number
- **website**: Organization website URL
- **max_members**: Maximum allowed members (default: 5)
- **storage_limit_bytes**: Storage quota in bytes (default: 5GB)

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/admin/tenants" \\
  -H "Authorization: Bearer <admin_token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Acme Corporation",
    "slug": "acme-corp",
    "email": "contact@acme.com",
    "description": "Leading PDF solutions provider",
    "max_members": 10,
    "storage_limit_bytes": 10737418240
  }'
```

## Example (Python)
```python
import requests

response = requests.post(
    "http://localhost:8000/api/v1/admin/tenants",
    headers={"Authorization": "Bearer <admin_token>"},
    json={
        "name": "Acme Corporation",
        "slug": "acme-corp",
        "email": "contact@acme.com",
        "max_members": 10
    }
)
tenant = response.json()
```

## Example (JavaScript)
```javascript
const response = await fetch('http://localhost:8000/api/v1/admin/tenants', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <admin_token>'
  },
  body: JSON.stringify({
    name: 'Acme Corporation',
    slug: 'acme-corp',
    email: 'contact@acme.com'
  })
});
const tenant = await response.json();
```

## Example (PHP)
```php
$ch = curl_init('http://localhost:8000/api/v1/admin/tenants');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer <admin_token>'
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'name' => 'Acme Corporation',
        'slug' => 'acme-corp',
        'email' => 'contact@acme.com'
    ])
]);
$tenant = json_decode(curl_exec($ch), true);
```
""",
)
async def create_tenant(
    data: TenantCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new tenant."""
    # Check if slug already exists
    existing = await db.execute(select(Tenant).where(Tenant.slug == data.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Tenant with this slug already exists")

    tenant = Tenant(
        name=data.name,
        slug=data.slug,
        email=data.email,
        description=data.description,
        phone=data.phone,
        website=data.website,
        max_members=data.max_members,
        storage_limit_bytes=data.storage_limit_bytes,
        status=TenantStatus.TRIAL,
        trial_ends_at=datetime.utcnow() + timedelta(days=14),
    )
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)

    return TenantResponse(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        description=tenant.description,
        logo_url=tenant.logo_url,
        email=tenant.email,
        phone=tenant.phone,
        website=tenant.website,
        status=tenant.status,
        member_count=0,
        document_count=0,
        storage_used_bytes=tenant.storage_used_bytes,
        storage_limit_bytes=tenant.storage_limit_bytes,
        storage_used_formatted=format_bytes(tenant.storage_used_bytes),
        storage_limit_formatted=format_bytes(tenant.storage_limit_bytes),
        storage_percentage=0,
        max_members=tenant.max_members,
        created_at=tenant.created_at,
        updated_at=tenant.updated_at,
    )


@router.get(
    "/{tenant_id}",
    response_model=TenantResponse,
    summary="Get tenant by ID",
    description="""
Get detailed information about a specific organization/tenant.

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/admin/tenants/{tenant_id}" \\
  -H "Authorization: Bearer <admin_token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/admin/tenants/{tenant_id}",
    headers={"Authorization": "Bearer <admin_token>"}
)
tenant = response.json()
print(f"Tenant: {tenant['name']} - {tenant['member_count']} members")
```

## Example (JavaScript)
```javascript
const response = await fetch(`http://localhost:8000/api/v1/admin/tenants/${tenantId}`, {
  headers: { 'Authorization': 'Bearer <admin_token>' }
});
const tenant = await response.json();
```

## Example (PHP)
```php
$ch = curl_init("http://localhost:8000/api/v1/admin/tenants/{$tenant_id}");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer <admin_token>']
]);
$tenant = json_decode(curl_exec($ch), true);
```
""",
)
async def get_tenant(
    tenant_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific tenant by ID."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Count members and documents
    member_count = (await db.execute(
        select(func.count()).where(TenantMember.tenant_id == tenant.id)
    )).scalar() or 0

    doc_count = (await db.execute(
        select(func.count()).where(TenantDocument.tenant_id == tenant.id)
    )).scalar() or 0

    return TenantResponse(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        description=tenant.description,
        logo_url=tenant.logo_url,
        email=tenant.email,
        phone=tenant.phone,
        website=tenant.website,
        status=tenant.status,
        member_count=member_count,
        document_count=doc_count,
        storage_used_bytes=tenant.storage_used_bytes,
        storage_limit_bytes=tenant.storage_limit_bytes,
        storage_used_formatted=format_bytes(tenant.storage_used_bytes),
        storage_limit_formatted=format_bytes(tenant.storage_limit_bytes),
        storage_percentage=(tenant.storage_used_bytes / tenant.storage_limit_bytes * 100) if tenant.storage_limit_bytes > 0 else 0,
        max_members=tenant.max_members,
        created_at=tenant.created_at,
        updated_at=tenant.updated_at,
    )


@router.patch(
    "/{tenant_id}",
    response_model=TenantResponse,
    summary="Update a tenant",
    description="""
Update an organization/tenant's settings.

## Example (curl)
```bash
curl -X PATCH "http://localhost:8000/api/v1/admin/tenants/{tenant_id}" \\
  -H "Authorization: Bearer <admin_token>" \\
  -H "Content-Type: application/json" \\
  -d '{"max_members": 20, "status": "active"}'
```

## Example (Python)
```python
import requests

response = requests.patch(
    f"http://localhost:8000/api/v1/admin/tenants/{tenant_id}",
    headers={"Authorization": "Bearer <admin_token>"},
    json={"max_members": 20, "status": "active"}
)
```

## Example (JavaScript)
```javascript
await fetch(`http://localhost:8000/api/v1/admin/tenants/${tenantId}`, {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <admin_token>'
  },
  body: JSON.stringify({ max_members: 20, status: 'active' })
});
```

## Example (PHP)
```php
$ch = curl_init("http://localhost:8000/api/v1/admin/tenants/{$tenant_id}");
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => 'PATCH',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer <admin_token>'
    ],
    CURLOPT_POSTFIELDS => json_encode(['max_members' => 20])
]);
```
""",
)
async def update_tenant(
    tenant_id: UUID,
    data: TenantUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a tenant."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(tenant, key, value)

    await db.commit()
    await db.refresh(tenant)

    # Count members and documents
    member_count = (await db.execute(
        select(func.count()).where(TenantMember.tenant_id == tenant.id)
    )).scalar() or 0

    doc_count = (await db.execute(
        select(func.count()).where(TenantDocument.tenant_id == tenant.id)
    )).scalar() or 0

    return TenantResponse(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        description=tenant.description,
        logo_url=tenant.logo_url,
        email=tenant.email,
        phone=tenant.phone,
        website=tenant.website,
        status=tenant.status,
        member_count=member_count,
        document_count=doc_count,
        storage_used_bytes=tenant.storage_used_bytes,
        storage_limit_bytes=tenant.storage_limit_bytes,
        storage_used_formatted=format_bytes(tenant.storage_used_bytes),
        storage_limit_formatted=format_bytes(tenant.storage_limit_bytes),
        storage_percentage=(tenant.storage_used_bytes / tenant.storage_limit_bytes * 100) if tenant.storage_limit_bytes > 0 else 0,
        max_members=tenant.max_members,
        created_at=tenant.created_at,
        updated_at=tenant.updated_at,
    )


@router.delete(
    "/{tenant_id}",
    summary="Cancel/Delete a tenant",
    description="""
Cancel a tenant (soft delete). Sets status to 'cancelled' but preserves data.

## Example (curl)
```bash
curl -X DELETE "http://localhost:8000/api/v1/admin/tenants/{tenant_id}" \\
  -H "Authorization: Bearer <admin_token>"
```

## Example (Python)
```python
import requests
requests.delete(
    f"http://localhost:8000/api/v1/admin/tenants/{tenant_id}",
    headers={"Authorization": "Bearer <admin_token>"}
)
```
""",
)
async def delete_tenant(
    tenant_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a tenant (soft delete by setting status to cancelled)."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    tenant.status = TenantStatus.CANCELLED
    await db.commit()

    return {"success": True, "message": "Tenant has been cancelled"}


# ============== Member Endpoints ==============

@router.get(
    "/{tenant_id}/members",
    response_model=dict,
    summary="List tenant members",
    description="""
List all members of an organization with their roles and permissions.

## Roles
- **owner**: Full control, can delete organization
- **admin**: Can manage members and settings
- **manager**: Can manage documents and invitations
- **member**: Can view and edit shared documents
- **viewer**: Read-only access to shared documents

## Example (curl)
```bash
curl -X GET "http://localhost:8000/api/v1/admin/tenants/{tenant_id}/members" \\
  -H "Authorization: Bearer <admin_token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    f"http://localhost:8000/api/v1/admin/tenants/{tenant_id}/members",
    headers={"Authorization": "Bearer <admin_token>"}
)
members = response.json()["members"]
for m in members:
    print(f"{m['user_email']} - {m['role']}")
```

## Example (JavaScript)
```javascript
const response = await fetch(
  `http://localhost:8000/api/v1/admin/tenants/${tenantId}/members`,
  { headers: { 'Authorization': 'Bearer <admin_token>' } }
);
const { members } = await response.json();
```

## Example (PHP)
```php
$ch = curl_init("http://localhost:8000/api/v1/admin/tenants/{$tenant_id}/members");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer <admin_token>']
]);
$data = json_decode(curl_exec($ch), true);
```
""",
)
async def list_members(
    tenant_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List all members of a tenant."""
    # Verify tenant exists
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    query = (
        select(TenantMember)
        .where(TenantMember.tenant_id == tenant_id)
        .options(selectinload(TenantMember.user))
    )

    # Count total
    count_query = select(func.count()).where(TenantMember.tenant_id == tenant_id)
    total = (await db.execute(count_query)).scalar() or 0

    # Get paginated results
    query = query.order_by(TenantMember.joined_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    members = result.scalars().all()

    member_responses = []
    for member in members:
        permissions = [p.value for p in member.get_permissions()]
        member_responses.append({
            "id": member.id,
            "user_id": member.user_id,
            "user_email": member.user.email if member.user else None,
            "role": member.role,
            "is_active": member.is_active,
            "permissions": permissions,
            "joined_at": member.joined_at,
            "last_active_at": member.last_active_at,
        })

    return {
        "members": member_responses,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post(
    "/{tenant_id}/members",
    response_model=MemberResponse,
    status_code=201,
    summary="Add member to tenant",
    description=(
        "Add an existing GigaPDF user as a member of an organization.\n\n"
        "**Admin access required.** The user must already exist in the system. "
        "Returns 400 if the member limit is reached or the user is already a member.\n\n"
        "Available roles: `owner`, `admin`, `manager`, `member`, `viewer`."
    ),
    response_description="Created membership record with role and resolved permissions",
    responses={
        201: {"description": "Member added successfully"},
        400: {"description": "Member limit reached or user already a member"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required"},
        404: {"description": "Tenant or user not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {"lang": "curl", "label": "cURL", "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/members" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"user_id": "uuid-here", "role": "member"}\''},
            {"lang": "python", "label": "Python", "source": 'import requests\nresponse = requests.post(\n    f"https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/members",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n    json={"user_id": "uuid-here", "role": "member"},\n)\nmember = response.json()'},
            {"lang": "javascript", "label": "JavaScript", "source": 'const response = await fetch(`https://api.giga-pdf.com/api/v1/admin/tenants/${tenantId}/members`, {\n  method: "POST",\n  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ADMIN_TOKEN },\n  body: JSON.stringify({ user_id: "uuid-here", role: "member" }),\n});\nconst member = await response.json();'},
            {"lang": "php", "label": "PHP", "source": '<?php\n$ch = curl_init("https://api.giga-pdf.com/api/v1/admin/tenants/{$tenant_id}/members");\ncurl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["Content-Type: application/json", "Authorization: Bearer " . $adminToken], CURLOPT_POSTFIELDS => json_encode(["user_id" => "uuid-here", "role" => "member"])]);\n$member = json_decode(curl_exec($ch), true);'},
        ]
    },
)
async def add_member(
    tenant_id: UUID,
    data: MemberCreate,
    db: AsyncSession = Depends(get_db),
):
    """Add a member to a tenant."""
    # Verify tenant exists
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Check member limit
    member_count = (await db.execute(
        select(func.count()).where(TenantMember.tenant_id == tenant_id)
    )).scalar() or 0

    if member_count >= tenant.max_members:
        raise HTTPException(status_code=400, detail="Member limit reached")

    # Check if user exists
    user = (await db.execute(select(UserQuota).where(UserQuota.id == str(data.user_id)))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if already a member
    existing = (await db.execute(
        select(TenantMember).where(
            TenantMember.tenant_id == tenant_id,
            TenantMember.user_id == str(data.user_id)
        )
    )).scalar_one_or_none()

    if existing:
        raise HTTPException(status_code=400, detail="User is already a member")

    member = TenantMember(
        tenant_id=tenant_id,
        user_id=str(data.user_id),
        role=data.role,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)

    permissions = [p.value for p in member.get_permissions()]

    return MemberResponse(
        id=member.id,
        user_id=UUID(member.user_id),
        user_email=user.email,
        role=member.role,
        is_active=member.is_active,
        permissions=permissions,
        joined_at=member.joined_at,
        last_active_at=member.last_active_at,
    )


@router.patch(
    "/{tenant_id}/members/{member_id}",
    response_model=MemberResponse,
    summary="Update member role or status",
    description=(
        "Update a member's role, active status, or custom permissions within an organization.\n\n"
        "**Admin access required.** All fields are optional — only provided fields are updated. "
        "Use `is_active: false` to suspend a member without removing them. "
        "`custom_permissions` overrides role-default permissions with a specific list."
    ),
    response_description="Updated membership record with new role and resolved permissions",
    responses={
        200: {"description": "Member updated successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required"},
        404: {"description": "Member not found in this tenant"},
    },
    openapi_extra={
        "x-codeSamples": [
            {"lang": "curl", "label": "cURL", "source": 'curl -X PATCH "https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/members/{member_id}" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"role": "admin", "is_active": true}\''},
            {"lang": "python", "label": "Python", "source": 'import requests\nresponse = requests.patch(\n    f"https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/members/{member_id}",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n    json={"role": "admin"},\n)\nmember = response.json()'},
            {"lang": "javascript", "label": "JavaScript", "source": 'const response = await fetch(`https://api.giga-pdf.com/api/v1/admin/tenants/${tenantId}/members/${memberId}`, {\n  method: "PATCH",\n  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ADMIN_TOKEN },\n  body: JSON.stringify({ role: "admin" }),\n});\nconst member = await response.json();'},
            {"lang": "php", "label": "PHP", "source": '<?php\n$ch = curl_init("https://api.giga-pdf.com/api/v1/admin/tenants/{$tenant_id}/members/{$member_id}");\ncurl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => "PATCH", CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["Content-Type: application/json", "Authorization: Bearer " . $adminToken], CURLOPT_POSTFIELDS => json_encode(["role" => "admin"])]);\n$member = json_decode(curl_exec($ch), true);'},
        ]
    },
)
async def update_member(
    tenant_id: UUID,
    member_id: UUID,
    data: MemberUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a member's role or permissions."""
    result = await db.execute(
        select(TenantMember)
        .where(TenantMember.id == member_id, TenantMember.tenant_id == tenant_id)
        .options(selectinload(TenantMember.user))
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    if data.role is not None:
        member.role = data.role

    if data.is_active is not None:
        member.is_active = data.is_active

    if data.custom_permissions is not None:
        member.custom_permissions = ",".join(data.custom_permissions) if data.custom_permissions else None

    await db.commit()
    await db.refresh(member)

    permissions = [p.value for p in member.get_permissions()]

    return MemberResponse(
        id=member.id,
        user_id=UUID(member.user_id),
        user_email=member.user.email if member.user else None,
        role=member.role,
        is_active=member.is_active,
        permissions=permissions,
        joined_at=member.joined_at,
        last_active_at=member.last_active_at,
    )


@router.delete(
    "/{tenant_id}/members/{member_id}",
    summary="Remove member from tenant",
    description=(
        "Permanently remove a member from an organization.\n\n"
        "**Admin access required.** The last owner of a tenant cannot be removed — "
        "at least one owner must remain at all times. "
        "To temporarily revoke access without removing, use `PATCH` with `is_active: false`."
    ),
    response_description="Confirmation of member removal",
    responses={
        200: {"description": "Member removed successfully"},
        400: {"description": "Cannot remove the last owner"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required"},
        404: {"description": "Member not found in this tenant"},
    },
    openapi_extra={
        "x-codeSamples": [
            {"lang": "curl", "label": "cURL", "source": 'curl -X DELETE "https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/members/{member_id}" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"'},
            {"lang": "python", "label": "Python", "source": 'import requests\nresponse = requests.delete(\n    f"https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/members/{member_id}",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n)\nprint(response.json())'},
            {"lang": "javascript", "label": "JavaScript", "source": 'const response = await fetch(`https://api.giga-pdf.com/api/v1/admin/tenants/${tenantId}/members/${memberId}`, {\n  method: "DELETE",\n  headers: { "Authorization": "Bearer " + ADMIN_TOKEN },\n});\nconst result = await response.json();'},
            {"lang": "php", "label": "PHP", "source": '<?php\n$ch = curl_init("https://api.giga-pdf.com/api/v1/admin/tenants/{$tenant_id}/members/{$member_id}");\ncurl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => "DELETE", CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["Authorization: Bearer " . $adminToken]]);\n$result = json_decode(curl_exec($ch), true);'},
        ]
    },
)
async def remove_member(
    tenant_id: UUID,
    member_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Remove a member from a tenant."""
    result = await db.execute(
        select(TenantMember).where(TenantMember.id == member_id, TenantMember.tenant_id == tenant_id)
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Prevent removing the last owner
    if member.role == TenantRole.OWNER:
        owner_count = (await db.execute(
            select(func.count()).where(
                TenantMember.tenant_id == tenant_id,
                TenantMember.role == TenantRole.OWNER
            )
        )).scalar() or 0

        if owner_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last owner")

    await db.delete(member)
    await db.commit()

    return {"success": True, "message": "Member removed"}


# ============== Invitation Endpoints ==============

@router.get(
    "/{tenant_id}/invitations",
    response_model=dict,
    summary="List tenant invitations",
    description=(
        "List all invitations for an organization, optionally including already-accepted ones.\n\n"
        "**Admin access required.** By default only pending invitations are returned. "
        "Pass `include_accepted=true` to include invitations that have already been accepted. "
        "Each invitation includes its unique token, expiry date, and current status."
    ),
    response_description="List of invitations with token, role, and status",
    responses={
        200: {"description": "Invitations retrieved successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required"},
        404: {"description": "Tenant not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {"lang": "curl", "label": "cURL", "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/invitations" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"'},
            {"lang": "python", "label": "Python", "source": 'import requests\nresponse = requests.get(\n    f"https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/invitations",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n    params={"include_accepted": False},\n)\ninvitations = response.json()["invitations"]'},
            {"lang": "javascript", "label": "JavaScript", "source": 'const response = await fetch(`https://api.giga-pdf.com/api/v1/admin/tenants/${tenantId}/invitations`,\n  { headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n);\nconst { invitations } = await response.json();'},
            {"lang": "php", "label": "PHP", "source": '<?php\n$ch = curl_init("https://api.giga-pdf.com/api/v1/admin/tenants/{$tenant_id}/invitations");\ncurl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["Authorization: Bearer " . $adminToken]]);\n$data = json_decode(curl_exec($ch), true);'},
        ]
    },
)
async def list_invitations(
    tenant_id: UUID,
    include_accepted: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """List pending invitations for a tenant."""
    query = select(TenantInvitation).where(TenantInvitation.tenant_id == tenant_id)

    if not include_accepted:
        query = query.where(not TenantInvitation.is_accepted)

    result = await db.execute(query.order_by(TenantInvitation.created_at.desc()))
    invitations = result.scalars().all()

    return {
        "invitations": [
            {
                "id": inv.id,
                "email": inv.email,
                "role": inv.role,
                "token": inv.token,
                "is_accepted": inv.is_accepted,
                "is_expired": inv.is_expired,
                "expires_at": inv.expires_at,
                "created_at": inv.created_at,
            }
            for inv in invitations
        ]
    }


@router.post(
    "/{tenant_id}/invitations",
    response_model=InvitationResponse,
    status_code=201,
    summary="Create member invitation",
    description="""
Send an email invitation to join the organization.

The invitation includes a unique token that expires after the specified days.
When the invited user accepts, they become a member with the specified role.

## Example (curl)
```bash
curl -X POST "http://localhost:8000/api/v1/admin/tenants/{tenant_id}/invitations?invited_by_id={user_id}" \\
  -H "Authorization: Bearer <admin_token>" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "newmember@example.com", "role": "member", "expires_in_days": 7}'
```

## Example (Python)
```python
import requests

response = requests.post(
    f"http://localhost:8000/api/v1/admin/tenants/{tenant_id}/invitations",
    headers={"Authorization": "Bearer <admin_token>"},
    params={"invited_by_id": user_id},
    json={"email": "newmember@example.com", "role": "member"}
)
invitation = response.json()
print(f"Invitation token: {invitation['token']}")
```

## Example (JavaScript)
```javascript
const response = await fetch(
  `http://localhost:8000/api/v1/admin/tenants/${tenantId}/invitations?invited_by_id=${userId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer <admin_token>'
    },
    body: JSON.stringify({
      email: 'newmember@example.com',
      role: 'member'
    })
  }
);
```

## Example (PHP)
```php
$ch = curl_init("http://localhost:8000/api/v1/admin/tenants/{$tenant_id}/invitations?invited_by_id={$user_id}");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer <admin_token>'
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'email' => 'newmember@example.com',
        'role' => 'member'
    ])
]);
```
""",
)
async def create_invitation(
    tenant_id: UUID,
    data: InvitationCreate,
    invited_by_id: UUID = Query(..., description="ID of the user sending the invitation"),
    db: AsyncSession = Depends(get_db),
):
    """Create an invitation to join a tenant."""
    # Verify tenant exists
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Check if email already has pending invitation
    existing = (await db.execute(
        select(TenantInvitation).where(
            TenantInvitation.tenant_id == tenant_id,
            TenantInvitation.email == data.email,
            not TenantInvitation.is_accepted
        )
    )).scalar_one_or_none()

    if existing and not existing.is_expired:
        raise HTTPException(status_code=400, detail="Invitation already pending for this email")

    invitation = TenantInvitation(
        tenant_id=tenant_id,
        email=data.email,
        role=data.role,
        token=secrets.token_urlsafe(32),
        invited_by_id=str(invited_by_id),
        expires_at=datetime.utcnow() + timedelta(days=data.expires_in_days),
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    return InvitationResponse(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        token=invitation.token,
        is_accepted=invitation.is_accepted,
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
    )


@router.delete(
    "/{tenant_id}/invitations/{invitation_id}",
    summary="Cancel a pending invitation",
    description=(
        "Permanently delete a pending invitation, preventing the invited user from joining.\n\n"
        "**Admin access required.** Once cancelled, the invitation token becomes invalid. "
        "This action cannot be undone — create a new invitation if needed. "
        "Returns 404 if the invitation does not belong to the specified tenant."
    ),
    response_description="Confirmation of invitation cancellation",
    responses={
        200: {"description": "Invitation cancelled successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required"},
        404: {"description": "Invitation not found for this tenant"},
    },
    openapi_extra={
        "x-codeSamples": [
            {"lang": "curl", "label": "cURL", "source": 'curl -X DELETE "https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/invitations/{invitation_id}" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"'},
            {"lang": "python", "label": "Python", "source": 'import requests\nresponse = requests.delete(\n    f"https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/invitations/{invitation_id}",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n)\nprint(response.json())'},
            {"lang": "javascript", "label": "JavaScript", "source": 'await fetch(`https://api.giga-pdf.com/api/v1/admin/tenants/${tenantId}/invitations/${invitationId}`, {\n  method: "DELETE",\n  headers: { "Authorization": "Bearer " + ADMIN_TOKEN },\n});'},
            {"lang": "php", "label": "PHP", "source": '<?php\n$ch = curl_init("https://api.giga-pdf.com/api/v1/admin/tenants/{$tenant_id}/invitations/{$invitation_id}");\ncurl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => "DELETE", CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["Authorization: Bearer " . $adminToken]]);\n$result = json_decode(curl_exec($ch), true);'},
        ]
    },
)
async def cancel_invitation(
    tenant_id: UUID,
    invitation_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Cancel a pending invitation."""
    result = await db.execute(
        select(TenantInvitation).where(
            TenantInvitation.id == invitation_id,
            TenantInvitation.tenant_id == tenant_id
        )
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    await db.delete(invitation)
    await db.commit()

    return {"success": True, "message": "Invitation cancelled"}


# ============== Document Endpoints ==============

@router.get(
    "/{tenant_id}/documents",
    response_model=dict,
    summary="List documents shared with tenant",
    description=(
        "Retrieve a paginated list of documents that have been shared with an organization.\n\n"
        "**Admin access required.** Returns document name, access level (`read`, `write`, `admin`), "
        "the email of the user who shared it, and the sharing timestamp. "
        "Results are ordered by most recently shared first."
    ),
    response_description="Paginated list of shared documents with access level details",
    responses={
        200: {"description": "Documents retrieved successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required"},
        404: {"description": "Tenant not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {"lang": "curl", "label": "cURL", "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/documents?page=1&page_size=20" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"'},
            {"lang": "python", "label": "Python", "source": 'import requests\nresponse = requests.get(\n    f"https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/documents",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n    params={"page": 1, "page_size": 20},\n)\ndocs = response.json()["documents"]'},
            {"lang": "javascript", "label": "JavaScript", "source": 'const response = await fetch(`https://api.giga-pdf.com/api/v1/admin/tenants/${tenantId}/documents?page=1`,\n  { headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n);\nconst { documents } = await response.json();'},
            {"lang": "php", "label": "PHP", "source": '<?php\n$ch = curl_init("https://api.giga-pdf.com/api/v1/admin/tenants/{$tenant_id}/documents?page=1");\ncurl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["Authorization: Bearer " . $adminToken]]);\n$data = json_decode(curl_exec($ch), true);'},
        ]
    },
)
async def list_tenant_documents(
    tenant_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List all documents shared with a tenant."""
    # Verify tenant exists
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    query = (
        select(TenantDocument)
        .where(TenantDocument.tenant_id == tenant_id)
        .options(
            selectinload(TenantDocument.document),
            selectinload(TenantDocument.added_by)
        )
    )

    # Count total
    count_query = select(func.count()).where(TenantDocument.tenant_id == tenant_id)
    total = (await db.execute(count_query)).scalar() or 0

    # Get paginated results
    query = query.order_by(TenantDocument.added_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    tenant_docs = result.scalars().all()

    doc_responses = []
    for td in tenant_docs:
        doc_responses.append({
            "id": td.id,
            "document_id": UUID(td.document_id),
            "document_name": td.document.name if td.document else "Unknown",
            "access_level": td.access_level,
            "added_by_email": td.added_by.email if td.added_by else None,
            "added_at": td.added_at,
        })

    return {
        "documents": doc_responses,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post(
    "/{tenant_id}/documents",
    response_model=TenantDocumentResponse,
    status_code=201,
    summary="Share document with tenant",
    description=(
        "Grant an organization access to a specific document.\n\n"
        "**Admin access required.** Both the tenant and the document must exist. "
        "The `access_level` field controls what organization members can do: "
        "`read` (view only), `write` (edit), or `admin` (full control). "
        "Returns 400 if the document is already shared with this tenant.\n\n"
        "**Query parameter:** `added_by_id` — ID of the user performing the share (required)."
    ),
    response_description="Sharing record with document name and access level",
    responses={
        201: {"description": "Document shared successfully"},
        400: {"description": "Document already shared with this tenant"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required"},
        404: {"description": "Tenant or document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {"lang": "curl", "label": "cURL", "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/documents?added_by_id={user_id}" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"document_id": "uuid-here", "access_level": "read"}\''},
            {"lang": "python", "label": "Python", "source": 'import requests\nresponse = requests.post(\n    f"https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/documents",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n    params={"added_by_id": user_id},\n    json={"document_id": "uuid-here", "access_level": "read"},\n)\nshare = response.json()'},
            {"lang": "javascript", "label": "JavaScript", "source": 'const response = await fetch(`https://api.giga-pdf.com/api/v1/admin/tenants/${tenantId}/documents?added_by_id=${userId}`, {\n  method: "POST",\n  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ADMIN_TOKEN },\n  body: JSON.stringify({ document_id: "uuid-here", access_level: "read" }),\n});\nconst share = await response.json();'},
            {"lang": "php", "label": "PHP", "source": '<?php\n$ch = curl_init("https://api.giga-pdf.com/api/v1/admin/tenants/{$tenant_id}/documents?added_by_id={$userId}");\ncurl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["Content-Type: application/json", "Authorization: Bearer " . $adminToken], CURLOPT_POSTFIELDS => json_encode(["document_id" => "uuid-here", "access_level" => "read"])]);\n$share = json_decode(curl_exec($ch), true);'},
        ]
    },
)
async def share_document_with_tenant(
    tenant_id: UUID,
    data: DocumentShareRequest,
    added_by_id: UUID = Query(..., description="ID of the user sharing the document"),
    db: AsyncSession = Depends(get_db),
):
    """Share a document with a tenant."""
    # Verify tenant exists
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Verify document exists
    document = (await db.execute(
        select(StoredDocument).where(StoredDocument.id == str(data.document_id))
    )).scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    # Check if already shared
    existing = (await db.execute(
        select(TenantDocument).where(
            TenantDocument.tenant_id == tenant_id,
            TenantDocument.document_id == str(data.document_id)
        )
    )).scalar_one_or_none()

    if existing:
        raise HTTPException(status_code=400, detail="Document already shared with this tenant")

    tenant_doc = TenantDocument(
        tenant_id=tenant_id,
        document_id=str(data.document_id),
        added_by_id=str(added_by_id),
        access_level=data.access_level,
    )
    db.add(tenant_doc)
    await db.commit()
    await db.refresh(tenant_doc)

    # Get added_by user email
    user = (await db.execute(select(UserQuota).where(UserQuota.id == str(added_by_id)))).scalar_one_or_none()

    return TenantDocumentResponse(
        id=tenant_doc.id,
        document_id=data.document_id,
        document_name=document.name,
        access_level=tenant_doc.access_level,
        added_by_email=user.email if user else None,
        added_at=tenant_doc.added_at,
    )


@router.delete(
    "/{tenant_id}/documents/{document_id}",
    summary="Unshare document from tenant",
    description=(
        "Revoke an organization's access to a previously shared document.\n\n"
        "**Admin access required.** The document is not deleted — only the sharing link "
        "between the tenant and the document is removed. Organization members will immediately "
        "lose access. Returns 404 if the document was not shared with this tenant."
    ),
    response_description="Confirmation of document unsharing",
    responses={
        200: {"description": "Document unshared successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required"},
        404: {"description": "Document not shared with this tenant"},
    },
    openapi_extra={
        "x-codeSamples": [
            {"lang": "curl", "label": "cURL", "source": 'curl -X DELETE "https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/documents/{document_id}" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"'},
            {"lang": "python", "label": "Python", "source": 'import requests\nresponse = requests.delete(\n    f"https://api.giga-pdf.com/api/v1/admin/tenants/{tenant_id}/documents/{document_id}",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n)\nprint(response.json())'},
            {"lang": "javascript", "label": "JavaScript", "source": 'await fetch(`https://api.giga-pdf.com/api/v1/admin/tenants/${tenantId}/documents/${documentId}`, {\n  method: "DELETE",\n  headers: { "Authorization": "Bearer " + ADMIN_TOKEN },\n});'},
            {"lang": "php", "label": "PHP", "source": '<?php\n$ch = curl_init("https://api.giga-pdf.com/api/v1/admin/tenants/{$tenant_id}/documents/{$document_id}");\ncurl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => "DELETE", CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["Authorization: Bearer " . $adminToken]]);\n$result = json_decode(curl_exec($ch), true);'},
        ]
    },
)
async def unshare_document(
    tenant_id: UUID,
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Remove a document from a tenant."""
    result = await db.execute(
        select(TenantDocument).where(
            TenantDocument.tenant_id == tenant_id,
            TenantDocument.document_id == str(document_id)
        )
    )
    tenant_doc = result.scalar_one_or_none()

    if not tenant_doc:
        raise HTTPException(status_code=404, detail="Document not shared with this tenant")

    await db.delete(tenant_doc)
    await db.commit()

    return {"success": True, "message": "Document removed from tenant"}


# ============== Stats Endpoint ==============

@router.get(
    "/stats/overview",
    summary="Get tenant overview statistics",
    description=(
        "Retrieve aggregated statistics across all tenants on the platform.\n\n"
        "**Admin access required.** Returns total tenant counts broken down by status "
        "(active, trial, suspended), total members across all organizations, "
        "and combined storage usage (bytes and human-readable format).\n\n"
        "Useful for dashboard KPIs and platform health monitoring."
    ),
    response_description="Aggregated platform statistics: tenant counts, members, storage",
    responses={
        200: {"description": "Platform-wide tenant statistics"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {"lang": "curl", "label": "cURL", "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/admin/tenants/stats/overview" \\\n  -H "Authorization: Bearer $ADMIN_TOKEN"'},
            {"lang": "python", "label": "Python", "source": 'import requests\nresponse = requests.get(\n    "https://api.giga-pdf.com/api/v1/admin/tenants/stats/overview",\n    headers={"Authorization": "Bearer $ADMIN_TOKEN"},\n)\nstats = response.json()\nprint(f"Active: {stats[\'active_tenants\']} / Total: {stats[\'total_tenants\']}")'},
            {"lang": "javascript", "label": "JavaScript", "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/admin/tenants/stats/overview",\n  { headers: { "Authorization": "Bearer " + ADMIN_TOKEN } }\n);\nconst stats = await response.json();\nconsole.log(`Active: ${stats.active_tenants} / Total: ${stats.total_tenants}`);'},
            {"lang": "php", "label": "PHP", "source": '<?php\n$ch = curl_init("https://api.giga-pdf.com/api/v1/admin/tenants/stats/overview");\ncurl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["Authorization: Bearer " . $adminToken]]);\n$stats = json_decode(curl_exec($ch), true);\necho $stats["active_tenants"] . "/" . $stats["total_tenants"];'},
        ]
    },
)
async def get_tenant_stats(
    db: AsyncSession = Depends(get_db),
):
    """Get overview statistics for all tenants."""
    total_tenants = (await db.execute(select(func.count()).select_from(Tenant))).scalar() or 0
    active_tenants = (await db.execute(
        select(func.count()).where(Tenant.status == TenantStatus.ACTIVE)
    )).scalar() or 0
    trial_tenants = (await db.execute(
        select(func.count()).where(Tenant.status == TenantStatus.TRIAL)
    )).scalar() or 0
    suspended_tenants = (await db.execute(
        select(func.count()).where(Tenant.status == TenantStatus.SUSPENDED)
    )).scalar() or 0

    total_members = (await db.execute(select(func.count()).select_from(TenantMember))).scalar() or 0
    total_storage = (await db.execute(select(func.sum(Tenant.storage_used_bytes)))).scalar() or 0

    return {
        "total_tenants": total_tenants,
        "active_tenants": active_tenants,
        "trial_tenants": trial_tenants,
        "suspended_tenants": suspended_tenants,
        "total_members": total_members,
        "total_storage_bytes": total_storage,
        "total_storage_formatted": format_bytes(total_storage),
    }
