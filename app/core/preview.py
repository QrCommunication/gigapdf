"""
Preview Generator - Renders PDF pages to images.

Generates thumbnail and full-resolution previews of PDF pages
for display in the frontend.
"""

import io
import logging
from typing import Literal, Optional

import fitz  # PyMuPDF
from PIL import Image

from app.config import get_settings

logger = logging.getLogger(__name__)


class PreviewGenerator:
    """
    Generates image previews of PDF pages.

    Supports multiple output formats and resolution settings.
    """

    def __init__(self, doc: fitz.Document):
        """
        Initialize preview generator.

        Args:
            doc: PyMuPDF document.
        """
        self.doc = doc
        self.settings = get_settings()

    def render_page(
        self,
        page_number: int,
        dpi: int = 150,
        format: Literal["png", "jpeg", "webp", "svg"] = "png",
        quality: int = 85,
        scale: Optional[float] = None,
    ) -> bytes:
        """
        Render a page to an image.

        Args:
            page_number: Page number (1-indexed).
            dpi: Resolution in dots per inch.
            format: Output format (png, jpeg, webp, svg).
            quality: JPEG/WebP quality (1-100).
            scale: Alternative to dpi - direct scale factor.

        Returns:
            bytes: Image data.
        """
        # Validate DPI
        max_dpi = self.settings.preview_max_dpi
        dpi = min(dpi, max_dpi)

        # Get page
        page = self.doc[page_number - 1]

        # Calculate zoom factor
        if scale:
            zoom = scale
        else:
            zoom = dpi / 72  # 72 is the base PDF resolution

        # Create transformation matrix
        mat = fitz.Matrix(zoom, zoom)

        # Handle SVG format separately
        if format == "svg":
            return self._render_svg(page)

        # Render to pixmap
        pix = page.get_pixmap(matrix=mat, alpha=False)

        # Convert to PIL Image for format conversion
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Save to bytes
        output = io.BytesIO()

        if format == "png":
            img.save(output, format="PNG", optimize=True)
        elif format == "jpeg":
            img.save(output, format="JPEG", quality=quality, optimize=True)
        elif format == "webp":
            img.save(output, format="WEBP", quality=quality)

        return output.getvalue()

    def render_thumbnail(
        self,
        page_number: int,
        max_width: int = 200,
        max_height: int = 300,
        format: Literal["png", "jpeg", "webp"] = "png",
    ) -> bytes:
        """
        Render a thumbnail with maximum dimensions.

        Args:
            page_number: Page number (1-indexed).
            max_width: Maximum thumbnail width.
            max_height: Maximum thumbnail height.
            format: Output format.

        Returns:
            bytes: Thumbnail image data.
        """
        page = self.doc[page_number - 1]

        # Calculate scale to fit within max dimensions
        page_width = page.rect.width
        page_height = page.rect.height

        scale_x = max_width / page_width
        scale_y = max_height / page_height
        scale = min(scale_x, scale_y)

        # Render at calculated scale
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False)

        # Convert to PIL
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Save
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

        Args:
            max_width: Maximum thumbnail width.
            max_height: Maximum thumbnail height.
            format: Output format.

        Returns:
            dict: Mapping of page number to thumbnail bytes.
        """
        thumbnails = {}

        for page_num in range(1, self.doc.page_count + 1):
            thumbnails[page_num] = self.render_thumbnail(
                page_num, max_width, max_height, format
            )

        return thumbnails

    def _render_svg(self, page: fitz.Page) -> bytes:
        """
        Render page as SVG.

        Args:
            page: PyMuPDF page.

        Returns:
            bytes: SVG data.
        """
        svg = page.get_svg_image()
        return svg.encode("utf-8")

    def extract_page_image(
        self,
        page_number: int,
        xref: int,
        format: Optional[Literal["png", "jpeg", "webp"]] = None,
    ) -> tuple[bytes, str]:
        """
        Extract an embedded image from a page.

        Args:
            page_number: Page number (1-indexed).
            xref: Image xref number.
            format: Output format (None for original).

        Returns:
            tuple: (image_bytes, mime_type)
        """
        # Extract image
        img_info = self.doc.extract_image(xref)

        if not img_info:
            raise ValueError(f"Image not found: xref {xref}")

        image_bytes = img_info["image"]
        ext = img_info["ext"]

        # Determine mime type
        mime_map = {
            "png": "image/png",
            "jpeg": "image/jpeg",
            "jpg": "image/jpeg",
            "webp": "image/webp",
            "jbig2": "image/png",  # Convert to PNG
        }

        # Convert if requested
        if format and format != ext:
            img = Image.open(io.BytesIO(image_bytes))
            output = io.BytesIO()

            if format == "png":
                img.save(output, format="PNG")
            elif format == "jpeg":
                # Convert RGBA to RGB for JPEG
                if img.mode == "RGBA":
                    img = img.convert("RGB")
                img.save(output, format="JPEG", quality=85)
            elif format == "webp":
                img.save(output, format="WEBP", quality=85)

            image_bytes = output.getvalue()
            ext = format

        mime_type = mime_map.get(ext, "application/octet-stream")

        return image_bytes, mime_type

    def get_page_text_image(
        self,
        page_number: int,
        dpi: int = 300,
    ) -> bytes:
        """
        Render page suitable for OCR processing.

        High-contrast black and white rendering optimized for OCR.

        Args:
            page_number: Page number (1-indexed).
            dpi: Resolution (higher is better for OCR).

        Returns:
            bytes: PNG image data.
        """
        page = self.doc[page_number - 1]

        # High resolution for OCR
        zoom = dpi / 72
        mat = fitz.Matrix(zoom, zoom)

        # Render to pixmap
        pix = page.get_pixmap(matrix=mat, alpha=False)

        # Convert to grayscale PIL image
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img = img.convert("L")  # Grayscale

        # Enhance contrast for OCR
        from PIL import ImageEnhance
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.5)

        # Save as PNG
        output = io.BytesIO()
        img.save(output, format="PNG")

        return output.getvalue()
