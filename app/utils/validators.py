"""
Validation utilities for Giga-PDF.
"""

import re
from typing import Any

from app.middleware.error_handler import InvalidOperationError


def validate_uuid(value: str, field_name: str = "ID") -> str:
    """
    Validate that a string is a valid UUID v4.

    Args:
        value: String to validate.
        field_name: Name of the field for error messages.

    Returns:
        str: The validated UUID string.

    Raises:
        InvalidOperationError: If the string is not a valid UUID.
    """
    uuid_pattern = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        re.IGNORECASE,
    )

    if not uuid_pattern.match(value):
        raise InvalidOperationError(f"Invalid {field_name}: {value}")

    return value.lower()


def validate_hex_color(color: str, field_name: str = "color") -> str:
    """
    Validate a hex color string.

    Args:
        color: Color string (e.g., "#FF0000").
        field_name: Name of the field for error messages.

    Returns:
        str: Validated color in uppercase.

    Raises:
        InvalidOperationError: If the color format is invalid.
    """
    if not re.match(r"^#[0-9A-Fa-f]{6}$", color):
        raise InvalidOperationError(f"Invalid {field_name} format: {color}")

    return color.upper()


def validate_page_number(page_number: int, max_pages: int) -> int:
    """
    Validate a page number is within bounds.

    Args:
        page_number: Page number to validate (1-indexed).
        max_pages: Maximum page number.

    Returns:
        int: Validated page number.

    Raises:
        InvalidOperationError: If page number is out of bounds.
    """
    if page_number < 1 or page_number > max_pages:
        raise InvalidOperationError(
            f"Page number {page_number} out of range (1-{max_pages})"
        )
    return page_number


def validate_dpi(dpi: int, max_dpi: int = 600) -> int:
    """
    Validate DPI value.

    Args:
        dpi: DPI value to validate.
        max_dpi: Maximum allowed DPI.

    Returns:
        int: Validated DPI.

    Raises:
        InvalidOperationError: If DPI is out of range.
    """
    if dpi < 1 or dpi > max_dpi:
        raise InvalidOperationError(f"DPI must be between 1 and {max_dpi}, got {dpi}")
    return dpi


def validate_rotation(rotation: int) -> int:
    """
    Validate rotation angle.

    Args:
        rotation: Rotation angle in degrees.

    Returns:
        int: Validated rotation.

    Raises:
        InvalidOperationError: If rotation is invalid.
    """
    valid_rotations = {0, 90, 180, 270, -90, -180, -270}
    if rotation not in valid_rotations:
        raise InvalidOperationError(
            f"Invalid rotation: {rotation}. Must be one of {valid_rotations}"
        )
    # Normalize to positive
    return rotation % 360


def validate_bounds(bounds: dict[str, Any], page_width: float, page_height: float) -> None:
    """
    Validate element bounds are within page dimensions.

    Args:
        bounds: Bounds dictionary with x, y, width, height.
        page_width: Page width in points.
        page_height: Page height in points.

    Raises:
        InvalidOperationError: If bounds are invalid.
    """
    x = bounds.get("x", 0)
    y = bounds.get("y", 0)
    width = bounds.get("width", 0)
    height = bounds.get("height", 0)

    if x < 0 or y < 0:
        raise InvalidOperationError("Bounds x and y must be non-negative")

    if width <= 0 or height <= 0:
        raise InvalidOperationError("Bounds width and height must be positive")

    if x + width > page_width:
        raise InvalidOperationError(
            f"Element extends beyond page width (max: {page_width})"
        )

    if y + height > page_height:
        raise InvalidOperationError(
            f"Element extends beyond page height (max: {page_height})"
        )


def validate_opacity(opacity: float, field_name: str = "opacity") -> float:
    """
    Validate opacity value.

    Args:
        opacity: Opacity value (0-1).
        field_name: Name of the field for error messages.

    Returns:
        float: Validated opacity.

    Raises:
        InvalidOperationError: If opacity is out of range.
    """
    if opacity < 0 or opacity > 1:
        raise InvalidOperationError(f"{field_name} must be between 0 and 1, got {opacity}")
    return opacity
