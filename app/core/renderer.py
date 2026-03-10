"""
PDF Renderer - Applies changes from scene graph back to PDF.

Takes modifications made through the API and applies them
to the actual PDF document using PyMuPDF.
"""

import logging
from typing import Any, Optional

import fitz  # PyMuPDF

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
from app.utils.coordinates import web_rect_to_pdf

logger = logging.getLogger(__name__)


class PDFRenderer:
    """
    Renders scene graph changes back to PDF.

    Handles the conversion from our model format back to
    PyMuPDF operations.
    """

    def __init__(self, doc: fitz.Document):
        """
        Initialize renderer with document.

        Args:
            doc: PyMuPDF document to render to.
        """
        self.doc = doc

    def add_text(
        self,
        page_number: int,
        element: TextElement,
    ) -> None:
        """
        Add text element to page.

        Args:
            page_number: Page number (1-indexed).
            element: Text element to add.
        """
        page = self.doc[page_number - 1]
        page_height = page.rect.height

        # Convert web coordinates to PDF
        x0, y0, x1, y1 = web_rect_to_pdf(
            element.bounds.x,
            element.bounds.y,
            element.bounds.width,
            element.bounds.height,
            page_height,
        )

        # Create text insertion point (bottom-left in PDF coords)
        point = fitz.Point(x0, y1 - 2)  # Slight offset from bottom

        # Parse color
        color = self._hex_to_rgb(element.style.color)

        # Get font name
        fontname = self._get_pdf_font(element.style.font_family, element.style.font_weight == "bold")

        # Insert text
        page.insert_text(
            point,
            element.content,
            fontname=fontname,
            fontsize=element.style.font_size,
            color=color,
            rotate=int(element.transform.rotation) if element.transform else 0,
        )

        logger.debug(f"Added text element to page {page_number}")

    def update_text(
        self,
        page_number: int,
        old_bounds: Bounds,
        element: TextElement,
    ) -> None:
        """
        Update existing text element.

        Note: PDF text editing is complex. This method removes
        the old text area and inserts new text.

        Args:
            page_number: Page number (1-indexed).
            old_bounds: Original text bounds.
            element: Updated text element.
        """
        page = self.doc[page_number - 1]
        page_height = page.rect.height

        # Convert old bounds to PDF coordinates
        x0, y0, x1, y1 = web_rect_to_pdf(
            old_bounds.x,
            old_bounds.y,
            old_bounds.width,
            old_bounds.height,
            page_height,
        )

        # Create redaction to remove old text
        rect = fitz.Rect(x0, y0, x1, y1)
        page.add_redact_annot(rect)
        page.apply_redactions()

        # Add new text
        self.add_text(page_number, element)

        logger.debug(f"Updated text element on page {page_number}")

    def add_image(
        self,
        page_number: int,
        element: ImageElement,
        image_data: bytes,
    ) -> None:
        """
        Add image element to page.

        Args:
            page_number: Page number (1-indexed).
            element: Image element with position info.
            image_data: Raw image bytes.
        """
        page = self.doc[page_number - 1]
        page_height = page.rect.height

        # Convert web coordinates to PDF
        x0, y0, x1, y1 = web_rect_to_pdf(
            element.bounds.x,
            element.bounds.y,
            element.bounds.width,
            element.bounds.height,
            page_height,
        )

        rect = fitz.Rect(x0, y0, x1, y1)

        # Insert image
        page.insert_image(rect, stream=image_data)

        logger.debug(f"Added image element to page {page_number}")

    def update_image(
        self,
        page_number: int,
        old_bounds: Bounds,
        element: ImageElement,
        image_data: Optional[bytes] = None,
    ) -> None:
        """
        Update existing image element.

        Args:
            page_number: Page number (1-indexed).
            old_bounds: Original image bounds.
            element: Updated image element.
            image_data: New image data (if replacing).
        """
        page = self.doc[page_number - 1]
        page_height = page.rect.height

        # Convert old bounds
        x0, y0, x1, y1 = web_rect_to_pdf(
            old_bounds.x, old_bounds.y, old_bounds.width, old_bounds.height, page_height
        )

        # Remove old image area
        rect = fitz.Rect(x0, y0, x1, y1)
        page.add_redact_annot(rect)
        page.apply_redactions()

        # Add new image if data provided
        if image_data:
            self.add_image(page_number, element, image_data)

        logger.debug(f"Updated image element on page {page_number}")

    def add_shape(
        self,
        page_number: int,
        element: ShapeElement,
    ) -> None:
        """
        Add shape element to page.

        Args:
            page_number: Page number (1-indexed).
            element: Shape element to add.
        """
        page = self.doc[page_number - 1]
        page_height = page.rect.height

        # Convert web coordinates to PDF
        x0, y0, x1, y1 = web_rect_to_pdf(
            element.bounds.x,
            element.bounds.y,
            element.bounds.width,
            element.bounds.height,
            page_height,
        )

        rect = fitz.Rect(x0, y0, x1, y1)

        # Get colors
        fill_color = self._hex_to_rgb(element.style.fill_color) if element.style.fill_color else None
        stroke_color = self._hex_to_rgb(element.style.stroke_color) if element.style.stroke_color else None

        shape = page.new_shape()

        if element.shape_type == ShapeType.RECTANGLE:
            shape.draw_rect(rect)
        elif element.shape_type == ShapeType.ELLIPSE:
            shape.draw_oval(rect)
        elif element.shape_type == ShapeType.LINE:
            # Line from top-left to bottom-right
            shape.draw_line(fitz.Point(x0, y0), fitz.Point(x1, y1))
        elif element.shape_type == ShapeType.POLYGON:
            # Draw polygon from points
            if element.geometry.points:
                points = [
                    fitz.Point(
                        p.x,
                        page_height - p.y  # Convert Y coordinate
                    )
                    for p in element.geometry.points
                ]
                shape.draw_polyline(points)
        elif element.shape_type == ShapeType.PATH:
            # SVG path support would require additional parsing
            logger.warning("SVG path shapes not fully supported")

        # Apply styling
        shape.finish(
            color=stroke_color,
            fill=fill_color,
            width=element.style.stroke_width,
            dashes=element.style.stroke_dash_array if element.style.stroke_dash_array else None,
        )

        shape.commit()
        logger.debug(f"Added shape element to page {page_number}")

    def add_annotation(
        self,
        page_number: int,
        element: AnnotationElement,
    ) -> fitz.Annot:
        """
        Add annotation to page.

        Args:
            page_number: Page number (1-indexed).
            element: Annotation element to add.

        Returns:
            fitz.Annot: Created annotation.
        """
        page = self.doc[page_number - 1]
        page_height = page.rect.height

        # Convert web coordinates to PDF
        x0, y0, x1, y1 = web_rect_to_pdf(
            element.bounds.x,
            element.bounds.y,
            element.bounds.width,
            element.bounds.height,
            page_height,
        )

        rect = fitz.Rect(x0, y0, x1, y1)
        color = self._hex_to_rgb(element.style.color)

        annot = None

        if element.annotation_type == AnnotationType.HIGHLIGHT:
            annot = page.add_highlight_annot(rect)
        elif element.annotation_type == AnnotationType.UNDERLINE:
            annot = page.add_underline_annot(rect)
        elif element.annotation_type == AnnotationType.STRIKEOUT:
            annot = page.add_strikeout_annot(rect)
        elif element.annotation_type == AnnotationType.SQUIGGLY:
            annot = page.add_squiggly_annot(rect)
        elif element.annotation_type == AnnotationType.NOTE:
            point = fitz.Point(x0, y1)
            annot = page.add_text_annot(point, element.content)
        elif element.annotation_type == AnnotationType.FREETEXT:
            annot = page.add_freetext_annot(rect, element.content)
        elif element.annotation_type == AnnotationType.LINK:
            if element.link_destination:
                if element.link_destination.type == "external":
                    annot = page.insert_link({
                        "kind": fitz.LINK_URI,
                        "from": rect,
                        "uri": element.link_destination.url,
                    })
                elif element.link_destination.type == "internal":
                    annot = page.insert_link({
                        "kind": fitz.LINK_GOTO,
                        "from": rect,
                        "page": element.link_destination.page_number - 1,
                    })

        if annot and hasattr(annot, "set_colors"):
            annot.set_colors(stroke=color)
            annot.set_opacity(element.style.opacity)
            annot.update()

        logger.debug(f"Added annotation to page {page_number}")
        return annot

    def add_form_field(
        self,
        page_number: int,
        element: FormFieldElement,
    ) -> None:
        """
        Add form field to page.

        Args:
            page_number: Page number (1-indexed).
            element: Form field element to add.
        """
        page = self.doc[page_number - 1]
        page_height = page.rect.height

        # Convert web coordinates to PDF
        x0, y0, x1, y1 = web_rect_to_pdf(
            element.bounds.x,
            element.bounds.y,
            element.bounds.width,
            element.bounds.height,
            page_height,
        )

        rect = fitz.Rect(x0, y0, x1, y1)

        # Map field type to widget type
        widget_type_map = {
            "text": fitz.PDF_WIDGET_TYPE_TEXT,
            "checkbox": fitz.PDF_WIDGET_TYPE_CHECKBOX,
            "radio": fitz.PDF_WIDGET_TYPE_RADIOBUTTON,
            "dropdown": fitz.PDF_WIDGET_TYPE_COMBOBOX,
            "listbox": fitz.PDF_WIDGET_TYPE_LISTBOX,
            "signature": fitz.PDF_WIDGET_TYPE_SIGNATURE,
            "button": fitz.PDF_WIDGET_TYPE_BUTTON,
        }

        field_type = widget_type_map.get(element.field_type.value, fitz.PDF_WIDGET_TYPE_TEXT)

        # Create widget
        widget = fitz.Widget()
        widget.field_type = field_type
        widget.field_name = element.field_name
        widget.rect = rect
        widget.field_value = str(element.value) if element.value else ""

        # Set text properties
        widget.text_fontsize = element.style.font_size
        widget.text_color = self._hex_to_rgb(element.style.text_color)

        if element.style.background_color:
            widget.fill_color = self._hex_to_rgb(element.style.background_color)

        if element.style.border_color:
            widget.border_color = self._hex_to_rgb(element.style.border_color)

        # Set options for choice fields
        if element.options:
            widget.choice_values = element.options

        # Add widget to page
        page.add_widget(widget)

        logger.debug(f"Added form field '{element.field_name}' to page {page_number}")

    def update_form_field_value(
        self,
        page_number: int,
        field_name: str,
        value: Any,
    ) -> bool:
        """
        Update form field value.

        Args:
            page_number: Page number (1-indexed).
            field_name: Field name to update.
            value: New field value.

        Returns:
            bool: True if field was found and updated.
        """
        page = self.doc[page_number - 1]

        for widget in page.widgets():
            if widget.field_name == field_name:
                if widget.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                    widget.field_value = "Yes" if value else "Off"
                else:
                    widget.field_value = str(value)
                widget.update()
                logger.debug(f"Updated form field '{field_name}' value")
                return True

        return False

    def delete_element_area(
        self,
        page_number: int,
        bounds: Bounds,
    ) -> None:
        """
        Delete content in a rectangular area.

        Args:
            page_number: Page number (1-indexed).
            bounds: Area to clear.
        """
        page = self.doc[page_number - 1]
        page_height = page.rect.height

        # Convert web coordinates to PDF
        x0, y0, x1, y1 = web_rect_to_pdf(
            bounds.x, bounds.y, bounds.width, bounds.height, page_height
        )

        rect = fitz.Rect(x0, y0, x1, y1)

        # Add redaction annotation
        page.add_redact_annot(rect)
        page.apply_redactions()

        logger.debug(f"Deleted element area on page {page_number}")

    def flatten_annotations(self, page_number: Optional[int] = None) -> None:
        """
        Flatten annotations into page content.

        Args:
            page_number: Specific page (1-indexed) or None for all pages.
        """
        if page_number:
            pages = [self.doc[page_number - 1]]
        else:
            pages = self.doc

        for page in pages:
            # Get all annotations
            annots = list(page.annots())
            for annot in annots:
                try:
                    # Convert annotation to drawing
                    annot.update()
                except Exception as e:
                    logger.warning(f"Failed to flatten annotation: {e}")

        logger.debug("Flattened annotations")

    def flatten_forms(self, page_number: Optional[int] = None) -> None:
        """
        Flatten form fields into page content.

        Args:
            page_number: Specific page (1-indexed) or None for all pages.
        """
        if page_number:
            pages = [self.doc[page_number - 1]]
        else:
            pages = self.doc

        for page in pages:
            for widget in list(page.widgets()):
                try:
                    # Get field value and position
                    value = widget.field_value
                    rect = widget.rect

                    if value and widget.field_type == fitz.PDF_WIDGET_TYPE_TEXT:
                        # Insert as text
                        page.insert_text(
                            fitz.Point(rect.x0, rect.y1 - 2),
                            str(value),
                            fontsize=widget.text_fontsize or 12,
                        )

                    # Remove widget
                    widget.update()
                except Exception as e:
                    logger.warning(f"Failed to flatten form field: {e}")

        logger.debug("Flattened form fields")

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
