"""Request schemas for element operations."""

from typing import Literal

from pydantic import BaseModel, Field


class CreateElementRequest(BaseModel):
    """Request to create a new element."""

    type: Literal["text", "image", "shape", "annotation", "form_field"] = Field(
        description="Element type"
    )
    bounds: dict = Field(description="Element bounds {x, y, width, height}")
    content: str | None = Field(default=None, description="Text content (for text elements)")
    style: dict | None = Field(default=None, description="Element styling")
    transform: dict | None = Field(default=None, description="Element transformation")
    layer_id: str | None = Field(default=None, description="Target layer ID")

    # Type-specific fields
    shape_type: str | None = Field(default=None, description="Shape type (for shapes)")
    annotation_type: str | None = Field(default=None, description="Annotation type")
    field_type: str | None = Field(default=None, description="Form field type")
    field_name: str | None = Field(default=None, description="Form field name")

    class Config:
        json_schema_extra = {
            "example": {
                "type": "text",
                "bounds": {"x": 100, "y": 100, "width": 200, "height": 50},
                "content": "Hello, World!",
                "style": {"font_size": 14, "color": "#000000"},
            }
        }


class UpdateElementRequest(BaseModel):
    """Request to update an element."""

    bounds: dict | None = Field(default=None, description="Updated bounds")
    content: str | None = Field(default=None, description="Updated content")
    style: dict | None = Field(default=None, description="Updated style")
    transform: dict | None = Field(default=None, description="Updated transform")
    layer_id: str | None = Field(default=None, description="New layer ID")
    locked: bool | None = Field(default=None, description="Lock state")
    visible: bool | None = Field(default=None, description="Visibility state")

    class Config:
        json_schema_extra = {
            "example": {
                "bounds": {"x": 150, "y": 150, "width": 200, "height": 50},
                "style": {"color": "#FF0000"},
            }
        }


class MoveElementRequest(BaseModel):
    """Request to move an element to another page."""

    target_page_number: int = Field(ge=1, description="Target page number")
    new_bounds: dict | None = Field(default=None, description="New position")

    class Config:
        json_schema_extra = {
            "example": {"target_page_number": 3, "new_bounds": {"x": 100, "y": 200}}
        }


class DuplicateElementRequest(BaseModel):
    """Request to duplicate an element."""

    target_page_number: int | None = Field(
        default=None, description="Target page (same if null)"
    )
    offset: dict = Field(
        default={"x": 10, "y": 10}, description="Offset from original position"
    )

    class Config:
        json_schema_extra = {
            "example": {"target_page_number": None, "offset": {"x": 20, "y": 20}}
        }


class BatchOperationRequest(BaseModel):
    """Request for batch element operations."""

    operations: list[dict] = Field(description="List of operations to perform")

    class Config:
        json_schema_extra = {
            "example": {
                "operations": [
                    {
                        "action": "create",
                        "page_number": 1,
                        "data": {
                            "type": "text",
                            "bounds": {"x": 100, "y": 100, "width": 200, "height": 50},
                            "content": "New text",
                        },
                    },
                    {"action": "delete", "element_id": "element-uuid-here"},
                ]
            }
        }
