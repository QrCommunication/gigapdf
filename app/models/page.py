"""
Page model for PDF page representation.

A page contains all elements and metadata for a single PDF page,
with coordinates in web-standard format.
"""

from typing import Optional

from pydantic import BaseModel, Field

from app.models.elements import Element


class Dimensions(BaseModel):
    """Page dimensions in PDF points."""

    width: float = Field(gt=0, description="Page width in points")
    height: float = Field(gt=0, description="Page height in points")
    rotation: int = Field(
        default=0,
        description="Page rotation (0, 90, 180, 270 degrees)",
    )

    def model_post_init(self, __context) -> None:
        """Validate rotation value."""
        if self.rotation not in (0, 90, 180, 270):
            raise ValueError("Rotation must be 0, 90, 180, or 270 degrees")


class MediaBox(BaseModel):
    """
    PDF media box defining the page boundaries.

    The media box is the largest page boundary and defines
    the physical size of the page.
    """

    x: float = Field(default=0, description="X origin")
    y: float = Field(default=0, description="Y origin")
    width: float = Field(gt=0, description="Box width in points")
    height: float = Field(gt=0, description="Box height in points")


class PagePreview(BaseModel):
    """Preview URLs for page rendering."""

    thumbnail_url: str = Field(description="URL for low-resolution thumbnail")
    full_url: str = Field(description="URL for full-resolution preview")


class PageObject(BaseModel):
    """
    Complete representation of a PDF page.

    Contains all page metadata, dimensions, and elements.
    Coordinates use web-standard system (origin top-left).
    """

    page_id: str = Field(description="Unique page identifier (UUID v4)")
    page_number: int = Field(ge=1, description="Page number (1-indexed)")
    dimensions: Dimensions = Field(description="Page dimensions")
    media_box: MediaBox = Field(description="PDF media box")
    crop_box: Optional[MediaBox] = Field(default=None, description="Optional crop box")
    elements: list[Element] = Field(default_factory=list, description="Page elements")
    preview: Optional[PagePreview] = Field(default=None, description="Preview URLs")

    class Config:
        """Pydantic configuration."""

        json_schema_extra = {
            "example": {
                "page_id": "550e8400-e29b-41d4-a716-446655440001",
                "page_number": 1,
                "dimensions": {"width": 612.0, "height": 792.0, "rotation": 0},
                "media_box": {"x": 0, "y": 0, "width": 612.0, "height": 792.0},
                "elements": [],
                "preview": {
                    "thumbnail_url": "/api/v1/documents/abc123/pages/1/preview?dpi=72",
                    "full_url": "/api/v1/documents/abc123/pages/1/preview?dpi=150",
                },
            }
        }


class PageSummary(BaseModel):
    """Lightweight page representation for listings."""

    page_id: str = Field(description="Unique page identifier")
    page_number: int = Field(ge=1, description="Page number")
    dimensions: Dimensions = Field(description="Page dimensions")
    element_count: int = Field(ge=0, description="Number of elements on page")
    thumbnail_url: Optional[str] = Field(default=None, description="Thumbnail URL")
