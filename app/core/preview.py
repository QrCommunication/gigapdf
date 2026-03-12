"""
Preview Generator - Renders PDF pages to images.

# DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes instead.
#
# This module previously used PyMuPDF (AGPL) to render PDF pages to PNG/JPEG/WebP/SVG.
# Page rendering is now performed by the TypeScript pdf-engine package
# (packages/pdf-engine). The Python process no longer renders pages directly.
#
# This file is kept as a compatibility shim so that existing Celery tasks that
# import PreviewGenerator do not crash during migration.
#
# TODO: Remove this module once all callers (export_tasks.py, document_service.py)
#       have been migrated to retrieve previews from the TS engine.
"""

import io
import logging
from typing import Literal, Optional

# fitz (PyMuPDF) removed — page rendering now done by @giga-pdf/pdf-engine (TypeScript)
import pdfplumber  # MIT-licensed — used for basic page info
from PIL import Image

from app.config import get_settings

logger = logging.getLogger(__name__)


class PreviewGenerator:
    """
    Generates image previews of PDF pages.

    DEPRECATED: All page rendering is now handled by @giga-pdf/pdf-engine (TypeScript).

    This class is a compatibility shim. It uses pdfplumber for page rendering
    where still needed (e.g., OCR pipeline), but all methods log deprecation
    warnings. The preferred approach is to fetch previews from the TS engine.
    """

    def __init__(self, doc: object):
        """
        Initialize preview generator.

        Args:
            doc: Document handle (LegacyDocumentProxy or any object with
                 ._pdf_bytes attribute, or raw bytes).
        """
        self.doc = doc
        self.settings = get_settings()

    def _get_pdf_bytes(self) -> Optional[bytes]:
        """Extract raw PDF bytes from whatever doc handle we have."""
        if isinstance(self.doc, bytes):
            return self.doc
        if hasattr(self.doc, "_pdf_bytes"):
            return self.doc._pdf_bytes
        if hasattr(self.doc, "tobytes"):
            return self.doc.tobytes()
        return None

    def render_page(
        self,
        page_number: int,
        dpi: int = 150,
        format: Literal["png", "jpeg", "webp", "svg"] = "png",
        quality: int = 85,
        scale: Optional[float] = None,
    ) -> bytes:
        """
        Render a page to an image via pdfplumber.

        DEPRECATED: Page rendering is now handled by @giga-pdf/pdf-engine (TypeScript).
        This implementation uses pdfplumber as a fallback for existing callers.

        TODO: Replace callers with TS engine preview endpoint.
        """
        logger.warning(
            "PreviewGenerator.render_page() is deprecated. "
            "Use @giga-pdf/pdf-engine via Next.js API routes for page rendering."
        )

        max_dpi = self.settings.preview_max_dpi
        dpi = min(dpi, max_dpi)
        effective_dpi = int((scale or 1.0) * dpi) if scale else dpi

        pdf_bytes = self._get_pdf_bytes()
        if not pdf_bytes:
            raise ValueError("PreviewGenerator: no PDF bytes available")

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if page_number < 1 or page_number > len(pdf.pages):
                raise IndexError(f"Page {page_number} not found")

            page = pdf.pages[page_number - 1]

            if format == "svg":
                # pdfplumber does not produce SVG natively — return empty SVG stub
                logger.warning("SVG rendering not supported in pdfplumber fallback; returning stub.")
                return b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'

            img = page.to_image(resolution=effective_dpi).original
            if img.mode != "RGB":
                img = img.convert("RGB")

        output = io.BytesIO()
        if format == "png":
            img.save(output, format="PNG", optimize=True)
        elif format == "jpeg":
            img.save(output, format="JPEG", quality=quality, optimize=True)
        elif format == "webp":
            img.save(output, format="WEBP", quality=quality)
        else:
            img.save(output, format="PNG", optimize=True)

        return output.getvalue()

    def render_thumbnail(
        self,
        page_number: int,
        max_width: int = 200,
        max_height: int = 300,
        format: Literal["png", "jpeg", "webp"] = "png",
    ) -> bytes:
        """
        Render a thumbnail with maximum dimensions via pdfplumber.

        DEPRECATED: Thumbnail generation is now handled by @giga-pdf/pdf-engine (TypeScript).
        TODO: Replace callers with TS engine thumbnail endpoint.
        """
        logger.warning(
            "PreviewGenerator.render_thumbnail() is deprecated. "
            "Use @giga-pdf/pdf-engine via Next.js API routes."
        )

        pdf_bytes = self._get_pdf_bytes()
        if not pdf_bytes:
            raise ValueError("PreviewGenerator: no PDF bytes available")

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if page_number < 1 or page_number > len(pdf.pages):
                raise IndexError(f"Page {page_number} not found")

            page = pdf.pages[page_number - 1]
            page_width = float(page.width)
            page_height = float(page.height)

            # Calculate scale to fit within max dimensions
            scale = min(max_width / page_width, max_height / page_height)
            dpi = max(72, int(72 * scale))
            img = page.to_image(resolution=dpi).original
            if img.mode != "RGB":
                img = img.convert("RGB")

        img.thumbnail((max_width, max_height))
        output = io.BytesIO()
        if format == "png":
            img.save(output, format="PNG", optimize=True)
        elif format == "jpeg":
            img.save(output, format="JPEG", quality=75, optimize=True)
        elif format == "webp":
            img.save(output, format="WEBP", quality=75)

        return output.getvalue()

    def render_all_thumbnails(
        self,
        max_width: int = 200,
        max_height: int = 300,
        format: Literal["png", "jpeg", "webp"] = "png",
    ) -> dict[int, bytes]:
        """
        Render thumbnails for all pages.

        DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes.
        """
        logger.warning(
            "PreviewGenerator.render_all_thumbnails() is deprecated. "
            "Use @giga-pdf/pdf-engine via Next.js API routes."
        )

        pdf_bytes = self._get_pdf_bytes()
        if not pdf_bytes:
            return {}

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            page_count = len(pdf.pages)

        thumbnails = {}
        for page_num in range(1, page_count + 1):
            thumbnails[page_num] = self.render_thumbnail(page_num, max_width, max_height, format)

        return thumbnails

    def extract_page_image(
        self,
        page_number: int,
        xref: int,
        format: Optional[Literal["png", "jpeg", "webp"]] = None,
    ) -> tuple[bytes, str]:
        """
        Extract an embedded image from a page via pdfplumber.

        DEPRECATED: Image extraction is now handled by @giga-pdf/pdf-engine (TypeScript).

        NOTE: pdfplumber does not support extracting images by xref. This method
        renders the full page at high DPI and returns it as a PNG fallback.
        TODO: Use the TS engine image endpoint instead.
        """
        logger.warning(
            "PreviewGenerator.extract_page_image() is deprecated. "
            "Use @giga-pdf/pdf-engine via Next.js API routes for embedded image extraction."
        )

        pdf_bytes = self._get_pdf_bytes()
        if not pdf_bytes:
            raise ValueError(f"Image not found: xref {xref} (no PDF bytes)")

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if page_number < 1 or page_number > len(pdf.pages):
                raise ValueError(f"Image not found: page {page_number} out of range")
            page = pdf.pages[page_number - 1]
            img = page.to_image(resolution=150).original
            if img.mode != "RGB":
                img = img.convert("RGB")

        target_format = format or "png"
        output = io.BytesIO()
        mime_map = {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}

        if target_format == "jpeg":
            img.save(output, format="JPEG", quality=85)
        elif target_format == "webp":
            img.save(output, format="WEBP", quality=85)
        else:
            img.save(output, format="PNG")

        return output.getvalue(), mime_map.get(target_format, "image/png")

    def get_page_text_image(
        self,
        page_number: int,
        dpi: int = 300,
    ) -> bytes:
        """
        Render page suitable for OCR processing via pdfplumber.

        High-contrast grayscale rendering optimized for OCR.

        Args:
            page_number: Page number (1-indexed).
            dpi: Resolution (higher is better for OCR).

        Returns:
            bytes: PNG image data.
        """
        pdf_bytes = self._get_pdf_bytes()
        if not pdf_bytes:
            raise ValueError("PreviewGenerator: no PDF bytes available")

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if page_number < 1 or page_number > len(pdf.pages):
                raise IndexError(f"Page {page_number} not found")
            page = pdf.pages[page_number - 1]
            img = page.to_image(resolution=dpi).original
            if img.mode != "RGB":
                img = img.convert("RGB")

        img = img.convert("L")  # Grayscale

        # Enhance contrast for OCR
        from PIL import ImageEnhance
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.5)

        output = io.BytesIO()
        img.save(output, format="PNG")
        return output.getvalue()
