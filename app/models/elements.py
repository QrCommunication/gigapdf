"""
Element models for PDF content representation.

Elements are the building blocks of PDF pages: text, images, shapes,
annotations, and form fields. All coordinates use web-standard system
(origin top-left, Y increases downward).
"""

from enum import Enum
from typing import Annotated, Literal, Optional, Union

from pydantic import Field

from app.models.base import CamelCaseModel


class ElementType(str, Enum):
    """Types of elements that can exist on a PDF page."""

    TEXT = "text"
    IMAGE = "image"
    SHAPE = "shape"
    ANNOTATION = "annotation"
    FORM_FIELD = "form_field"


class Bounds(CamelCaseModel):
    """
    Bounding rectangle for an element.

    Uses web coordinates: origin at top-left, Y increases downward.
    All values are in PDF points (1 point = 1/72 inch).
    """

    x: float = Field(description="X coordinate of top-left corner (points)")
    y: float = Field(description="Y coordinate of top-left corner (points)")
    width: float = Field(ge=0, description="Width in points")
    height: float = Field(ge=0, description="Height in points")


class Transform(CamelCaseModel):
    """Transformation matrix for an element."""

    rotation: float = Field(default=0.0, description="Rotation angle in degrees")
    scale_x: float = Field(default=1.0, description="Horizontal scale factor")
    scale_y: float = Field(default=1.0, description="Vertical scale factor")
    skew_x: float = Field(default=0.0, description="Horizontal skew in degrees")
    skew_y: float = Field(default=0.0, description="Vertical skew in degrees")


class ElementBase(CamelCaseModel):
    """Base class for all PDF elements."""

    element_id: str = Field(description="Unique identifier (UUID v4)")
    type: ElementType = Field(description="Element type")
    bounds: Bounds = Field(description="Bounding rectangle")
    transform: Transform = Field(default_factory=Transform, description="Transformation")
    layer_id: Optional[str] = Field(default=None, description="Optional layer ID")
    locked: bool = Field(default=False, description="Whether element is locked")
    visible: bool = Field(default=True, description="Whether element is visible")


# =============================================================================
# Text Element
# =============================================================================


class TextStyle(CamelCaseModel):
    """Styling for text elements."""

    font_family: str = Field(default="Helvetica", description="Font family name")
    font_size: float = Field(default=12.0, ge=1, description="Font size in points")
    font_weight: Literal["normal", "bold"] = Field(default="normal")
    font_style: Literal["normal", "italic"] = Field(default="normal")
    color: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")
    opacity: float = Field(default=1.0, ge=0, le=1)
    text_align: Literal["left", "center", "right", "justify"] = Field(default="left")
    line_height: float = Field(default=1.2, ge=0.5, description="Line height multiplier")
    letter_spacing: float = Field(default=0.0, description="Letter spacing in points")
    writing_mode: Literal["horizontal-tb", "vertical-rl"] = Field(default="horizontal-tb")


class TextElement(ElementBase):
    """Text element on a PDF page."""

    type: Literal[ElementType.TEXT] = ElementType.TEXT
    content: str = Field(description="Text content")
    style: TextStyle = Field(default_factory=TextStyle, description="Text styling")
    ocr_confidence: Optional[float] = Field(
        default=None, ge=0, le=100, description="OCR confidence score if from OCR"
    )


# =============================================================================
# Image Element
# =============================================================================


class ImageSource(CamelCaseModel):
    """Source information for an image element."""

    type: Literal["embedded", "external"] = Field(default="embedded")
    data_url: str = Field(description="URL endpoint to retrieve image data")
    original_format: str = Field(description="Original image format (jpeg, png, etc.)")
    original_dimensions: dict[str, int] = Field(
        description="Original width and height in pixels"
    )


class ImageStyle(CamelCaseModel):
    """Styling for image elements."""

    opacity: float = Field(default=1.0, ge=0, le=1)
    blend_mode: Literal[
        "normal", "multiply", "screen", "overlay", "darken", "lighten"
    ] = Field(default="normal")


class ImageCrop(CamelCaseModel):
    """Crop rectangle for an image (in percentage of original dimensions)."""

    x: float = Field(ge=0, le=100, description="X offset percentage")
    y: float = Field(ge=0, le=100, description="Y offset percentage")
    width: float = Field(gt=0, le=100, description="Width percentage")
    height: float = Field(gt=0, le=100, description="Height percentage")


class ImageElement(ElementBase):
    """Image element on a PDF page."""

    type: Literal[ElementType.IMAGE] = ElementType.IMAGE
    source: ImageSource = Field(description="Image source information")
    style: ImageStyle = Field(default_factory=ImageStyle, description="Image styling")
    crop: Optional[ImageCrop] = Field(default=None, description="Optional crop region")


# =============================================================================
# Shape Element
# =============================================================================


class ShapeType(str, Enum):
    """Types of shapes that can be drawn."""

    RECTANGLE = "rectangle"
    ELLIPSE = "ellipse"
    LINE = "line"
    POLYGON = "polygon"
    PATH = "path"


class Point(CamelCaseModel):
    """A 2D point."""

    x: float
    y: float


class ShapeGeometry(CamelCaseModel):
    """Geometry definition for shapes."""

    points: list[Point] = Field(default_factory=list, description="Points for polygon/path")
    path_data: Optional[str] = Field(default=None, description="SVG path syntax for complex shapes")
    corner_radius: float = Field(default=0.0, ge=0, description="Corner radius for rectangles")


class ShapeStyle(CamelCaseModel):
    """Styling for shape elements."""

    fill_color: Optional[str] = Field(
        default=None, pattern=r"^#[0-9A-Fa-f]{6}$", description="Fill color (hex)"
    )
    fill_opacity: float = Field(default=1.0, ge=0, le=1)
    stroke_color: Optional[str] = Field(
        default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$", description="Stroke color (hex)"
    )
    stroke_width: float = Field(default=1.0, ge=0, description="Stroke width in points")
    stroke_opacity: float = Field(default=1.0, ge=0, le=1)
    stroke_dash_array: list[float] = Field(
        default_factory=list, description="Dash pattern for stroke"
    )


class ShapeElement(ElementBase):
    """Shape element on a PDF page."""

    type: Literal[ElementType.SHAPE] = ElementType.SHAPE
    shape_type: ShapeType = Field(description="Type of shape")
    geometry: ShapeGeometry = Field(default_factory=ShapeGeometry, description="Shape geometry")
    style: ShapeStyle = Field(default_factory=ShapeStyle, description="Shape styling")


# =============================================================================
# Annotation Element
# =============================================================================


class AnnotationType(str, Enum):
    """Types of PDF annotations."""

    HIGHLIGHT = "highlight"
    UNDERLINE = "underline"
    STRIKEOUT = "strikeout"
    SQUIGGLY = "squiggly"
    NOTE = "note"
    FREETEXT = "freetext"
    STAMP = "stamp"
    LINK = "link"


class LinkDestination(CamelCaseModel):
    """Destination for a link annotation."""

    type: Literal["internal", "external"] = Field(description="Link type")
    page_number: Optional[int] = Field(default=None, description="Target page (internal)")
    url: Optional[str] = Field(default=None, description="Target URL (external)")
    position: Optional[Point] = Field(default=None, description="Position on target page")


class AnnotationPopup(CamelCaseModel):
    """Popup configuration for annotations."""

    is_open: bool = Field(default=False, description="Whether popup is initially open")
    bounds: Bounds = Field(description="Popup bounds")


class AnnotationStyle(CamelCaseModel):
    """Styling for annotations."""

    color: str = Field(default="#FFFF00", pattern=r"^#[0-9A-Fa-f]{6}$")
    opacity: float = Field(default=0.5, ge=0, le=1)


class AnnotationElement(ElementBase):
    """Annotation element on a PDF page."""

    type: Literal[ElementType.ANNOTATION] = ElementType.ANNOTATION
    annotation_type: AnnotationType = Field(description="Type of annotation")
    content: str = Field(default="", description="Annotation text content")
    style: AnnotationStyle = Field(default_factory=AnnotationStyle)
    link_destination: Optional[LinkDestination] = Field(
        default=None, description="Link destination (for link annotations)"
    )
    popup: Optional[AnnotationPopup] = Field(
        default=None, description="Popup configuration"
    )


# =============================================================================
# Form Field Element
# =============================================================================


class FieldType(str, Enum):
    """Types of form fields."""

    TEXT = "text"
    CHECKBOX = "checkbox"
    RADIO = "radio"
    DROPDOWN = "dropdown"
    LISTBOX = "listbox"
    SIGNATURE = "signature"
    BUTTON = "button"


class FieldFormat(CamelCaseModel):
    """Format settings for form fields."""

    type: Literal["none", "number", "date", "time", "percentage", "currency"] = Field(
        default="none"
    )
    pattern: Optional[str] = Field(default=None, description="Custom format pattern")


class FieldProperties(CamelCaseModel):
    """Properties for form fields."""

    required: bool = Field(default=False)
    read_only: bool = Field(default=False)
    max_length: Optional[int] = Field(default=None, ge=1)
    multiline: bool = Field(default=False)
    password: bool = Field(default=False)
    comb: bool = Field(default=False, description="Characters in separate cells")
    format: FieldFormat = Field(default_factory=FieldFormat)


class FieldStyle(CamelCaseModel):
    """Styling for form fields."""

    font_family: str = Field(default="Helvetica")
    font_size: float = Field(default=12.0, ge=1)
    text_color: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")
    background_color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    border_color: Optional[str] = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")
    border_width: float = Field(default=1.0, ge=0)


class FormFieldElement(ElementBase):
    """Form field element on a PDF page."""

    type: Literal[ElementType.FORM_FIELD] = ElementType.FORM_FIELD
    field_type: FieldType = Field(description="Type of form field")
    field_name: str = Field(description="Technical field name")
    value: Union[str, bool, list[str]] = Field(default="", description="Current field value")
    default_value: Union[str, bool, list[str]] = Field(default="", description="Default value")
    options: Optional[list[str]] = Field(
        default=None, description="Options for dropdown/listbox/radio"
    )
    properties: FieldProperties = Field(default_factory=FieldProperties)
    style: FieldStyle = Field(default_factory=FieldStyle)


# =============================================================================
# Union Type for All Elements
# =============================================================================

Element = Annotated[
    Union[TextElement, ImageElement, ShapeElement, AnnotationElement, FormFieldElement],
    Field(discriminator="type"),
]
