"""
OCR Integration - Text recognition using Tesseract.

Provides OCR capabilities for scanned PDF pages,
converting images to searchable text.

# NOTE: PyMuPDF (fitz) has been removed. Page rendering for OCR is now done
# via pdfplumber + Pillow (MIT-licensed). The public API (process_page,
# process_document, add_ocr_layer) preserves the same signatures but accepts
# bytes-based page handles instead of fitz.Page objects where needed.
#
# The `add_ocr_layer` method that wrote invisible text back into the PDF is
# now a no-op stub — invisible OCR text insertion is handled by
# @giga-pdf/pdf-engine (TypeScript).
"""

import io
import logging
from typing import Optional

# fitz (PyMuPDF) removed — rendering via pdfplumber + Pillow
import pdfplumber
from PIL import Image

from app.config import get_settings
from app.models.elements import Bounds, TextElement, TextStyle, Transform, ElementType
from app.utils.coordinates import Rect
from app.utils.helpers import generate_uuid

logger = logging.getLogger(__name__)


class OCRProcessor:
    """
    OCR processing using Tesseract.

    Extracts text from scanned PDF pages and creates
    text elements with position information.
    """

    def __init__(self):
        """Initialize OCR processor."""
        self.settings = get_settings()
        self._tesseract_available = self._check_tesseract()

    def _check_tesseract(self) -> bool:
        """Check if Tesseract is available."""
        try:
            import pytesseract
            pytesseract.get_tesseract_version()
            return True
        except Exception as e:
            logger.warning(f"Tesseract not available: {e}")
            return False

    @property
    def is_available(self) -> bool:
        """Check if OCR is available."""
        return self._tesseract_available

    def process_page(
        self,
        page: object,
        page_number: int,
        languages: str = "eng",
        confidence_threshold: float = 60.0,
        *,
        pdf_bytes: Optional[bytes] = None,
        pdf_page_index: Optional[int] = None,
    ) -> list[TextElement]:
        """
        Perform OCR on a page and return text elements.

        The `page` argument may be:
          - A pdfplumber Page object (preferred after migration), or
          - Any legacy object that exposes .rect.width / .rect.height (kept for
            backward compat). In this case, `pdf_bytes` + `pdf_page_index` must
            be supplied so we can render via pdfplumber.

        Args:
            page: pdfplumber Page or legacy page proxy.
            page_number: Page number for logging.
            languages: Tesseract language codes (e.g., "eng+fra").
            confidence_threshold: Minimum confidence to include text.
            pdf_bytes: Raw PDF bytes (required when `page` is a legacy proxy).
            pdf_page_index: 0-based page index (required when `page` is a legacy proxy).

        Returns:
            list[TextElement]: Extracted text elements with positions.
        """
        if not self._tesseract_available:
            logger.warning("OCR requested but Tesseract not available")
            return []

        import pytesseract

        elements = []

        try:
            # Determine page dimensions and render to PIL Image via pdfplumber
            if isinstance(page, pdfplumber.page.Page):
                # Native pdfplumber path
                page_width = float(page.width)
                page_height = float(page.height)
                # Render at 300 DPI (pdfplumber default bbox is in points, 72pt = 1 inch)
                img = page.to_image(resolution=300).original
                if img.mode != "RGB":
                    img = img.convert("RGB")
            else:
                # Legacy path — render the page from raw bytes via pdfplumber
                if pdf_bytes is None or pdf_page_index is None:
                    logger.error(
                        "process_page: legacy page object requires pdf_bytes and pdf_page_index"
                    )
                    return []
                with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                    plumber_page = pdf.pages[pdf_page_index]
                    page_width = float(plumber_page.width)
                    page_height = float(plumber_page.height)
                    img = plumber_page.to_image(resolution=300).original
                    if img.mode != "RGB":
                        img = img.convert("RGB")

            # Run OCR with detailed output
            data = pytesseract.image_to_data(
                img,
                lang=languages,
                output_type=pytesseract.Output.DICT,
            )

            # Process OCR results
            n_boxes = len(data["text"])

            for i in range(n_boxes):
                text = data["text"][i].strip()
                confidence = float(data["conf"][i])

                if not text or confidence < confidence_threshold:
                    continue

                # Get bounding box (in image/web coordinates - Y=0 at top)
                x = data["left"][i]
                y = data["top"][i]
                w = data["width"][i]
                h = data["height"][i]

                # Scale back to PDF points (image was rendered at 300 DPI)
                scale = 72 / 300
                web_x = x * scale
                web_y = y * scale
                web_w = w * scale
                web_h = h * scale

                # Tesseract already returns web coordinates (top-left origin)
                # No need to flip - just use the scaled values directly
                web_rect = Rect(x=web_x, y=web_y, width=web_w, height=web_h)

                # Estimate font size from height
                font_size = max(8, min(72, web_h * 0.8))

                element = TextElement(
                    element_id=generate_uuid(),
                    type=ElementType.TEXT,
                    bounds=Bounds(
                        x=web_rect.x,
                        y=web_rect.y,
                        width=web_rect.width,
                        height=web_rect.height,
                    ),
                    content=text,
                    style=TextStyle(
                        font_family="Helvetica",
                        font_size=font_size,
                    ),
                    transform=Transform(),
                    ocr_confidence=confidence,
                )
                elements.append(element)

            logger.info(
                f"OCR completed for page {page_number}: {len(elements)} text elements"
            )

        except Exception as e:
            logger.error(f"OCR failed for page {page_number}: {e}")

        return elements

    def process_document(
        self,
        doc: object,
        page_numbers: Optional[list[int]] = None,
        languages: str = "eng",
        confidence_threshold: float = 60.0,
        progress_callback: Optional[callable] = None,
        *,
        pdf_bytes: Optional[bytes] = None,
    ) -> dict[int, list[TextElement]]:
        """
        Perform OCR on multiple pages.

        Args:
            doc: pdfplumber PDF object or a legacy document proxy that exposes
                 .page_count. When `doc` is a legacy proxy, supply `pdf_bytes`
                 so pages can be rendered via pdfplumber.
            page_numbers: Specific pages to process (None for all).
            languages: Tesseract language codes.
            confidence_threshold: Minimum confidence threshold.
            progress_callback: Callback for progress updates.
            pdf_bytes: Raw PDF bytes for pdfplumber rendering (legacy path).

        Returns:
            dict: Mapping of page number to text elements.
        """
        results = {}

        if isinstance(doc, pdfplumber.PDF):
            # Native pdfplumber path
            total = len(doc.pages)
            if page_numbers is None:
                page_numbers = list(range(1, total + 1))
            total_pages = len(page_numbers)
            for idx, page_num in enumerate(page_numbers):
                if page_num < 1 or page_num > total:
                    continue
                plumber_page = doc.pages[page_num - 1]
                elements = self.process_page(plumber_page, page_num, languages, confidence_threshold)
                results[page_num] = elements
                if progress_callback:
                    progress_callback(((idx + 1) / total_pages) * 100, f"Processing page {page_num}")
        else:
            # Legacy path — doc has .page_count; render via pdf_bytes
            doc_page_count = getattr(doc, "page_count", 0)
            if page_numbers is None:
                page_numbers = list(range(1, doc_page_count + 1))
            total_pages = len(page_numbers)
            for idx, page_num in enumerate(page_numbers):
                if page_num < 1 or page_num > doc_page_count:
                    continue
                elements = self.process_page(
                    doc,  # legacy proxy — process_page will use pdf_bytes
                    page_num,
                    languages,
                    confidence_threshold,
                    pdf_bytes=pdf_bytes,
                    pdf_page_index=page_num - 1,
                )
                results[page_num] = elements
                if progress_callback:
                    progress_callback(((idx + 1) / total_pages) * 100, f"Processing page {page_num}")

        return results

    def add_ocr_layer(
        self,
        doc: object,
        page_number: int,
        elements: list[TextElement],
    ) -> None:
        """
        Add invisible OCR text layer to page.

        DEPRECATED: Invisible text insertion is now handled by
        @giga-pdf/pdf-engine (TypeScript). This method is a no-op stub kept
        so that existing call sites do not break.

        TODO: Remove this method once callers are migrated to the TS engine.

        Args:
            doc: Document handle (ignored — no-op).
            page_number: Page number (1-indexed, ignored).
            elements: OCR text elements (ignored).
        """
        logger.warning(
            "OCRProcessor.add_ocr_layer() is deprecated and is now a no-op. "
            "Invisible OCR text insertion is handled by @giga-pdf/pdf-engine (TypeScript)."
        )

    def get_available_languages(self) -> list[str]:
        """
        Get list of available Tesseract languages.

        Returns:
            list[str]: Available language codes.
        """
        if not self._tesseract_available:
            return []

        try:
            import pytesseract
            return pytesseract.get_languages()
        except Exception:
            return ["eng"]  # Default fallback


# Global OCR processor instance
ocr_processor = OCRProcessor()
