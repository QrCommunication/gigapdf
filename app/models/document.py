"""
Document model for complete PDF representation.

A document contains all pages, metadata, bookmarks, layers,
and other PDF-level structures.
"""

from datetime import datetime
from typing import Optional

from pydantic import ConfigDict, Field

from app.models.base import CamelCaseModel, to_camel
from app.models.bookmarks import BookmarkObject
from app.models.layers import LayerObject
from app.models.page import PageObject, PageSummary


class DocumentPermissions(CamelCaseModel):
    """PDF permission flags."""

    print: bool = Field(default=True, description="Allow printing")
    modify: bool = Field(default=True, description="Allow modification")
    copy: bool = Field(default=True, description="Allow copying content")
    annotate: bool = Field(default=True, description="Allow adding annotations")
    fill_forms: bool = Field(default=True, description="Allow filling forms")
    extract: bool = Field(default=True, description="Allow content extraction")
    assemble: bool = Field(default=True, description="Allow document assembly")
    print_high_quality: bool = Field(default=True, description="Allow high-quality print")


class DocumentMetadata(CamelCaseModel):
    """PDF document metadata (XMP and info dict)."""

    title: Optional[str] = Field(default=None, description="Document title")
    author: Optional[str] = Field(default=None, description="Document author")
    subject: Optional[str] = Field(default=None, description="Document subject")
    keywords: list[str] = Field(default_factory=list, description="Document keywords")
    creator: Optional[str] = Field(default=None, description="Creating application")
    producer: Optional[str] = Field(default=None, description="PDF producer")
    creation_date: Optional[datetime] = Field(default=None, description="Creation date")
    modification_date: Optional[datetime] = Field(default=None, description="Last modification")
    page_count: int = Field(ge=0, description="Total number of pages")
    pdf_version: str = Field(default="1.7", description="PDF version")
    is_encrypted: bool = Field(default=False, description="Whether PDF is encrypted")
    permissions: DocumentPermissions = Field(
        default_factory=DocumentPermissions, description="Document permissions"
    )


class EmbeddedFileObject(CamelCaseModel):
    """Embedded file attachment in a PDF."""

    file_id: str = Field(description="Unique file identifier")
    name: str = Field(description="Original filename")
    mime_type: str = Field(description="MIME type")
    size_bytes: int = Field(ge=0, description="File size in bytes")
    description: Optional[str] = Field(default=None, description="File description")
    creation_date: Optional[datetime] = Field(default=None)
    modification_date: Optional[datetime] = Field(default=None)
    data_url: str = Field(description="URL to download the file")


class NamedDestination(CamelCaseModel):
    """Named destination in a PDF."""

    name: str = Field(description="Destination name")
    page_number: int = Field(ge=1, description="Target page number")
    position: Optional[dict[str, float]] = Field(default=None, description="Position on page")
    zoom: Optional[float] = Field(default=None, ge=0, description="Zoom level")


class DocumentObject(CamelCaseModel):
    """
    Complete PDF document representation.

    The document is the root of the scene graph, containing
    all pages, metadata, and document-level structures.
    """

    document_id: str = Field(description="Unique document identifier (UUID v4)")
    metadata: DocumentMetadata = Field(description="Document metadata")
    pages: list[PageObject] = Field(default_factory=list, description="All pages")
    outlines: list[BookmarkObject] = Field(default_factory=list, description="Bookmarks/TOC")
    named_destinations: dict[str, NamedDestination] = Field(
        default_factory=dict, description="Named destinations"
    )
    embedded_files: list[EmbeddedFileObject] = Field(
        default_factory=list, description="Embedded files"
    )
    layers: list[LayerObject] = Field(default_factory=list, description="Optional content layers")

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "documentId": "550e8400-e29b-41d4-a716-446655440000",
                "metadata": {
                    "title": "Sample Document",
                    "author": "John Doe",
                    "pageCount": 10,
                    "pdfVersion": "1.7",
                    "isEncrypted": False,
                    "permissions": {
                        "print": True,
                        "modify": True,
                        "copy": True,
                        "annotate": True,
                    },
                },
                "pages": [],
                "outlines": [],
                "namedDestinations": {},
                "embeddedFiles": [],
                "layers": [],
            }
        },
    )


class DocumentSummary(CamelCaseModel):
    """Lightweight document representation for listings."""

    document_id: str = Field(description="Unique document identifier")
    title: Optional[str] = Field(default=None)
    page_count: int = Field(ge=0)
    is_encrypted: bool = Field(default=False)
    created_at: datetime
    pages: list[PageSummary] = Field(default_factory=list, description="Page summaries")
