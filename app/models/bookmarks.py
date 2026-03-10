"""
Bookmark model for PDF document outlines.

Bookmarks (outlines) provide a hierarchical table of contents
for navigating within a PDF document.
"""

from typing import Literal, Optional

from pydantic import ConfigDict, Field

from app.models.base import CamelCaseModel, to_camel


class BookmarkDestination(CamelCaseModel):
    """Navigation destination for a bookmark."""

    page_number: int = Field(ge=1, description="Target page number (1-indexed)")
    position: Optional[dict[str, float]] = Field(
        default=None, description="Position on page {x, y}"
    )
    zoom: Optional[float | Literal["fit", "fit-width", "fit-height"]] = Field(
        default=None, description="Zoom level or fit mode"
    )


class BookmarkStyle(CamelCaseModel):
    """Visual style for bookmark entry."""

    bold: bool = Field(default=False, description="Bold text")
    italic: bool = Field(default=False, description="Italic text")
    color: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")


class BookmarkObject(CamelCaseModel):
    """
    PDF bookmark (outline entry).

    Bookmarks form a hierarchical tree structure for document navigation.
    Each bookmark can have child bookmarks.
    """

    bookmark_id: str = Field(description="Unique bookmark identifier (UUID v4)")
    title: str = Field(description="Bookmark display title")
    destination: BookmarkDestination = Field(description="Navigation destination")
    style: BookmarkStyle = Field(default_factory=BookmarkStyle, description="Visual style")
    children: list["BookmarkObject"] = Field(
        default_factory=list, description="Child bookmarks"
    )

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "bookmarkId": "550e8400-e29b-41d4-a716-446655440020",
                "title": "Chapter 1: Introduction",
                "destination": {"pageNumber": 1, "position": {"x": 0, "y": 792}, "zoom": "fit"},
                "style": {"bold": True, "italic": False, "color": "#000000"},
                "children": [
                    {
                        "bookmarkId": "550e8400-e29b-41d4-a716-446655440021",
                        "title": "1.1 Overview",
                        "destination": {"pageNumber": 2, "position": None, "zoom": None},
                        "style": {"bold": False, "italic": False, "color": "#000000"},
                        "children": [],
                    }
                ],
            }
        },
    )


# Enable forward references for recursive type
BookmarkObject.model_rebuild()
