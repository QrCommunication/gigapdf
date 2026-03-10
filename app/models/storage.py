"""
Storage models for persistent document storage.

Models for saved documents, versions, and folders.
"""

from datetime import datetime
from typing import Optional

from pydantic import Field

from app.models.base import CamelCaseModel


class StoredDocumentVersion(CamelCaseModel):
    """A version of a stored document."""

    version: int = Field(ge=1, description="Version number")
    created_at: datetime = Field(description="Version creation time")
    created_by: str = Field(description="User ID who created this version")
    comment: Optional[str] = Field(default=None, description="Version comment")
    size_bytes: int = Field(ge=0, description="File size in bytes")


class StoredDocument(CamelCaseModel):
    """
    A document saved to persistent storage.

    Supports versioning and folder organization.
    """

    stored_document_id: str = Field(description="Unique stored document ID (UUID v4)")
    name: str = Field(description="Document display name")
    folder_id: Optional[str] = Field(default=None, description="Parent folder ID")
    owner_id: str = Field(description="Owner user ID")
    page_count: int = Field(ge=0, description="Number of pages")
    current_version: int = Field(ge=1, description="Current version number")
    created_at: datetime = Field(description="Initial creation time")
    modified_at: datetime = Field(description="Last modification time")
    tags: list[str] = Field(default_factory=list, description="Document tags")
    thumbnail_url: Optional[str] = Field(default=None, description="Thumbnail URL")
    is_deleted: bool = Field(default=False, description="Soft delete flag")


class StorageFolder(CamelCaseModel):
    """A folder in the document storage hierarchy."""

    folder_id: str = Field(description="Unique folder ID (UUID v4)")
    name: str = Field(description="Folder name")
    parent_id: Optional[str] = Field(default=None, description="Parent folder ID")
    owner_id: str = Field(description="Owner user ID")
    created_at: datetime = Field(description="Creation time")
    document_count: int = Field(default=0, ge=0, description="Number of documents in folder")


class StorageQuota(CamelCaseModel):
    """User storage quota information."""

    user_id: str = Field(description="User ID")
    used_bytes: int = Field(ge=0, description="Storage used in bytes")
    max_bytes: int = Field(gt=0, description="Maximum storage allowed")
    document_count: int = Field(ge=0, description="Number of stored documents")

    @property
    def used_percentage(self) -> float:
        """Calculate percentage of quota used."""
        return (self.used_bytes / self.max_bytes) * 100 if self.max_bytes > 0 else 0

    @property
    def remaining_bytes(self) -> int:
        """Calculate remaining storage space."""
        return max(0, self.max_bytes - self.used_bytes)
