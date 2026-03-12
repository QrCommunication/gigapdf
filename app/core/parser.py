"""
PDF Parser - Converts PDF content to scene graph representation.

# DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes instead.
#
# This module previously used PyMuPDF (AGPL) to extract text, images, shapes,
# annotations, and form fields from PDF pages and convert them to our internal
# scene graph model. All these operations are now performed by the TypeScript
# pdf-engine package (packages/pdf-engine), which is MIT-licensed and runs in
# the Next.js process.
#
# This file is retained so that existing Celery tasks (processing_tasks.py,
# export_tasks.py) and the document_service continue to import PDFParser
# without crashing. The class now returns minimal stub scene graphs and logs
# deprecation warnings instead of performing real parsing.
#
# TODO: Remove this module once all callers have been migrated to call the
#       TS engine REST API and retrieve the scene graph from there.

import base64
import io
import logging
from typing import Any, Optional

# fitz (PyMuPDF) removed — PDF parsing now done in @giga-pdf/pdf-engine (TypeScript)
import pdfplumber  # MIT-licensed, used only for basic metadata fallback

from app.core.ocr import ocr_processor
from app.models.bookmarks import BookmarkDestination, BookmarkObject, BookmarkStyle
from app.models.document import (
    DocumentMetadata,
    DocumentObject,
    DocumentPermissions,
    EmbeddedFileObject,
)
from app.models.elements import (
    AnnotationElement,
    AnnotationStyle,
    AnnotationType,
    Bounds,
    ElementType,
    FieldProperties,
    FieldStyle,
    FieldType,
    FormFieldElement,
    ImageElement,
    ImageSource,
    ImageStyle,
    LinkDestination,
    Point,
    ShapeElement,
    ShapeGeometry,
    ShapeStyle,
    ShapeType,
    TextElement,
    TextStyle,
    Transform,
)
from app.models.layers import LayerObject
from app.models.page import Dimensions, MediaBox, PageObject, PagePreview
from app.utils.coordinates import Rect
from app.utils.helpers import generate_uuid, now_utc

logger = logging.getLogger(__name__)


class PDFParser:
    """
    Parses PDF documents into scene graph representation.

    DEPRECATED: All PDF parsing is now performed by @giga-pdf/pdf-engine (TypeScript).

    This class is kept as a compatibility shim. It returns minimal stub
    DocumentObjects (correct metadata, empty page elements) so that Celery
    tasks and the document_service continue to function during migration.

    TODO: Replace all call sites with calls to the TS engine REST API.
    """

    def __init__(self, document_id: str, base_url: str = "/api/v1"):
        """
        Initialize parser.

        Args:
            document_id: Document identifier for URL generation.
            base_url: Base URL for resource endpoints.
        """
        self.document_id = document_id
        self.base_url = base_url

    def parse_document(
        self,
        doc: object,
        extract_text: bool = True,
        extract_images: bool = True,
        include_previews: bool = True,
        enable_ocr: bool = True,
        ocr_languages: str = "fra+eng",
    ) -> DocumentObject:
        """
        Parse entire document into scene graph.

        DEPRECATED: Returns a stub DocumentObject with correct page count but
        no extracted elements. Real parsing is done by @giga-pdf/pdf-engine.

        Args:
            doc: LegacyDocumentProxy or any object with .page_count.
                 If it also has ._pdf_bytes or .tobytes(), pdfplumber will be
                 used to extract basic metadata.
            extract_text, extract_images, include_previews, enable_ocr,
            ocr_languages: Kept for API compatibility — ignored.

        Returns:
            DocumentObject: Stub scene graph.
        """
        logger.warning(
            "PDFParser.parse_document() is deprecated. "
            "Use @giga-pdf/pdf-engine via Next.js API routes for PDF parsing."
        )

        page_count = getattr(doc, "page_count", 1)
        logger.info(f"Parsing (stub) document {self.document_id} with {page_count} pages")

        # Try to extract basic metadata from the doc proxy
        metadata = self._parse_metadata(doc)

        # Build stub pages — no elements (real parsing is in @giga-pdf/pdf-engine)
        pages = []
        for page_num in range(1, page_count + 1):
            page = self.parse_page(None, page_num, include_previews=include_previews)
            pages.append(page)

        return DocumentObject(
            document_id=self.document_id,
            metadata=metadata,
            pages=pages,
            outlines=[],
            layers=[],
            embedded_files=[],
        )

    def parse_page(
        self,
        page: object,
        page_number: int,
        extract_text: bool = True,
        extract_images: bool = True,
        include_previews: bool = True,
        enable_ocr: bool = True,
        ocr_languages: str = "fra+eng",
    ) -> PageObject:
        """
        Parse a single page into scene graph.

        DEPRECATED: Returns a stub PageObject with no elements.
        Real page parsing is done by @giga-pdf/pdf-engine (TypeScript).

        Args:
            page: Ignored (kept for API compatibility).
            page_number: Page number (1-indexed).
            (remaining args kept for API compatibility — ignored)

        Returns:
            PageObject: Stub page with no elements.
        """
        page_id = generate_uuid()

        # Default A4 dimensions — the TS engine provides accurate values
        dimensions = Dimensions(width=595.0, height=842.0, rotation=0)
        media_box = MediaBox(x=0.0, y=0.0, width=595.0, height=842.0)

        preview = None
        if include_previews:
            preview = PagePreview(
                thumbnail_url=f"{self.base_url}/documents/{self.document_id}/pages/{page_number}/preview?dpi=72",
                full_url=f"{self.base_url}/documents/{self.document_id}/pages/{page_number}/preview?dpi=150",
            )

        return PageObject(
            page_id=page_id,
            page_number=page_number,
            dimensions=dimensions,
            media_box=media_box,
            crop_box=None,
            elements=[],  # Elements extracted by TS engine
            preview=preview,
        )

    def _parse_metadata(self, doc: object) -> DocumentMetadata:
        """Parse document metadata from a LegacyDocumentProxy or similar."""
        permissions = DocumentPermissions(print=True, modify=True, copy=True, annotate=True)

        page_count = getattr(doc, "page_count", 1)
        is_encrypted = getattr(doc, "is_encrypted", False)
        raw_meta = {}
        try:
            raw_meta = doc.metadata or {}  # type: ignore[union-attr]
        except Exception:
            pass

        return DocumentMetadata(
            title=raw_meta.get("title"),
            author=raw_meta.get("author"),
            subject=raw_meta.get("subject"),
            keywords=raw_meta.get("keywords", "").split(",") if raw_meta.get("keywords") else [],
            creator=raw_meta.get("creator"),
            producer=raw_meta.get("producer"),
            creation_date=None,
            modification_date=None,
            page_count=page_count,
            pdf_version=raw_meta.get("format", "PDF 1.7").replace("PDF ", ""),
            is_encrypted=is_encrypted,
            permissions=permissions,
        )

    # ---------------------------------------------------------------------------
    # Private helpers retained as stubs to avoid ImportError in any remaining
    # callers. They return empty results and log a deprecation warning.
    # ---------------------------------------------------------------------------

    def _extract_text_elements(self, page: object, page_height: float) -> list:
        """DEPRECATED stub — text extraction is done by @giga-pdf/pdf-engine."""
        return []

    def _get_page_links(self, page: object) -> list:
        """DEPRECATED stub."""
        return []

    def _extract_image_elements(self, page: object, page_number: int, page_height: float) -> list:
        """DEPRECATED stub — image extraction is done by @giga-pdf/pdf-engine."""
        return []

    def _extract_annotations(self, page: object, page_height: float) -> list:
        """DEPRECATED stub — annotation extraction is done by @giga-pdf/pdf-engine."""
        return []

    def _extract_drawings(self, page: object) -> list:
        """DEPRECATED stub — drawing extraction is done by @giga-pdf/pdf-engine."""
        return []

    def _detect_corner_radius(self, items: list, width: float, height: float) -> float:
        """DEPRECATED stub."""
        return 0.0

    def _extract_form_fields(self, page: object, page_height: float) -> list:
        """DEPRECATED stub — form field extraction is done by @giga-pdf/pdf-engine."""
        return []

    def _parse_bookmarks(self, doc: object) -> list:
        """DEPRECATED stub — bookmark parsing is done by @giga-pdf/pdf-engine."""
        return []

    def _parse_layers(self, doc: object) -> list:
        """DEPRECATED stub — layer parsing is done by @giga-pdf/pdf-engine."""
        return []

    def _parse_embedded_files(self, doc: object) -> list:
        """DEPRECATED stub — embedded file parsing is done by @giga-pdf/pdf-engine."""
        return []

    @staticmethod
    def _int_to_hex_color(color_int: int) -> str:
        """Convert integer color to hex string."""
        if color_int == 0:
            return "#000000"
        r = (color_int >> 16) & 0xFF
        g = (color_int >> 8) & 0xFF
        b = color_int & 0xFF
        return f"#{r:02X}{g:02X}{b:02X}"

    @staticmethod
    def _tuple_to_hex_color(color_tuple: tuple | list) -> str:
        """Convert RGB tuple (0-1 range) to hex string."""
        if not color_tuple:
            return "#000000"
        r = int(color_tuple[0] * 255) if len(color_tuple) > 0 else 0
        g = int(color_tuple[1] * 255) if len(color_tuple) > 1 else 0
        b = int(color_tuple[2] * 255) if len(color_tuple) > 2 else 0
        return f"#{r:02X}{g:02X}{b:02X}"

    @staticmethod
    def _normalize_font_name(font_name: str) -> str:
        """Normalize font name to standard family name."""
        # Remove common suffixes
        for suffix in ["-Bold", "-Italic", "-BoldItalic", "Bold", "Italic", ",Bold", ",Italic"]:
            font_name = font_name.replace(suffix, "")

        # Map common PDF fonts to web fonts
        font_map = {
            "Helvetica": "Helvetica",
            "Arial": "Arial",
            "TimesNewRoman": "Times New Roman",
            "Times-Roman": "Times New Roman",
            "Courier": "Courier New",
            "CourierNew": "Courier New",
        }

        return font_map.get(font_name, font_name)
