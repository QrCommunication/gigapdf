"""
Unit tests for FontExtractionService.

Covers: embedded TTF extraction, Base14 non-embedded fonts, subset detection,
font_id determinism, and binary format detection via magic bytes.

Fixtures:
  tests/unit/services/fixtures/sample_embedded_font.pdf  — PDF with one
    embedded TrueType font (ABCDEF+DejaVuSans).
  tests/unit/services/fixtures/sample_base14_only.pdf    — PDF referencing
    Helvetica (Base14) without embedding.
"""

import hashlib
import io
import struct
from pathlib import Path

import pikepdf
import pytest

from app.services.font_extraction_service import FontExtractionService

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def service() -> FontExtractionService:
    return FontExtractionService()


@pytest.fixture(scope="module")
def embedded_pdf_bytes() -> bytes:
    return (FIXTURES_DIR / "sample_embedded_font.pdf").read_bytes()


@pytest.fixture(scope="module")
def base14_pdf_bytes() -> bytes:
    return (FIXTURES_DIR / "sample_base14_only.pdf").read_bytes()


# ---------------------------------------------------------------------------
# Tests: extract_fonts
# ---------------------------------------------------------------------------


class TestExtractFonts:
    """Tests for FontExtractionService.extract_fonts."""

    def test_extract_fonts_with_embedded_ttf(
        self, service: FontExtractionService, embedded_pdf_bytes: bytes
    ) -> None:
        """PDF with embedded TrueType font → is_embedded=True, format=ttf."""
        fonts = service.extract_fonts(embedded_pdf_bytes)

        assert len(fonts) >= 1, "Expected at least one font in the fixture PDF"

        embedded = [f for f in fonts if f.metadata.is_embedded]
        assert embedded, "Expected at least one embedded font"

        font = embedded[0]
        assert font.metadata.is_embedded is True
        assert font.metadata.format == "ttf"
        assert font.data is not None
        assert len(font.data) > 0
        assert font.metadata.subtype in ("TrueType", "CIDFontType2", "Type0")

    def test_extract_fonts_base14_only(
        self, service: FontExtractionService, base14_pdf_bytes: bytes
    ) -> None:
        """PDF with Base14 Helvetica reference → is_embedded=False, data=None."""
        fonts = service.extract_fonts(base14_pdf_bytes)

        assert len(fonts) >= 1, "Expected at least one font entry"

        helvetica_fonts = [
            f for f in fonts if "Helvetica" in (f.metadata.original_name or "")
        ]
        assert helvetica_fonts, "Expected Helvetica font entry"

        font = helvetica_fonts[0]
        assert font.metadata.is_embedded is False
        assert font.data is None

    def test_extract_fonts_subset_detection(
        self, service: FontExtractionService, embedded_pdf_bytes: bytes
    ) -> None:
        """Font with ABCDEF+ prefix in postscript_name → is_subset=True."""
        fonts = service.extract_fonts(embedded_pdf_bytes)

        subset_fonts = [f for f in fonts if f.metadata.is_subset]
        assert subset_fonts, (
            "Expected at least one subset font (ABCDEF+DejaVuSans) in fixture"
        )
        font = subset_fonts[0]
        assert font.metadata.postscript_name is not None
        assert font.metadata.postscript_name.startswith("ABCDEF+")

    def test_extract_fonts_returns_deduplicated_list(
        self, service: FontExtractionService, embedded_pdf_bytes: bytes
    ) -> None:
        """The same font referenced on multiple pages must appear only once."""
        fonts = service.extract_fonts(embedded_pdf_bytes)
        font_ids = [f.metadata.font_id for f in fonts]
        assert len(font_ids) == len(set(font_ids)), "Duplicate font_ids found"

    def test_extract_fonts_raises_on_invalid_pdf(
        self, service: FontExtractionService
    ) -> None:
        """Garbage bytes should raise ValueError."""
        with pytest.raises(ValueError, match="Cannot open PDF"):
            service.extract_fonts(b"not a pdf at all")


# ---------------------------------------------------------------------------
# Tests: compute_font_id
# ---------------------------------------------------------------------------


class TestComputeFontId:
    """Tests for FontExtractionService.compute_font_id (static method)."""

    def test_compute_font_id_deterministic(self) -> None:
        """Same input must always produce the same font_id."""
        fid1 = FontExtractionService.compute_font_id("ABCDEF+Calibri", "TrueType")
        fid2 = FontExtractionService.compute_font_id("ABCDEF+Calibri", "TrueType")
        assert fid1 == fid2

    def test_compute_font_id_length(self) -> None:
        """font_id must be exactly 16 hex characters."""
        fid = FontExtractionService.compute_font_id("Arial", "TrueType")
        assert len(fid) == 16
        assert all(c in "0123456789abcdef" for c in fid)

    def test_compute_font_id_differs_by_subtype(self) -> None:
        """Same name but different subtype → different font_id."""
        fid_tt = FontExtractionService.compute_font_id("Arial", "TrueType")
        fid_t1 = FontExtractionService.compute_font_id("Arial", "Type1")
        assert fid_tt != fid_t1

    def test_compute_font_id_none_name(self) -> None:
        """None postscript_name falls back to 'unknown', must not raise."""
        fid = FontExtractionService.compute_font_id(None, "TrueType")
        expected = hashlib.sha256(b"unknown|TrueType").hexdigest()[:16]
        assert fid == expected


# ---------------------------------------------------------------------------
# Tests: detect_format
# ---------------------------------------------------------------------------


class TestDetectFormat:
    """Tests for FontExtractionService.detect_format (static method)."""

    def test_detect_format_ttf_magic_00010000(self) -> None:
        """Magic bytes \\x00\\x01\\x00\\x00 → 'ttf'."""
        data = b"\x00\x01\x00\x00" + b"\x00" * 100
        result = FontExtractionService.detect_format(data, "TrueType")
        assert result == "ttf"

    def test_detect_format_ttf_magic_true(self) -> None:
        """Magic bytes 'true' → 'ttf'."""
        data = b"true" + b"\x00" * 100
        result = FontExtractionService.detect_format(data, "TrueType")
        assert result == "ttf"

    def test_detect_format_otf(self) -> None:
        """Magic bytes 'OTTO' → 'otf'."""
        data = b"OTTO" + b"\x00" * 100
        result = FontExtractionService.detect_format(data, "CIDFontType2")
        assert result == "otf"

    def test_detect_format_cff_via_subtype_type1c(self) -> None:
        """Subtype 'Type1C' without OTF/TTF magic → 'cff'."""
        data = b"\x01\x00" + b"\x00" * 100  # no OTF/TTF magic
        result = FontExtractionService.detect_format(data, "Type1C")
        assert result == "cff"

    def test_detect_format_cff_via_subtype_cidtype0c(self) -> None:
        """Subtype 'CIDFontType0C' without magic → 'cff'."""
        data = b"\x01\x00" + b"\x00" * 100
        result = FontExtractionService.detect_format(data, "CIDFontType0C")
        assert result == "cff"

    def test_detect_format_none_on_empty_bytes(self) -> None:
        """None or empty bytes → None."""
        assert FontExtractionService.detect_format(None, "TrueType") is None
        assert FontExtractionService.detect_format(b"", "TrueType") is None

    def test_detect_format_unknown_returns_none(self) -> None:
        """Unrecognised magic + unknown subtype → None."""
        data = b"\xDE\xAD\xBE\xEF" + b"\x00" * 100
        result = FontExtractionService.detect_format(data, "Unknown")
        assert result is None


# ---------------------------------------------------------------------------
# Tests: get_mime_type & encode_base64
# ---------------------------------------------------------------------------


class TestHelpers:
    def test_get_mime_type_ttf(self) -> None:
        assert FontExtractionService.get_mime_type("ttf") == "font/ttf"

    def test_get_mime_type_otf(self) -> None:
        assert FontExtractionService.get_mime_type("otf") == "font/otf"

    def test_get_mime_type_cff(self) -> None:
        # CFF is served as font/otf (same container for browser compatibility)
        assert FontExtractionService.get_mime_type("cff") == "font/otf"

    def test_get_mime_type_fallback(self) -> None:
        assert (
            FontExtractionService.get_mime_type("unknown")
            == "application/octet-stream"
        )

    def test_encode_base64_roundtrip(self) -> None:
        import base64

        data = b"\x00\x01\x00\x00" + b"hello world"
        encoded = FontExtractionService.encode_base64(data)
        assert base64.b64decode(encoded) == data
