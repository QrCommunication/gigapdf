"""
Base model classes for Pydantic serialization.

Provides common functionality like camelCase serialization for all models.
"""

from pydantic import BaseModel, ConfigDict


def to_camel(string: str) -> str:
    """Convert snake_case to camelCase.

    Args:
        string: Snake case string (e.g., "my_field_name")

    Returns:
        Camel case string (e.g., "myFieldName")
    """
    components = string.split("_")
    return components[0] + "".join(x.title() for x in components[1:])


class CamelCaseModel(BaseModel):
    """
    Base model with camelCase serialization for JSON output.

    All API response models should inherit from this class to ensure
    consistent camelCase field names in JSON responses, matching the
    frontend TypeScript conventions.

    Example:
        class MyModel(CamelCaseModel):
            my_field: str  # Serializes as "myField" in JSON
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )
