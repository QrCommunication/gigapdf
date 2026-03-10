"""Request schemas for document operations."""

from typing import Optional

from pydantic import BaseModel, Field


class DocumentUploadParams(BaseModel):
    """Parameters for document upload."""

    password: Optional[str] = Field(default=None, description="PDF password if encrypted")
    extract_text: bool = Field(default=True, description="Extract text elements")
    ocr_enabled: bool = Field(default=False, description="Enable OCR for scanned pages")
    ocr_languages: str = Field(default="fra+eng", description="OCR language codes")
    generate_previews: bool = Field(default=True, description="Generate preview images")
    preview_dpi: int = Field(default=150, ge=72, le=600, description="Preview resolution")


class UnlockDocumentRequest(BaseModel):
    """Request to unlock an encrypted PDF."""

    password: str = Field(description="PDF password")
    remove_restrictions: bool = Field(
        default=False, description="Remove all password protection"
    )


class DownloadDocumentParams(BaseModel):
    """Parameters for document download."""

    flatten_forms: bool = Field(default=False, description="Flatten form fields")
    flatten_annotations: bool = Field(default=False, description="Flatten annotations")
    remove_restrictions: bool = Field(default=False, description="Remove restrictions")
    optimize: bool = Field(default=False, description="Optimize file size")
    pdf_version: Optional[str] = Field(default=None, description="Target PDF version")


class MergeDocumentsRequest(BaseModel):
    """Request to merge multiple documents."""

    documents: list[dict] = Field(
        description="List of {document_id, page_ranges} objects"
    )
    output_name: Optional[str] = Field(default=None, description="Output filename")


class SplitDocumentRequest(BaseModel):
    """Request to split a document."""

    split_method: str = Field(
        description="Split method: by_pages, by_size, by_bookmarks"
    )
    pages_per_document: Optional[int] = Field(
        default=None, ge=1, description="Pages per split (for by_pages)"
    )
    max_size_mb: Optional[float] = Field(
        default=None, gt=0, description="Max size per split (for by_size)"
    )
    bookmark_level: Optional[int] = Field(
        default=None, ge=1, description="Bookmark level (for by_bookmarks)"
    )
