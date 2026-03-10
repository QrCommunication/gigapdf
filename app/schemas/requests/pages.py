"""Request schemas for page operations."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class AddPageRequest(BaseModel):
    """Request to add a new page."""

    position: int = Field(ge=1, description="Position to insert (1-indexed)")
    source: dict = Field(
        default={"type": "blank", "dimensions": {"width": 612, "height": 792}},
        description="Page source configuration",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "position": 2,
                "source": {"type": "blank", "dimensions": {"width": 612, "height": 792}},
            }
        }


class RotatePageRequest(BaseModel):
    """Request to rotate a page."""

    angle: int = Field(
        description="Rotation angle (90, 180, 270, -90, -180, -270)"
    )

    class Config:
        json_schema_extra = {"example": {"angle": 90}}


class ResizePageRequest(BaseModel):
    """Request to resize a page."""

    width: float = Field(gt=0, description="New width in points")
    height: float = Field(gt=0, description="New height in points")
    anchor: Literal[
        "top-left", "top-center", "top-right",
        "center-left", "center", "center-right",
        "bottom-left", "bottom-center", "bottom-right"
    ] = Field(default="top-left", description="Anchor point for resize")
    scale_content: bool = Field(
        default=False, description="Scale page content with resize"
    )

    class Config:
        json_schema_extra = {
            "example": {"width": 612, "height": 792, "anchor": "center", "scale_content": False}
        }


class ReorderPagesRequest(BaseModel):
    """Request to reorder pages."""

    new_order: list[int] = Field(description="New page order (1-indexed)")

    class Config:
        json_schema_extra = {"example": {"new_order": [3, 1, 2, 5, 4]}}


class ExtractPagesRequest(BaseModel):
    """Request to extract pages to a new document."""

    page_numbers: Optional[list[int]] = Field(
        default=None, description="Specific page numbers to extract"
    )
    page_ranges: Optional[list[str]] = Field(
        default=None, description="Page ranges like '1-5', '10-15'"
    )

    class Config:
        json_schema_extra = {
            "example": {"page_numbers": [1, 3, 5], "page_ranges": ["10-15"]}
        }
