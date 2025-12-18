"""
Admin users management endpoints.

Provides user management for the admin panel.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.database import StoredDocument, UserQuota

router = APIRouter()


class UserResponse(BaseModel):
    """User response model."""
    id: str
    email: Optional[str] = None
    name: Optional[str] = None
    plan_type: str
    storage_used_bytes: int
    storage_limit_bytes: int
    storage_used_formatted: str
    storage_limit_formatted: str
    document_count: int
    api_calls_used: int
    api_calls_limit: int
    status: str  # active, suspended, pending
    created_at: Optional[datetime] = None
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
    plan_type: Optional[str] = None
    storage_limit_bytes: Optional[int] = None
    api_calls_limit: Optional[int] = None
    document_limit: Optional[int] = None
    status: Optional[str] = None


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


@router.get("", response_model=UserListResponse)
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    plan_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
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


@router.get("/{user_id}", response_model=UserResponse)
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


@router.patch("/{user_id}", response_model=UserResponse)
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


@router.delete("/{user_id}")
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


@router.get("/{user_id}/documents")
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
        StoredDocument.is_deleted == False
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
