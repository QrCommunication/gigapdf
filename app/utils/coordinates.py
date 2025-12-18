"""
Coordinate system conversion utilities.

PDF uses bottom-left origin with Y increasing upward.
Web uses top-left origin with Y increasing downward.
These utilities handle conversion between the two systems.
"""

from typing import NamedTuple


class Point(NamedTuple):
    """A 2D point."""

    x: float
    y: float


class Rect(NamedTuple):
    """A rectangle with origin and dimensions."""

    x: float
    y: float
    width: float
    height: float


def pdf_to_web(x: float, y: float, page_height: float) -> Point:
    """
    Convert PDF coordinates to web coordinates.

    PDF origin is bottom-left with Y increasing upward.
    Web origin is top-left with Y increasing downward.

    Args:
        x: X coordinate in PDF system.
        y: Y coordinate in PDF system.
        page_height: Total page height in points.

    Returns:
        Point: Converted coordinates in web system.

    Example:
        >>> pdf_to_web(100, 700, 792)
        Point(x=100, y=92)
    """
    return Point(x, page_height - y)


def web_to_pdf(x: float, y: float, page_height: float) -> Point:
    """
    Convert web coordinates to PDF coordinates.

    Web origin is top-left with Y increasing downward.
    PDF origin is bottom-left with Y increasing upward.

    Args:
        x: X coordinate in web system.
        y: Y coordinate in web system.
        page_height: Total page height in points.

    Returns:
        Point: Converted coordinates in PDF system.

    Example:
        >>> web_to_pdf(100, 92, 792)
        Point(x=100, y=700)
    """
    return Point(x, page_height - y)


def pdf_rect_to_web(
    x0: float, y0: float, x1: float, y1: float, page_height: float
) -> Rect:
    """
    Convert a PDF rectangle to web coordinates.

    PDF rectangles are defined by (x0, y0) bottom-left and (x1, y1) top-right.
    Web rectangles are defined by (x, y) top-left and (width, height).

    Args:
        x0: Left edge in PDF coordinates.
        y0: Bottom edge in PDF coordinates.
        x1: Right edge in PDF coordinates.
        y1: Top edge in PDF coordinates.
        page_height: Total page height in points.

    Returns:
        Rect: Rectangle in web coordinate system.
    """
    # Ensure proper ordering
    left = min(x0, x1)
    right = max(x0, x1)
    bottom = min(y0, y1)
    top = max(y0, y1)

    # Convert to web coordinates
    web_x = left
    web_y = page_height - top
    width = right - left
    height = top - bottom

    return Rect(web_x, web_y, width, height)


def web_rect_to_pdf(
    x: float, y: float, width: float, height: float, page_height: float
) -> tuple[float, float, float, float]:
    """
    Convert a web rectangle to PDF coordinates.

    Web rectangles are defined by (x, y) top-left and (width, height).
    PDF rectangles are defined by (x0, y0, x1, y1).

    Args:
        x: Left edge in web coordinates.
        y: Top edge in web coordinates.
        width: Rectangle width.
        height: Rectangle height.
        page_height: Total page height in points.

    Returns:
        tuple: (x0, y0, x1, y1) in PDF coordinate system.
    """
    x0 = x
    y0 = page_height - y - height  # Bottom in PDF coords
    x1 = x + width
    y1 = page_height - y  # Top in PDF coords

    return (x0, y0, x1, y1)


def apply_rotation(
    x: float, y: float, rotation: int, page_width: float, page_height: float
) -> Point:
    """
    Apply page rotation to coordinates.

    Args:
        x: X coordinate.
        y: Y coordinate.
        rotation: Rotation angle (0, 90, 180, 270).
        page_width: Page width in points.
        page_height: Page height in points.

    Returns:
        Point: Rotated coordinates.
    """
    if rotation == 0:
        return Point(x, y)
    elif rotation == 90:
        return Point(y, page_width - x)
    elif rotation == 180:
        return Point(page_width - x, page_height - y)
    elif rotation == 270:
        return Point(page_height - y, x)
    else:
        raise ValueError(f"Invalid rotation: {rotation}")


def unapply_rotation(
    x: float, y: float, rotation: int, page_width: float, page_height: float
) -> Point:
    """
    Remove page rotation from coordinates (inverse of apply_rotation).

    Args:
        x: X coordinate with rotation applied.
        y: Y coordinate with rotation applied.
        rotation: Rotation angle (0, 90, 180, 270).
        page_width: Page width in points.
        page_height: Page height in points.

    Returns:
        Point: Original coordinates before rotation.
    """
    # Inverse rotations
    inverse = {0: 0, 90: 270, 180: 180, 270: 90}
    return apply_rotation(x, y, inverse[rotation], page_width, page_height)
