"""
PDF Parser - Converts PDF content to scene graph representation.

Extracts text, images, shapes, annotations, and form fields
from PDF pages and converts them to our internal model format.
Includes automatic OCR for scanned/rasterized PDFs.
"""

import base64
import io
import logging
from typing import Any, Optional

import fitz  # PyMuPDF

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

    Converts PyMuPDF document structure into our internal
    model format with web-standard coordinates.
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
        doc: fitz.Document,
        extract_text: bool = True,
        extract_images: bool = True,
        include_previews: bool = True,
        enable_ocr: bool = True,
        ocr_languages: str = "fra+eng",
    ) -> DocumentObject:
        """
        Parse entire document into scene graph.

        Args:
            doc: PyMuPDF document.
            extract_text: Extract text elements.
            extract_images: Extract image elements.
            include_previews: Generate preview URLs.
            enable_ocr: Enable OCR for pages with no text but images.
            ocr_languages: Tesseract language codes (e.g., "fra+eng").

        Returns:
            DocumentObject: Complete document representation.
        """
        logger.info(f"Parsing document {self.document_id} with {doc.page_count} pages")

        # Parse metadata
        metadata = self._parse_metadata(doc)

        # Parse pages
        pages = []
        for page_num in range(doc.page_count):
            page = self.parse_page(
                doc[page_num],
                page_num + 1,
                extract_text=extract_text,
                extract_images=extract_images,
                include_previews=include_previews,
                enable_ocr=enable_ocr,
                ocr_languages=ocr_languages,
            )
            pages.append(page)

        # Parse bookmarks
        outlines = self._parse_bookmarks(doc)

        # Parse layers
        layers = self._parse_layers(doc)

        # Parse embedded files
        embedded_files = self._parse_embedded_files(doc)

        return DocumentObject(
            document_id=self.document_id,
            metadata=metadata,
            pages=pages,
            outlines=outlines,
            layers=layers,
            embedded_files=embedded_files,
        )

    def parse_page(
        self,
        page: fitz.Page,
        page_number: int,
        extract_text: bool = True,
        extract_images: bool = True,
        include_previews: bool = True,
        enable_ocr: bool = True,
        ocr_languages: str = "fra+eng",
    ) -> PageObject:
        """
        Parse a single page into scene graph.

        Args:
            page: PyMuPDF page.
            page_number: Page number (1-indexed).
            extract_text: Extract text elements.
            extract_images: Extract image elements.
            include_previews: Generate preview URLs.
            enable_ocr: Enable OCR for pages with no text but images.
            ocr_languages: Tesseract language codes.

        Returns:
            PageObject: Page representation.
        """
        page_id = generate_uuid()
        page_height = page.rect.height

        # Get dimensions
        dimensions = Dimensions(
            width=page.rect.width,
            height=page.rect.height,
            rotation=page.rotation,
        )

        # Get media box
        media_box = MediaBox(
            x=page.mediabox.x0,
            y=page.mediabox.y0,
            width=page.mediabox.width,
            height=page.mediabox.height,
        )

        # Get crop box if different from media box
        crop_box = None
        if page.cropbox != page.mediabox:
            crop_box = MediaBox(
                x=page.cropbox.x0,
                y=page.cropbox.y0,
                width=page.cropbox.width,
                height=page.cropbox.height,
            )

        # Extract elements
        elements = []
        text_elements = []
        image_elements = []

        # Extract vector drawings first (backgrounds, borders, shapes)
        # These should be rendered BEFORE text/images to appear as backgrounds
        drawing_elements = self._extract_drawings(page)
        elements.extend(drawing_elements)

        if extract_text:
            text_elements = self._extract_text_elements(page, page_height)
            elements.extend(text_elements)

        if extract_images:
            image_elements = self._extract_image_elements(page, page_number, page_height)
            elements.extend(image_elements)

        # OCR fallback: if no text was extracted but images exist, run OCR
        if enable_ocr and len(text_elements) == 0 and len(image_elements) > 0:
            if ocr_processor.is_available:
                logger.info(
                    f"Page {page_number}: No text found but has images, running OCR..."
                )
                ocr_elements = ocr_processor.process_page(
                    page=page,
                    page_number=page_number,
                    languages=ocr_languages,
                    confidence_threshold=50.0,  # Lower threshold for better coverage
                )
                if ocr_elements:
                    logger.info(
                        f"Page {page_number}: OCR extracted {len(ocr_elements)} text elements"
                    )
                    elements.extend(ocr_elements)
            else:
                logger.warning(
                    f"Page {page_number}: OCR needed but Tesseract not available"
                )

        # Extract annotations
        annotation_elements = self._extract_annotations(page, page_height)
        elements.extend(annotation_elements)

        # Extract form fields
        form_elements = self._extract_form_fields(page, page_height)
        elements.extend(form_elements)

        # Generate preview URLs
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
            crop_box=crop_box,
            elements=elements,
            preview=preview,
        )

    def _parse_metadata(self, doc: fitz.Document) -> DocumentMetadata:
        """Parse document metadata."""
        meta = doc.metadata or {}

        # Parse permissions
        permissions = DocumentPermissions(
            print=True,  # Will be updated based on actual permissions
            modify=True,
            copy=True,
            annotate=True,
        )

        return DocumentMetadata(
            title=meta.get("title"),
            author=meta.get("author"),
            subject=meta.get("subject"),
            keywords=meta.get("keywords", "").split(",") if meta.get("keywords") else [],
            creator=meta.get("creator"),
            producer=meta.get("producer"),
            creation_date=None,  # Would need date parsing
            modification_date=None,
            page_count=doc.page_count,
            pdf_version=meta.get("format", "PDF 1.7").replace("PDF ", ""),
            is_encrypted=doc.is_encrypted,
            permissions=permissions,
        )

    def _extract_text_elements(
        self, page: fitz.Page, page_height: float
    ) -> list[TextElement]:
        """
        Extract text elements from page with full styling.

        Uses rawdict for detailed style extraction including:
        - Font family, size, weight, style
        - Color and opacity
        - Text decorations (underline, strikethrough)
        - Links (internal and external)
        """
        elements = []

        # Get links for this page to associate with text
        links = self._get_page_links(page)

        # Get text with detailed styling using rawdict
        # FLAGS: preserve whitespace, preserve ligatures, preserve images positions
        flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES
        blocks = page.get_text("rawdict", flags=flags).get("blocks", [])

        for block in blocks:
            if block.get("type") != 0:  # Skip non-text blocks
                continue

            for line in block.get("lines", []):
                line_dir = line.get("dir", (1, 0))  # Text direction
                writing_mode = "vertical-rl" if abs(line_dir[0]) < 0.5 else "horizontal-tb"

                for span in line.get("spans", []):
                    # Get text - try 'text' field first, fallback to reconstructing from 'chars'
                    text = span.get("text", "")
                    if not text and "chars" in span:
                        # Reconstruct text from individual characters (newer PyMuPDF versions)
                        text = "".join(char.get("c", "") for char in span.get("chars", []))
                    if not text.strip():
                        continue

                    # Get bounding box - PyMuPDF uses top-left origin
                    bbox = span.get("bbox", [0, 0, 0, 0])
                    bounds = Rect(
                        x=bbox[0],
                        y=bbox[1],
                        width=bbox[2] - bbox[0],
                        height=bbox[3] - bbox[1],
                    )

                    # Extract font info
                    font_name = span.get("font", "Helvetica")
                    font_size = span.get("size", 12)
                    color = self._int_to_hex_color(span.get("color", 0))

                    # Get span flags for styling
                    span_flags = span.get("flags", 0)
                    # Flags: superscript=1, italic=2, serif=4, monospace=8, bold=16

                    # Determine styles from flags and font name
                    is_bold = bool(span_flags & 16) or "bold" in font_name.lower()
                    is_italic = bool(span_flags & 2) or "italic" in font_name.lower() or "oblique" in font_name.lower()
                    is_superscript = bool(span_flags & 1)

                    font_weight = "bold" if is_bold else "normal"
                    font_style = "italic" if is_italic else "normal"
                    vertical_align = "superscript" if is_superscript else "baseline"

                    # Check for underline/strikethrough (not in flags, check annotations)
                    # These are typically rendered as separate drawing elements

                    # Find associated link
                    link_url = None
                    link_page = None
                    span_rect = fitz.Rect(bbox)
                    for link in links:
                        if link["rect"].intersects(span_rect):
                            if link.get("uri"):
                                link_url = link["uri"]
                            elif link.get("page") is not None:
                                link_page = link["page"] + 1  # Convert to 1-indexed

                    # Get origin point for baseline positioning
                    origin = span.get("origin", (bbox[0], bbox[3]))

                    element = TextElement(
                        element_id=generate_uuid(),
                        type=ElementType.TEXT,
                        bounds=Bounds(
                            x=bounds.x,
                            y=bounds.y,
                            width=bounds.width,
                            height=bounds.height,
                        ),
                        content=text,
                        style=TextStyle(
                            font_family=self._normalize_font_name(font_name),
                            font_size=font_size,
                            font_weight=font_weight,
                            font_style=font_style,
                            color=color,
                            writing_mode=writing_mode,
                            vertical_align=vertical_align,
                            original_font=font_name,  # Preserve original font name
                        ),
                        transform=Transform(),
                        link_url=link_url,
                        link_page=link_page,
                    )
                    elements.append(element)

        return elements

    def _get_page_links(self, page: fitz.Page) -> list[dict]:
        """Extract all links from a page."""
        links = []
        for link in page.get_links():
            link_info = {
                "rect": fitz.Rect(link.get("from", [0, 0, 0, 0])),
                "uri": link.get("uri"),
                "page": link.get("page"),
                "kind": link.get("kind"),
            }
            links.append(link_info)
        return links

    def _extract_image_elements(
        self, page: fitz.Page, page_number: int, page_height: float
    ) -> list[ImageElement]:
        """Extract image elements from page."""
        elements = []

        # Get image list
        image_list = page.get_images()

        for img_index, img in enumerate(image_list):
            xref = img[0]

            try:
                # Get image info
                img_info = page.parent.extract_image(xref)
                if not img_info:
                    continue

                # Find image position on page
                img_rects = page.get_image_rects(xref)
                if not img_rects:
                    continue

                rect = img_rects[0]  # Use first occurrence
                # PyMuPDF's get_image_rects() returns coordinates in web-style format
                # (origin top-left, Y increases downward) - no conversion needed
                bounds = Rect(
                    x=rect.x0,
                    y=rect.y0,  # Already in web coordinates
                    width=rect.x1 - rect.x0,
                    height=rect.y1 - rect.y0,
                )

                # Determine format
                ext = img_info.get("ext", "png")
                mime_map = {"png": "png", "jpeg": "jpeg", "jpg": "jpeg", "jbig2": "png"}
                img_format = mime_map.get(ext, "png")

                element = ImageElement(
                    element_id=generate_uuid(),
                    type=ElementType.IMAGE,
                    bounds=Bounds(
                        x=bounds.x,
                        y=bounds.y,
                        width=bounds.width,
                        height=bounds.height,
                    ),
                    source=ImageSource(
                        type="embedded",
                        data_url=f"{self.base_url}/documents/{self.document_id}/pages/{page_number}/images/{xref}",
                        original_format=img_format,
                        original_dimensions={
                            "width": img_info.get("width", 0),
                            "height": img_info.get("height", 0),
                        },
                    ),
                    style=ImageStyle(),
                    transform=Transform(),
                )
                elements.append(element)

            except Exception as e:
                logger.warning(f"Failed to extract image {xref}: {e}")
                continue

        return elements

    def _extract_annotations(
        self, page: fitz.Page, page_height: float
    ) -> list[AnnotationElement]:
        """Extract annotations from page."""
        elements = []

        for annot in page.annots():
            try:
                annot_type = annot.type[0]  # Annotation type number

                # Map PyMuPDF annotation type to our type
                type_map = {
                    fitz.PDF_ANNOT_HIGHLIGHT: AnnotationType.HIGHLIGHT,
                    fitz.PDF_ANNOT_UNDERLINE: AnnotationType.UNDERLINE,
                    fitz.PDF_ANNOT_STRIKE_OUT: AnnotationType.STRIKEOUT,
                    fitz.PDF_ANNOT_SQUIGGLY: AnnotationType.SQUIGGLY,
                    fitz.PDF_ANNOT_TEXT: AnnotationType.NOTE,
                    fitz.PDF_ANNOT_FREE_TEXT: AnnotationType.FREETEXT,
                    fitz.PDF_ANNOT_STAMP: AnnotationType.STAMP,
                    fitz.PDF_ANNOT_LINK: AnnotationType.LINK,
                }

                if annot_type not in type_map:
                    continue

                # Get bounds - PyMuPDF uses top-left origin, no conversion needed
                rect = annot.rect
                bounds = Rect(
                    x=rect.x0,
                    y=rect.y0,
                    width=rect.x1 - rect.x0,
                    height=rect.y1 - rect.y0,
                )

                # Get colors
                colors = annot.colors
                stroke_color = self._tuple_to_hex_color(colors.get("stroke", (1, 1, 0)))

                # Get content
                content = annot.info.get("content", "")

                # Handle link destination
                link_dest = None
                if annot_type == fitz.PDF_ANNOT_LINK:
                    link = annot.info.get("uri")
                    if link:
                        link_dest = LinkDestination(type="external", url=link)

                element = AnnotationElement(
                    element_id=generate_uuid(),
                    type=ElementType.ANNOTATION,
                    bounds=Bounds(
                        x=bounds.x,
                        y=bounds.y,
                        width=bounds.width,
                        height=bounds.height,
                    ),
                    annotation_type=type_map[annot_type],
                    content=content,
                    style=AnnotationStyle(color=stroke_color, opacity=0.5),
                    link_destination=link_dest,
                    transform=Transform(),
                )
                elements.append(element)

            except Exception as e:
                logger.warning(f"Failed to extract annotation: {e}")
                continue

        return elements

    def _extract_drawings(self, page: fitz.Page) -> list[ShapeElement]:
        """
        Extract vector drawings (rectangles, lines, paths) from page.

        These include background colors, borders, and decorative elements.
        PyMuPDF uses top-left origin coordinates.
        """
        elements = []

        try:
            drawings = page.get_drawings()

            for drawing in drawings:
                try:
                    rect = drawing.get("rect")
                    if not rect:
                        continue

                    # Get fill and stroke colors
                    fill_tuple = drawing.get("fill")
                    stroke_tuple = drawing.get("color")
                    stroke_width = drawing.get("width", 0) or 0

                    # Convert color tuples to hex
                    fill_color = None
                    if fill_tuple:
                        fill_color = self._tuple_to_hex_color(fill_tuple)

                    stroke_color = None
                    if stroke_tuple:
                        stroke_color = self._tuple_to_hex_color(stroke_tuple)

                    # Skip if no visible fill or stroke
                    if not fill_color and not stroke_color:
                        continue

                    # Determine shape type based on items
                    items = drawing.get("items", [])
                    shape_type = ShapeType.RECTANGLE

                    # Check if it's a line (height or width is 0 or very small)
                    width = rect.x1 - rect.x0
                    height = rect.y1 - rect.y0

                    if height < 1 and width > 1:
                        shape_type = ShapeType.LINE
                    elif width < 1 and height > 1:
                        shape_type = ShapeType.LINE

                    # Create bounds - PyMuPDF uses top-left origin
                    bounds = Rect(
                        x=rect.x0,
                        y=rect.y0,
                        width=max(width, 1),  # Ensure minimum width for lines
                        height=max(height, 1),  # Ensure minimum height for lines
                    )

                    element = ShapeElement(
                        element_id=generate_uuid(),
                        type=ElementType.SHAPE,
                        bounds=Bounds(
                            x=bounds.x,
                            y=bounds.y,
                            width=bounds.width,
                            height=bounds.height,
                        ),
                        shape_type=shape_type,
                        geometry=ShapeGeometry(),
                        style=ShapeStyle(
                            fill_color=fill_color,
                            fill_opacity=1.0 if fill_color else 0.0,
                            stroke_color=stroke_color,
                            stroke_width=stroke_width if stroke_color else 0,
                            stroke_opacity=1.0 if stroke_color else 0.0,
                        ),
                        transform=Transform(),
                    )
                    elements.append(element)

                except Exception as e:
                    logger.warning(f"Failed to extract drawing: {e}")
                    continue

        except Exception as e:
            logger.warning(f"Failed to get drawings from page: {e}")

        logger.info(f"Extracted {len(elements)} vector drawings from page")
        return elements

    def _extract_form_fields(
        self, page: fitz.Page, page_height: float
    ) -> list[FormFieldElement]:
        """Extract form fields from page."""
        elements = []

        for widget in page.widgets():
            try:
                # Map field type
                field_type_map = {
                    fitz.PDF_WIDGET_TYPE_TEXT: FieldType.TEXT,
                    fitz.PDF_WIDGET_TYPE_CHECKBOX: FieldType.CHECKBOX,
                    fitz.PDF_WIDGET_TYPE_RADIOBUTTON: FieldType.RADIO,
                    fitz.PDF_WIDGET_TYPE_COMBOBOX: FieldType.DROPDOWN,
                    fitz.PDF_WIDGET_TYPE_LISTBOX: FieldType.LISTBOX,
                    fitz.PDF_WIDGET_TYPE_SIGNATURE: FieldType.SIGNATURE,
                    fitz.PDF_WIDGET_TYPE_BUTTON: FieldType.BUTTON,
                }

                widget_type = widget.field_type
                if widget_type not in field_type_map:
                    continue

                # Get bounds - PyMuPDF uses top-left origin, no conversion needed
                rect = widget.rect
                bounds = Rect(
                    x=rect.x0,
                    y=rect.y0,
                    width=rect.x1 - rect.x0,
                    height=rect.y1 - rect.y0,
                )

                # Get value
                value = widget.field_value or ""
                if widget_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                    value = widget.field_value == "Yes"

                # Get options for choice fields
                options = None
                if widget_type in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
                    options = widget.choice_values or []

                element = FormFieldElement(
                    element_id=generate_uuid(),
                    type=ElementType.FORM_FIELD,
                    bounds=Bounds(
                        x=bounds.x,
                        y=bounds.y,
                        width=bounds.width,
                        height=bounds.height,
                    ),
                    field_type=field_type_map[widget_type],
                    field_name=widget.field_name or generate_uuid(),
                    value=value,
                    default_value=value,
                    options=options,
                    properties=FieldProperties(
                        required=False,
                        read_only=widget.field_flags & 1 != 0,  # ReadOnly flag
                        multiline=widget.field_flags & 4096 != 0,  # Multiline flag
                    ),
                    style=FieldStyle(
                        font_size=widget.text_fontsize or 12,
                    ),
                    transform=Transform(),
                )
                elements.append(element)

            except Exception as e:
                logger.warning(f"Failed to extract form field: {e}")
                continue

        return elements

    def _parse_bookmarks(self, doc: fitz.Document) -> list[BookmarkObject]:
        """Parse document bookmarks/outlines."""
        bookmarks = []

        toc = doc.get_toc(simple=False)
        if not toc:
            return bookmarks

        # Build nested structure
        stack: list[tuple[int, list[BookmarkObject]]] = [(0, bookmarks)]

        for item in toc:
            level = item[0]
            title = item[1]
            page_num = item[2]
            dest = item[3] if len(item) > 3 else {}

            bookmark = BookmarkObject(
                bookmark_id=generate_uuid(),
                title=title,
                destination=BookmarkDestination(
                    page_number=max(1, page_num),
                    position={"x": dest.get("x", 0), "y": dest.get("y", 0)} if dest else None,
                    zoom=dest.get("zoom") if dest else None,
                ),
                style=BookmarkStyle(
                    bold=dest.get("bold", False) if isinstance(dest, dict) else False,
                    italic=dest.get("italic", False) if isinstance(dest, dict) else False,
                ),
                children=[],
            )

            # Find parent level
            while stack and stack[-1][0] >= level:
                stack.pop()

            if stack:
                stack[-1][1].append(bookmark)
            else:
                bookmarks.append(bookmark)

            stack.append((level, bookmark.children))

        return bookmarks

    def _parse_layers(self, doc: fitz.Document) -> list[LayerObject]:
        """Parse document layers (Optional Content Groups)."""
        layers = []

        try:
            # Get layer configuration
            layer_config = doc.layer_ui_configs()
            if not layer_config:
                return layers

            for idx, config in enumerate(layer_config):
                layer = LayerObject(
                    layer_id=generate_uuid(),
                    name=config.get("text", f"Layer {idx + 1}"),
                    visible=config.get("on", True),
                    locked=False,
                    opacity=1.0,
                    print=True,
                    order=idx,
                )
                layers.append(layer)

        except Exception as e:
            logger.warning(f"Failed to parse layers: {e}")

        return layers

    def _parse_embedded_files(self, doc: fitz.Document) -> list[EmbeddedFileObject]:
        """Parse embedded file attachments."""
        files = []

        try:
            for name in doc.embfile_names():
                info = doc.embfile_info(name)
                if not info:
                    continue

                file_obj = EmbeddedFileObject(
                    file_id=generate_uuid(),
                    name=info.get("filename", name),
                    mime_type=info.get("mime", "application/octet-stream"),
                    size_bytes=info.get("size", 0),
                    description=info.get("desc"),
                    data_url=f"{self.base_url}/documents/{self.document_id}/files/{name}",
                )
                files.append(file_obj)

        except Exception as e:
            logger.warning(f"Failed to parse embedded files: {e}")

        return files

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
