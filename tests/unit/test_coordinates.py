"""
Unit tests for coordinate conversion utilities.
"""

import pytest

from app.utils.coordinates import (
    Point,
    Rect,
    pdf_rect_to_web,
    pdf_to_web,
    web_rect_to_pdf,
    web_to_pdf,
)


class TestCoordinateConversion:
    """Tests for coordinate conversion functions."""

    def test_pdf_to_web_origin(self):
        """Test conversion of origin point."""
        # PDF origin (0, 0) is bottom-left
        # Web origin should be (0, page_height) which is top-left
        result = pdf_to_web(0, 0, 792)
        assert result == Point(0, 792)

    def test_pdf_to_web_top_left(self):
        """Test conversion of top-left corner in PDF."""
        # PDF top-left is (0, page_height)
        # Web top-left should be (0, 0)
        result = pdf_to_web(0, 792, 792)
        assert result == Point(0, 0)

    def test_web_to_pdf_origin(self):
        """Test conversion of web origin."""
        # Web origin (0, 0) is top-left
        # PDF should be (0, page_height) which is top-left in PDF
        result = web_to_pdf(0, 0, 792)
        assert result == Point(0, 792)

    def test_roundtrip_conversion(self):
        """Test that conversion is reversible."""
        original = Point(100, 500)
        page_height = 792

        web = pdf_to_web(original.x, original.y, page_height)
        back = web_to_pdf(web.x, web.y, page_height)

        assert back == original

    def test_pdf_rect_to_web(self):
        """Test rectangle conversion."""
        # PDF rect: bottom-left (100, 100), top-right (300, 200)
        # Height = 100, Width = 200
        result = pdf_rect_to_web(100, 100, 300, 200, 792)

        assert result.x == 100  # Left edge
        assert result.y == 592  # 792 - 200 (top of rect in web coords)
        assert result.width == 200
        assert result.height == 100

    def test_web_rect_to_pdf(self):
        """Test web rectangle to PDF conversion."""
        # Web rect: (100, 100) with width=200, height=100
        x0, y0, x1, y1 = web_rect_to_pdf(100, 100, 200, 100, 792)

        assert x0 == 100  # Left
        assert y0 == 592  # Bottom in PDF = page_height - y - height
        assert x1 == 300  # Right
        assert y1 == 692  # Top in PDF = page_height - y

    def test_rect_roundtrip(self):
        """Test rectangle conversion roundtrip."""
        page_height = 792
        original_x, original_y = 100, 200
        original_width, original_height = 150, 80

        # Convert to PDF
        x0, y0, x1, y1 = web_rect_to_pdf(
            original_x, original_y, original_width, original_height, page_height
        )

        # Convert back
        result = pdf_rect_to_web(x0, y0, x1, y1, page_height)

        assert result.x == original_x
        assert result.y == original_y
        assert result.width == original_width
        assert result.height == original_height
