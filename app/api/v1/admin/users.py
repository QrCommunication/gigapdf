"""
Admin users management endpoints.

Provides user management for the admin panel.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.database import StoredDocument, UserQuota

router = APIRouter()


class UserResponse(BaseModel):
    """User response model."""
    id: str
    email: str | None = None
    name: str | None = None
    plan_type: str
    storage_used_bytes: int
    storage_limit_bytes: int
    storage_used_formatted: str
    storage_limit_formatted: str
    document_count: int
    api_calls_used: int
    api_calls_limit: int
    status: str  # active, suspended, pending
    created_at: datetime | None = None
    updated_at: datetime


class UserListResponse(BaseModel):
    """Paginated user list response."""
    users: list[UserResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class UserUpdateRequest(BaseModel):
    """User update request."""
    plan_type: str | None = None
    storage_limit_bytes: int | None = None
    api_calls_limit: int | None = None
    document_limit: int | None = None
    status: str | None = None


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


@router.get(
    "",
    response_model=UserListResponse,
    summary="List all users",
    description="""
Retrieve a paginated list of all registered users on the GigaPDF platform.

**Admin access required.** Supports the following query parameters:

| Parameter | Description |
|-----------|-------------|
| `page` | Page number (starts at 1) |
| `page_size` | Number of users per page (1–100, default 20) |
| `search` | Filter by partial user ID match (case-insensitive) |
| `plan_type` | Filter by plan: `free`, `pro`, or `enterprise` |
| `status` | Filter by account status: `active` or `expired` |

Results are sorted by last update date (newest first). Each user entry includes
quota information (storage, API calls, document count) and their current plan.
""",
    response_description="Paginated list of users with quota and plan details",
    responses={
        200: {"description": "User list returned successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        422: {"description": "Invalid pagination or filter parameters"},
        500: {"description": "Internal server error while fetching users"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/users?page=1&page_size=20&plan_type=pro" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "response = requests.get(\n"
                    '    "https://api.giga-pdf.com/api/v1/admin/users",\n'
                    '    params={"page": 1, "page_size": 20, "plan_type": "pro"},\n'
                    '    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},\n'
                    ")\n"
                    "data = response.json()\n"
                    'print(f"Total users: {data[\'total\']}, Pages: {data[\'total_pages\']}")\n'
                    "for user in data['users']:\n"
                    '    print(f"  {user[\'id\']} — {user[\'plan_type\']} — {user[\'status\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const params = new URLSearchParams({ page: 1, page_size: 20, plan_type: 'pro' });\n"
                    "const response = await fetch(\n"
                    '  `https://api.giga-pdf.com/api/v1/admin/users?${params}`,\n'
                    "  {\n"
                    '    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` },\n'
                    "  }\n"
                    ");\n"
                    "const { users, total, total_pages } = await response.json();\n"
                    "console.log(`Total: ${total}, Pages: ${total_pages}`);\n"
                    "users.forEach(u => console.log(`${u.id} — ${u.plan_type}`));"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/users',\n"
                    "    [\n"
                    "        'query' => ['page' => 1, 'page_size' => 20, 'plan_type' => 'pro'],\n"
                    "        'headers' => ['Authorization' => 'Bearer ' . $adminToken],\n"
                    "    ]\n"
                    ");\n"
                    "$data = json_decode($response->getBody(), true);\n"
                    "echo 'Total users: ' . $data['total'] . '\\n';\n"
                    "foreach ($data['users'] as $user) {\n"
                    "    echo $user['id'] . ' — ' . $user['plan_type'] . '\\n';\n"
                    "}"
                ),
            },
        ],
    },
)
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    plan_type: str | None = Query(None),
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    List all users with pagination and filtering.

    Supports filtering by plan type and search by user ID.
    """
    # Build query
    query = select(UserQuota)

    # Apply filters
    if search:
        query = query.where(UserQuota.user_id.ilike(f"%{search}%"))

    if plan_type:
        query = query.where(UserQuota.plan_type == plan_type)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(UserQuota.updated_at.desc())

    # Execute query
    result = await db.execute(query)
    quotas = result.scalars().all()

    # Build response
    users = []
    for quota in quotas:
        # Determine status based on plan expiry
        user_status = "active"
        if quota.plan_expires_at and quota.plan_expires_at < datetime.now():
            user_status = "expired"

        users.append(UserResponse(
            id=quota.user_id,
            plan_type=quota.plan_type,
            storage_used_bytes=quota.storage_used_bytes,
            storage_limit_bytes=quota.storage_limit_bytes,
            storage_used_formatted=format_bytes(quota.storage_used_bytes),
            storage_limit_formatted=format_bytes(quota.storage_limit_bytes),
            document_count=quota.document_count,
            api_calls_used=quota.api_calls_used,
            api_calls_limit=quota.api_calls_limit,
            status=user_status,
            updated_at=quota.updated_at,
        ))

    total_pages = (total + page_size - 1) // page_size

    return UserListResponse(
        users=users,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{user_id}",
    response_model=UserResponse,
    summary="Get a user's details",
    description="""
Retrieve the full profile and quota information for a specific user.

**Admin access required.** Provide the user's unique `user_id` as a path
parameter. The response includes:
- Current plan (`free`, `pro`, `enterprise`)
- Storage consumed vs. allocated (raw bytes + formatted strings)
- API call usage vs. limit
- Document count
- Account status (`active` or `expired`)

Returns `404` if no user with the given ID exists.
""",
    response_description="Full user profile with quota and plan details",
    responses={
        200: {"description": "User details returned successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "User not found"},
        500: {"description": "Internal server error while fetching user"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/users/usr_abc123" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "user_id = 'usr_abc123'\n"
                    "response = requests.get(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/users/{user_id}",\n'
                    '    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},\n'
                    ")\n"
                    "user = response.json()\n"
                    'print(f"Plan: {user[\'plan_type\']}, Status: {user[\'status\']}")\n'
                    'print(f"Storage: {user[\'storage_used_formatted\']} / {user[\'storage_limit_formatted\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const userId = 'usr_abc123';\n"
                    "const response = await fetch(\n"
                    '  `https://api.giga-pdf.com/api/v1/admin/users/${userId}`,\n'
                    "  {\n"
                    '    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` },\n'
                    "  }\n"
                    ");\n"
                    "const user = await response.json();\n"
                    "console.log(`Plan: ${user.plan_type}, Status: ${user.status}`);\n"
                    "console.log(`Storage: ${user.storage_used_formatted} / ${user.storage_limit_formatted}`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$userId = 'usr_abc123';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/users/' . $userId,\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$user = json_decode($response->getBody(), true);\n"
                    "echo 'Plan: ' . $user['plan_type'] . ', Status: ' . $user['status'] . '\\n';"
                ),
            },
        ],
    },
)
async def get_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get a specific user's details.
    """
    result = await db.execute(
        select(UserQuota).where(UserQuota.user_id == user_id)
    )
    quota = result.scalar_one_or_none()

    if not quota:
        raise HTTPException(status_code=404, detail="User not found")

    user_status = "active"
    if quota.plan_expires_at and quota.plan_expires_at < datetime.now():
        user_status = "expired"

    return UserResponse(
        id=quota.user_id,
        plan_type=quota.plan_type,
        storage_used_bytes=quota.storage_used_bytes,
        storage_limit_bytes=quota.storage_limit_bytes,
        storage_used_formatted=format_bytes(quota.storage_used_bytes),
        storage_limit_formatted=format_bytes(quota.storage_limit_bytes),
        document_count=quota.document_count,
        api_calls_used=quota.api_calls_used,
        api_calls_limit=quota.api_calls_limit,
        status=user_status,
        updated_at=quota.updated_at,
    )


@router.patch(
    "/{user_id}",
    response_model=UserResponse,
    summary="Update a user's quota or plan",
    description="""
Partially update a user's quota limits or subscription plan.

**Admin access required.** All fields in the request body are optional — only
the provided fields will be updated (PATCH semantics). Updatable fields:

| Field | Description |
|-------|-------------|
| `plan_type` | Change plan: `free`, `pro`, `enterprise` |
| `storage_limit_bytes` | Override the storage cap in bytes |
| `api_calls_limit` | Override the monthly API call cap |
| `document_limit` | Override the maximum document count |
| `status` | Manually set account status |

Returns the full updated user profile after persisting the changes.
Returns `404` if no user with the given ID exists.
""",
    response_description="Updated user profile with new quota and plan details",
    responses={
        200: {"description": "User updated successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "User not found"},
        422: {"description": "Invalid field values in request body"},
        500: {"description": "Internal server error while updating user"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X PATCH "https://api.giga-pdf.com/api/v1/admin/users/usr_abc123" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN" \\\n'
                    '  -H "Content-Type: application/json" \\\n'
                    '  -d \'{"plan_type": "enterprise", "storage_limit_bytes": 107374182400}\''
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "user_id = 'usr_abc123'\n"
                    "response = requests.patch(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/users/{user_id}",\n'
                    '    json={"plan_type": "enterprise", "storage_limit_bytes": 107374182400},\n'
                    '    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},\n'
                    ")\n"
                    "updated = response.json()\n"
                    'print(f"New plan: {updated[\'plan_type\']}, Storage limit: {updated[\'storage_limit_formatted\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const userId = 'usr_abc123';\n"
                    "const response = await fetch(\n"
                    '  `https://api.giga-pdf.com/api/v1/admin/users/${userId}`,\n'
                    "  {\n"
                    '    method: "PATCH",\n'
                    '    headers: {\n'
                    '      "Authorization": `Bearer ${ADMIN_TOKEN}`,\n'
                    '      "Content-Type": "application/json",\n'
                    "    },\n"
                    '    body: JSON.stringify({ plan_type: "enterprise", storage_limit_bytes: 107374182400 }),\n'
                    "  }\n"
                    ");\n"
                    "const updated = await response.json();\n"
                    "console.log(`New plan: ${updated.plan_type}`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$userId = 'usr_abc123';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->patch(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/users/' . $userId,\n"
                    "    [\n"
                    "        'json' => ['plan_type' => 'enterprise', 'storage_limit_bytes' => 107374182400],\n"
                    "        'headers' => ['Authorization' => 'Bearer ' . $adminToken],\n"
                    "    ]\n"
                    ");\n"
                    "$updated = json_decode($response->getBody(), true);\n"
                    "echo 'New plan: ' . $updated['plan_type'] . '\\n';"
                ),
            },
        ],
    },
)
async def update_user(
    user_id: str,
    update: UserUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Update a user's quota or status.
    """
    result = await db.execute(
        select(UserQuota).where(UserQuota.user_id == user_id)
    )
    quota = result.scalar_one_or_none()

    if not quota:
        raise HTTPException(status_code=404, detail="User not found")

    # Apply updates
    if update.plan_type is not None:
        quota.plan_type = update.plan_type

    if update.storage_limit_bytes is not None:
        quota.storage_limit_bytes = update.storage_limit_bytes

    if update.api_calls_limit is not None:
        quota.api_calls_limit = update.api_calls_limit

    if update.document_limit is not None:
        quota.document_limit = update.document_limit

    await db.commit()
    await db.refresh(quota)

    user_status = "active"
    if quota.plan_expires_at and quota.plan_expires_at < datetime.now():
        user_status = "expired"

    return UserResponse(
        id=quota.user_id,
        plan_type=quota.plan_type,
        storage_used_bytes=quota.storage_used_bytes,
        storage_limit_bytes=quota.storage_limit_bytes,
        storage_used_formatted=format_bytes(quota.storage_used_bytes),
        storage_limit_formatted=format_bytes(quota.storage_limit_bytes),
        document_count=quota.document_count,
        api_calls_used=quota.api_calls_used,
        api_calls_limit=quota.api_calls_limit,
        status=user_status,
        updated_at=quota.updated_at,
    )


@router.delete(
    "/{user_id}",
    summary="Delete a user",
    description="""
Permanently delete a user's quota record from the platform.

**Admin access required.** This operation removes the user's `UserQuota` entry,
which includes their plan, storage, and API call counters.

> **Warning:** This action is **irreversible**. The user's documents are **not**
> automatically deleted by this endpoint — handle document cleanup separately
> before or after calling this endpoint to avoid orphaned storage entries.

Returns `404` if no user with the given ID exists.
""",
    response_description="Confirmation message with the deleted user ID",
    responses={
        200: {"description": "User deleted successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "User not found"},
        500: {"description": "Internal server error while deleting user"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X DELETE "https://api.giga-pdf.com/api/v1/admin/users/usr_abc123" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "user_id = 'usr_abc123'\n"
                    "response = requests.delete(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/users/{user_id}",\n'
                    '    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},\n'
                    ")\n"
                    "print(response.json()['message'])"
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const userId = 'usr_abc123';\n"
                    "const response = await fetch(\n"
                    '  `https://api.giga-pdf.com/api/v1/admin/users/${userId}`,\n'
                    "  {\n"
                    '    method: "DELETE",\n'
                    '    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` },\n'
                    "  }\n"
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
                    "$userId = 'usr_abc123';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->delete(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/users/' . $userId,\n"
                    "    ['headers' => ['Authorization' => 'Bearer ' . $adminToken]]\n"
                    ");\n"
                    "$result = json_decode($response->getBody(), true);\n"
                    "echo $result['message'] . '\\n';"
                ),
            },
        ],
    },
)
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a user and their data.

    This will delete the user's quota record.
    Documents should be handled separately.
    """
    result = await db.execute(
        select(UserQuota).where(UserQuota.user_id == user_id)
    )
    quota = result.scalar_one_or_none()

    if not quota:
        raise HTTPException(status_code=404, detail="User not found")

    await db.delete(quota)
    await db.commit()

    return {"message": f"User {user_id} deleted successfully"}


@router.get(
    "/{user_id}/documents",
    summary="List documents owned by a user",
    description="""
Retrieve a paginated list of documents belonging to a specific user.

**Admin access required.** Only non-deleted documents are returned. Results are
sorted by last update date (newest first). Each document entry includes:
- `id` — document unique identifier
- `name` — original filename
- `page_count` — number of pages
- `file_size_bytes` and `file_size_formatted` — size information
- `created_at` / `updated_at` — timestamps

Returns `404` if the specified user does not exist.
""",
    response_description="Paginated list of documents owned by the user",
    responses={
        200: {"description": "User documents returned successfully"},
        401: {"description": "Missing or invalid authentication token"},
        403: {"description": "Admin access required"},
        404: {"description": "User not found"},
        422: {"description": "Invalid pagination parameters"},
        500: {"description": "Internal server error while fetching user documents"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/admin/users/usr_abc123/documents?page=1&page_size=20" \\\n'
                    '  -H "Authorization: Bearer $ADMIN_TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    "import requests\n\n"
                    "user_id = 'usr_abc123'\n"
                    "response = requests.get(\n"
                    '    f"https://api.giga-pdf.com/api/v1/admin/users/{user_id}/documents",\n'
                    '    params={"page": 1, "page_size": 20},\n'
                    '    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},\n'
                    ")\n"
                    "data = response.json()\n"
                    'print(f"Total documents: {data[\'total\']}")\n'
                    "for doc in data['documents']:\n"
                    '    print(f"  {doc[\'name\']} — {doc[\'file_size_formatted\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const userId = 'usr_abc123';\n"
                    "const response = await fetch(\n"
                    '  `https://api.giga-pdf.com/api/v1/admin/users/${userId}/documents?page=1&page_size=20`,\n'
                    "  {\n"
                    '    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` },\n'
                    "  }\n"
                    ");\n"
                    "const { documents, total } = await response.json();\n"
                    "console.log(`Total: ${total}`);\n"
                    "documents.forEach(d => console.log(`${d.name} — ${d.file_size_formatted}`));"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$userId = 'usr_abc123';\n"
                    "$client = new \\GuzzleHttp\\Client();\n"
                    "$response = $client->get(\n"
                    "    'https://api.giga-pdf.com/api/v1/admin/users/' . $userId . '/documents',\n"
                    "    [\n"
                    "        'query' => ['page' => 1, 'page_size' => 20],\n"
                    "        'headers' => ['Authorization' => 'Bearer ' . $adminToken],\n"
                    "    ]\n"
                    ");\n"
                    "$data = json_decode($response->getBody(), true);\n"
                    "echo 'Total documents: ' . $data['total'] . '\\n';\n"
                    "foreach ($data['documents'] as $doc) {\n"
                    "    echo $doc['name'] . ' — ' . $doc['file_size_formatted'] . '\\n';\n"
                    "}"
                ),
            },
        ],
    },
)
async def get_user_documents(
    user_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Get documents owned by a specific user.
    """
    # Verify user exists
    user_result = await db.execute(
        select(UserQuota).where(UserQuota.user_id == user_id)
    )
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")

    # Get documents
    query = select(StoredDocument).where(
        StoredDocument.owner_id == user_id,
        not StoredDocument.is_deleted
    )

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(StoredDocument.updated_at.desc())

    result = await db.execute(query)
    documents = result.scalars().all()

    return {
        "documents": [
            {
                "id": doc.id,
                "name": doc.name,
                "page_count": doc.page_count,
                "file_size_bytes": doc.file_size_bytes,
                "file_size_formatted": format_bytes(doc.file_size_bytes),
                "created_at": doc.created_at,
                "updated_at": doc.updated_at,
            }
            for doc in documents
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
