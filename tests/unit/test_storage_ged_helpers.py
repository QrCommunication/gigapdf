"""
Unit tests for the GED helpers of the storage router.

Pure functions, no DB / S3 / mocks needed:
- _normalize_tags     : tag normalization rules (lowercase/trim/dedupe/limits)
- _detect_thumbnail_format : magic-bytes validation (PNG/JPEG/WebP)
- _next_copy_name     : "(copie)" suffix incrementing for duplicates
"""

import pytest

from app.api.v1.storage import (
    _MAX_DOCUMENT_NAME_LENGTH,
    _MAX_TAG_LENGTH,
    _MAX_TAGS,
    _detect_thumbnail_format,
    _next_copy_name,
    _normalize_tags,
)


class TestNormalizeTags:
    """Tag normalization: lowercase/trim, dedupe, empties, limits."""

    def test_lowercases_and_trims(self):
        assert _normalize_tags(["  Facture ", "LEGAL"]) == ["facture", "legal"]

    def test_drops_empty_and_whitespace_only_tags(self):
        assert _normalize_tags(["", "   ", "ok"]) == ["ok"]

    def test_dedupes_keeping_first_occurrence_order(self):
        assert _normalize_tags(["B", "a", "b", "A "]) == ["b", "a"]

    def test_empty_list_returns_empty_list(self):
        assert _normalize_tags([]) == []

    def test_raises_when_more_than_max_tags(self):
        tags = [f"tag{i}" for i in range(_MAX_TAGS + 1)]
        with pytest.raises(ValueError, match="Too many tags"):
            _normalize_tags(tags)

    def test_accepts_exactly_max_tags(self):
        tags = [f"tag{i}" for i in range(_MAX_TAGS)]
        assert len(_normalize_tags(tags)) == _MAX_TAGS

    def test_duplicates_do_not_count_toward_the_limit(self):
        tags = ["same"] * (_MAX_TAGS + 5)
        assert _normalize_tags(tags) == ["same"]

    def test_raises_on_tag_longer_than_max_length(self):
        with pytest.raises(ValueError, match="Tag too long"):
            _normalize_tags(["x" * (_MAX_TAG_LENGTH + 1)])

    def test_accepts_tag_of_exactly_max_length(self):
        tag = "x" * _MAX_TAG_LENGTH
        assert _normalize_tags([tag]) == [tag]

    def test_raises_on_non_string_tag(self):
        with pytest.raises(ValueError, match="must be strings"):
            _normalize_tags(["ok", 42])  # type: ignore[list-item]


class TestDetectThumbnailFormat:
    """Magic-bytes detection for PNG / JPEG / WebP."""

    def test_png_magic(self):
        data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
        assert _detect_thumbnail_format(data) == ("png", "image/png")

    def test_jpeg_magic(self):
        data = b"\xff\xd8\xff\xe0" + b"\x00" * 64
        assert _detect_thumbnail_format(data) == ("jpg", "image/jpeg")

    def test_webp_magic(self):
        data = b"RIFF" + b"\x10\x00\x00\x00" + b"WEBP" + b"\x00" * 64
        assert _detect_thumbnail_format(data) == ("webp", "image/webp")

    def test_riff_without_webp_marker_rejected(self):
        # RIFF container that is NOT WebP (e.g. WAV)
        data = b"RIFF" + b"\x10\x00\x00\x00" + b"WAVE" + b"\x00" * 64
        assert _detect_thumbnail_format(data) is None

    def test_pdf_bytes_rejected(self):
        assert _detect_thumbnail_format(b"%PDF-1.4 fake") is None

    def test_empty_bytes_rejected(self):
        assert _detect_thumbnail_format(b"") is None

    def test_truncated_webp_header_rejected(self):
        assert _detect_thumbnail_format(b"RIFF\x00\x00") is None

    def test_svg_rejected(self):
        # SVG is NOT in the allowlist (XSS vector via embedded scripts)
        assert _detect_thumbnail_format(b"<svg xmlns='...'></svg>") is None


class TestNextCopyName:
    """Duplicate naming: "{name} (copie)" with incremented suffix."""

    def test_first_copy_gets_simple_suffix(self):
        assert _next_copy_name("Contrat.pdf", set()) == "Contrat.pdf (copie)"

    def test_collision_increments_to_copie_2(self):
        existing = {"Contrat.pdf", "Contrat.pdf (copie)"}
        assert _next_copy_name("Contrat.pdf", existing) == "Contrat.pdf (copie 2)"

    def test_chained_collisions_keep_incrementing(self):
        existing = {
            "Contrat.pdf (copie)",
            "Contrat.pdf (copie 2)",
            "Contrat.pdf (copie 3)",
        }
        assert _next_copy_name("Contrat.pdf", existing) == "Contrat.pdf (copie 4)"

    def test_gap_in_suffixes_is_filled(self):
        # (copie 2) was deleted: the first free suffix wins
        existing = {"Doc (copie)", "Doc (copie 3)"}
        assert _next_copy_name("Doc", existing) == "Doc (copie 2)"

    def test_result_never_exceeds_max_name_length(self):
        long_name = "x" * _MAX_DOCUMENT_NAME_LENGTH
        result = _next_copy_name(long_name, set())
        assert len(result) <= _MAX_DOCUMENT_NAME_LENGTH
        assert result.endswith(" (copie)")

    def test_truncated_long_name_collisions_still_resolve(self):
        long_name = "x" * _MAX_DOCUMENT_NAME_LENGTH
        first = _next_copy_name(long_name, set())
        second = _next_copy_name(long_name, {first})
        assert second != first
        assert len(second) <= _MAX_DOCUMENT_NAME_LENGTH
        assert second.endswith(" (copie 2)")
