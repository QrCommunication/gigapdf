"""Request schemas for document operations."""

from typing import Optional

from pydantic import BaseModel, Field


class DocumentUploadParams(BaseModel):
    """Parameters for document upload."""

    password: Optional[str] = Field(
        default=None,
        description="PDF password if the document is encrypted. Required to open password-protected PDFs.",
        examples=["my-secret-password"],
    )
    extract_text: bool = Field(
        default=True,
        description="Extract text elements from the PDF for editing. Disable to speed up upload of image-only PDFs.",
        examples=[True],
    )
    ocr_enabled: bool = Field(
        default=False,
        description="Enable OCR (Optical Character Recognition) for scanned pages with no embedded text.",
        examples=[False],
    )
    ocr_languages: str = Field(
        default="fra+eng",
        description="Tesseract language codes for OCR, combined with '+'. See https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html for available codes.",
        examples=["fra+eng", "eng", "deu+fra"],
    )
    generate_previews: bool = Field(
        default=True,
        description="Generate PNG preview images for each page. Disable to reduce processing time for large documents.",
        examples=[True],
    )
    preview_dpi: int = Field(
        default=150,
        ge=72,
        le=600,
        description="Resolution in DPI for generated preview images. Higher values produce sharper previews but increase processing time and storage.",
        examples=[150, 72, 300],
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "password": None,
                "extract_text": True,
                "ocr_enabled": False,
                "ocr_languages": "fra+eng",
                "generate_previews": True,
                "preview_dpi": 150,
            }
        }
    }


class UnlockDocumentRequest(BaseModel):
    """Request to unlock an encrypted PDF."""

    password: str = Field(
        description="The password required to open the encrypted PDF.",
        examples=["my-secret-password"],
    )
    remove_restrictions: bool = Field(
        default=False,
        description="If true, removes all password protection from the document after unlocking, saving an unrestricted copy.",
        examples=[False, True],
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "password": "my-secret-password",
                "remove_restrictions": False,
            }
        }
    }


class DownloadDocumentParams(BaseModel):
    """Parameters for document download."""

    flatten_forms: bool = Field(
        default=False,
        description="Flatten form fields into static content, making them non-editable in the downloaded PDF.",
        examples=[False],
    )
    flatten_annotations: bool = Field(
        default=False,
        description="Flatten annotations (highlights, comments, stamps) into the page content.",
        examples=[False],
    )
    remove_restrictions: bool = Field(
        default=False,
        description="Remove password protection and usage restrictions from the downloaded PDF.",
        examples=[False],
    )
    optimize: bool = Field(
        default=False,
        description="Apply file size optimization before download. May reduce quality of embedded images.",
        examples=[False],
    )
    pdf_version: Optional[str] = Field(
        default=None,
        description="Target PDF version for the output file (e.g. '1.4', '1.7', '2.0'). Uses the source document version if not specified.",
        examples=["1.7", "2.0", None],
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "flatten_forms": False,
                "flatten_annotations": False,
                "remove_restrictions": False,
                "optimize": False,
                "pdf_version": None,
            }
        }
    }


class MergeDocumentsRequest(BaseModel):
    """Request to merge multiple documents."""

    documents: list[dict] = Field(
        description=(
            "Ordered list of documents to merge. Each entry is an object with `document_id` (UUID) "
            "and an optional `page_ranges` list of range strings (e.g. '1-3', '5'). "
            "All pages are included if `page_ranges` is omitted."
        ),
        examples=[
            [
                {"document_id": "uuid-doc-1", "page_ranges": ["1-3"]},
                {"document_id": "uuid-doc-2"},
            ]
        ],
    )
    output_name: Optional[str] = Field(
        default=None,
        description="Filename for the merged output document (without .pdf extension). Defaults to 'merged' if not provided.",
        examples=["merged-report", "Q1-combined", None],
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "documents": [
                    {"document_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "page_ranges": ["1-5"]},
                    {"document_id": "7cb12a31-2891-4f3d-a9e1-8b37f55d1c2e"},
                ],
                "output_name": "merged-report",
            }
        }
    }


class SplitDocumentRequest(BaseModel):
    """Request to split a document."""

    split_method: str = Field(
        description=(
            "Strategy for splitting the document. "
            "`by_pages`: split every N pages (requires `pages_per_document`). "
            "`by_size`: split when output reaches a target file size (requires `max_size_mb`). "
            "`by_bookmarks`: split at top-level or nested bookmarks (requires `bookmark_level`)."
        ),
        examples=["by_pages", "by_size", "by_bookmarks"],
    )
    pages_per_document: Optional[int] = Field(
        default=None,
        ge=1,
        description="Number of pages per output document. Required when `split_method` is `by_pages`.",
        examples=[10, 5, None],
    )
    max_size_mb: Optional[float] = Field(
        default=None,
        gt=0,
        description="Maximum size in MB for each output document. Required when `split_method` is `by_size`.",
        examples=[5.0, 10.0, None],
    )
    bookmark_level: Optional[int] = Field(
        default=None,
        ge=1,
        description="Bookmark depth level to split at (1 = top-level chapters, 2 = sub-chapters, etc.). Required when `split_method` is `by_bookmarks`.",
        examples=[1, 2, None],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "summary": "Split by pages",
                    "value": {
                        "split_method": "by_pages",
                        "pages_per_document": 10,
                        "max_size_mb": None,
                        "bookmark_level": None,
                    },
                },
                {
                    "summary": "Split by bookmarks",
                    "value": {
                        "split_method": "by_bookmarks",
                        "pages_per_document": None,
                        "max_size_mb": None,
                        "bookmark_level": 1,
                    },
                },
                {
                    "summary": "Split by file size",
                    "value": {
                        "split_method": "by_size",
                        "pages_per_document": None,
                        "max_size_mb": 5.0,
                        "bookmark_level": None,
                    },
                },
            ]
        }
    }
