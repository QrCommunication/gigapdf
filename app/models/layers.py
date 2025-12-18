"""
Layer model for PDF Optional Content Groups (OCG).

Layers allow organizing content that can be shown/hidden,
commonly used for version control, language variants, etc.
"""

from pydantic import ConfigDict, Field

from app.models.base import CamelCaseModel, to_camel


class LayerObject(CamelCaseModel):
    """
    PDF layer (Optional Content Group).

    Layers group elements that can be toggled on/off,
    useful for complex documents with multiple views.
    """

    layer_id: str = Field(description="Unique layer identifier (UUID v4)")
    name: str = Field(description="Layer display name")
    visible: bool = Field(default=True, description="Initial visibility state")
    locked: bool = Field(default=False, description="Whether layer is locked for editing")
    opacity: float = Field(default=1.0, ge=0, le=1, description="Layer opacity")
    print: bool = Field(default=True, description="Include layer when printing")
    order: int = Field(default=0, description="Z-order (higher = front)")

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "layerId": "550e8400-e29b-41d4-a716-446655440010",
                "name": "Annotations",
                "visible": True,
                "locked": False,
                "opacity": 1.0,
                "print": True,
                "order": 1,
            }
        },
    )
