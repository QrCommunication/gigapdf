"""
OCR Integration - Text recognition using Tesseract.

Provides OCR capabilities for scanned PDF pages,
converting images to searchable text.
"""

import io
import logging
from typing import Optional

import fitz  # PyMuPDF
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
        page: fitz.Page,
        page_number: int,
        languages: str = "eng",
        confidence_threshold: float = 60.0,
    ) -> list[TextElement]:
        """
        Perform OCR on a page and return text elements.

        Args:
            page: PyMuPDF page.
            page_number: Page number for logging.
            languages: Tesseract language codes (e.g., "eng+fra").
            confidence_threshold: Minimum confidence to include text.

        Returns:
            list[TextElement]: Extracted text elements with positions.
        """
        if not self._tesseract_available:
            logger.warning("OCR requested but Tesseract not available")
            return []

        import pytesseract

        elements = []
        page_height = page.rect.height
        page_width = page.rect.width

        try:
            # Render page to image at high DPI for OCR
            zoom = 300 / 72  # 300 DPI
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat, alpha=False)

            # Convert to PIL Image
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

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
        doc: fitz.Document,
        page_numbers: Optional[list[int]] = None,
        languages: str = "eng",
        confidence_threshold: float = 60.0,
        progress_callback: Optional[callable] = None,
    ) -> dict[int, list[TextElement]]:
        """
        Perform OCR on multiple pages.

        Args:
            doc: PyMuPDF document.
            page_numbers: Specific pages to process (None for all).
            languages: Tesseract language codes.
            confidence_threshold: Minimum confidence threshold.
            progress_callback: Callback for progress updates.

        Returns:
            dict: Mapping of page number to text elements.
        """
        if page_numbers is None:
            page_numbers = list(range(1, doc.page_count + 1))

        results = {}
        total_pages = len(page_numbers)

        for idx, page_num in enumerate(page_numbers):
            if page_num < 1 or page_num > doc.page_count:
                continue

            page = doc[page_num - 1]
            elements = self.process_page(
                page, page_num, languages, confidence_threshold
            )
            results[page_num] = elements

            # Report progress
            if progress_callback:
                progress = ((idx + 1) / total_pages) * 100
                progress_callback(progress, f"Processing page {page_num}")

        return results

    def add_ocr_layer(
        self,
        doc: fitz.Document,
        page_number: int,
        elements: list[TextElement],
    ) -> None:
        """
        Add invisible OCR text layer to page.

        This makes the PDF searchable while preserving
        the original scanned image.

        Args:
            doc: PyMuPDF document.
            page_number: Page number (1-indexed).
            elements: OCR text elements to add.
        """
        page = doc[page_number - 1]
        page_height = page.rect.height

        for element in elements:
            # Convert web coordinates back to PDF
            x = element.bounds.x
            y = page_height - element.bounds.y - element.bounds.height

            # Insert invisible text
            point = fitz.Point(x, y + element.bounds.height)

            # Use very small opacity to make text invisible but searchable
            page.insert_text(
                point,
                element.content,
                fontsize=element.style.font_size,
                fontname="helv",
                render_mode=3,  # Invisible text
            )

        logger.info(f"Added OCR layer to page {page_number}")

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
