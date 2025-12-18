"""
Admin documents management endpoints.

Provides document management for the admin panel.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.database import StoredDocument, DocumentVersion

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
    tags: Optional[list] = None
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


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    owner_id: Optional[str] = Query(None),
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
        query = query.where(StoredDocument.is_deleted == False)

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


@router.get("/stats", response_model=DocumentStatsResponse)
async def get_document_stats(
    db: AsyncSession = Depends(get_db),
):
    """
    Get document statistics.
    """
    # Total documents
    total_result = await db.execute(
        select(func.count()).select_from(StoredDocument).where(
            StoredDocument.is_deleted == False
        )
    )
    total_documents = total_result.scalar() or 0

    # Total size
    size_result = await db.execute(
        select(func.sum(StoredDocument.file_size_bytes)).where(
            StoredDocument.is_deleted == False
        )
    )
    total_size_bytes = size_result.scalar() or 0

    # Average page count
    avg_result = await db.execute(
        select(func.avg(StoredDocument.page_count)).where(
            StoredDocument.is_deleted == False
        )
    )
    avg_page_count = avg_result.scalar() or 0

    # Deleted count
    deleted_result = await db.execute(
        select(func.count()).select_from(StoredDocument).where(
            StoredDocument.is_deleted == True
        )
    )
    deleted_count = deleted_result.scalar() or 0

    # Documents by MIME type
    mime_result = await db.execute(
        select(
            StoredDocument.mime_type,
            func.count().label("count")
        ).where(
            StoredDocument.is_deleted == False
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


@router.get("/{document_id}", response_model=DocumentResponse)
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


@router.get("/{document_id}/versions")
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


@router.delete("/{document_id}")
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


@router.post("/{document_id}/restore")
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
            StoredDocument.is_deleted == True
        )
    )
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Deleted document not found")

    doc.is_deleted = False
    doc.deleted_at = None

    await db.commit()

    return {"message": f"Document {document_id} restored successfully"}
