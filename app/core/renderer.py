"""
PDF Renderer - Applies changes from scene graph back to PDF.

# DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes instead.
#
# This module previously used PyMuPDF (AGPL) to write text, images, shapes,
# annotations, and form fields into PDF pages. All these rendering operations
# are now performed by the TypeScript pdf-engine package (packages/pdf-engine).
#
# This file is retained as a no-op compatibility shim so that existing callers
# (document_service.py, etc.) continue to import without errors during migration.
#
# TODO: Remove this module once all callers have been migrated to the TS engine.
"""

import logging
from typing import Any, Optional

# fitz (PyMuPDF) removed — rendering now done by @giga-pdf/pdf-engine (TypeScript)

from app.models.elements import (
    AnnotationElement,
    AnnotationType,
    Bounds,
    FormFieldElement,
    ImageElement,
    ShapeElement,
    ShapeType,
    TextElement,
)

logger = logging.getLogger(__name__)


class PDFRenderer:
    """
    Renders scene graph changes back to PDF.

    DEPRECATED: All rendering operations are now handled by @giga-pdf/pdf-engine (TypeScript).

    This class is a no-op compatibility shim. All methods log a deprecation warning
    and return without performing any PDF operations.

    TODO: Remove this class once all callers have been migrated to the TS engine.
    """

    def __init__(self, doc: object):
        """
        Initialize renderer with document handle (stored but not used).

        Args:
            doc: Document handle — stored for reference only.
        """
        self.doc = doc
        logger.warning(
            "PDFRenderer is deprecated. Use @giga-pdf/pdf-engine via Next.js API routes."
        )

    # -------------------------------------------------------------------------
    # All methods below are DEPRECATED no-op stubs.
    # TODO: Remove once callers are fully migrated to @giga-pdf/pdf-engine.
    # -------------------------------------------------------------------------

    def add_text(self, page_number: int, element: TextElement) -> None:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning("PDFRenderer.add_text() is a no-op. Use @giga-pdf/pdf-engine.")

    def update_text(self, page_number: int, old_bounds: Bounds, element: TextElement) -> None:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning("PDFRenderer.update_text() is a no-op. Use @giga-pdf/pdf-engine.")

    def add_image(self, page_number: int, element: ImageElement, image_data: bytes) -> None:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning("PDFRenderer.add_image() is a no-op. Use @giga-pdf/pdf-engine.")

    def update_image(
        self,
        page_number: int,
        old_bounds: Bounds,
        element: ImageElement,
        image_data: Optional[bytes] = None,
    ) -> None:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning("PDFRenderer.update_image() is a no-op. Use @giga-pdf/pdf-engine.")

    def add_shape(self, page_number: int, element: ShapeElement) -> None:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning("PDFRenderer.add_shape() is a no-op. Use @giga-pdf/pdf-engine.")

    def add_annotation(self, page_number: int, element: AnnotationElement) -> None:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning("PDFRenderer.add_annotation() is a no-op. Use @giga-pdf/pdf-engine.")
        return None  # type: ignore[return-value]

    def add_form_field(self, page_number: int, element: FormFieldElement) -> None:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning("PDFRenderer.add_form_field() is a no-op. Use @giga-pdf/pdf-engine.")

    def update_form_field_value(self, page_number: int, field_name: str, value: Any) -> bool:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning(
            "PDFRenderer.update_form_field_value() is a no-op. Use @giga-pdf/pdf-engine."
        )
        return False

    def delete_element_area(self, page_number: int, bounds: Bounds) -> None:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning(
            "PDFRenderer.delete_element_area() is a no-op. Use @giga-pdf/pdf-engine."
        )

    def flatten_annotations(self, page_number: Optional[int] = None) -> None:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning(
            "PDFRenderer.flatten_annotations() is a no-op. Use @giga-pdf/pdf-engine."
        )

    def flatten_forms(self, page_number: Optional[int] = None) -> None:
        """DEPRECATED no-op. Use @giga-pdf/pdf-engine via Next.js API routes."""
        logger.warning("PDFRenderer.flatten_forms() is a no-op. Use @giga-pdf/pdf-engine.")

    @staticmethod
    def _hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
        """Convert hex color to RGB tuple (0-1 range)."""
        hex_color = hex_color.lstrip("#")
        return tuple(int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4))

    @staticmethod
    def _get_pdf_font(font_family: str, bold: bool = False) -> str:
        """Get PDF font name from family name."""
        # Map to base14 fonts for compatibility
        font_map = {
            "helvetica": "helv",
            "arial": "helv",
            "times new roman": "tiro",
            "times": "tiro",
            "courier": "cour",
            "courier new": "cour",
        }

        base_font = font_map.get(font_family.lower(), "helv")

        if bold:
            bold_map = {"helv": "hebo", "tiro": "tibo", "cour": "cobo"}
            return bold_map.get(base_font, base_font)

        return base_font
