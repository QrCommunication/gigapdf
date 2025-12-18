"""
Unit tests for helper utilities.
"""

import pytest

from app.utils.helpers import (
    format_file_size,
    generate_uuid,
    parse_page_range,
    sanitize_filename,
    split_filename,
)


class TestGenerateUUID:
    """Tests for UUID generation."""

    def test_generates_valid_uuid(self):
        """Test that generated UUID is valid format."""
        uuid = generate_uuid()
        assert len(uuid) == 36
        assert uuid.count("-") == 4

    def test_generates_unique_uuids(self):
        """Test that UUIDs are unique."""
        uuids = [generate_uuid() for _ in range(100)]
        assert len(set(uuids)) == 100


class TestSanitizeFilename:
    """Tests for filename sanitization."""

    def test_removes_path_separators(self):
        """Test that path separators are replaced."""
        assert "_" in sanitize_filename("path/to/file.pdf")
        assert "_" in sanitize_filename("path\\to\\file.pdf")

    def test_removes_dangerous_characters(self):
        """Test that dangerous characters are removed."""
        result = sanitize_filename('file<>:"|?*.pdf')
        assert "<" not in result
        assert ">" not in result
        assert '"' not in result

    def test_handles_empty_filename(self):
        """Test that empty filenames become 'unnamed'."""
        assert sanitize_filename("") == "unnamed"
        assert sanitize_filename("...") == "unnamed"

    def test_truncates_long_filenames(self):
        """Test that long filenames are truncated."""
        long_name = "a" * 300 + ".pdf"
        result = sanitize_filename(long_name, max_length=100)
        assert len(result) <= 100

    def test_preserves_extension_on_truncation(self):
        """Test that extension is preserved when truncating."""
        long_name = "a" * 300 + ".pdf"
        result = sanitize_filename(long_name, max_length=100)
        assert result.endswith(".pdf")


class TestSplitFilename:
    """Tests for filename splitting."""

    def test_splits_normal_filename(self):
        """Test splitting a normal filename."""
        name, ext = split_filename("document.pdf")
        assert name == "document"
        assert ext == "pdf"

    def test_handles_multiple_dots(self):
        """Test handling of multiple dots."""
        name, ext = split_filename("my.document.backup.pdf")
        assert name == "my.document.backup"
        assert ext == "pdf"

    def test_handles_no_extension(self):
        """Test handling of files without extension."""
        name, ext = split_filename("document")
        assert name == "document"
        assert ext == ""


class TestParsePageRange:
    """Tests for page range parsing."""

    def test_single_page(self):
        """Test parsing single page."""
        assert parse_page_range("5", 10) == [5]

    def test_page_range(self):
        """Test parsing page range."""
        assert parse_page_range("1-5", 10) == [1, 2, 3, 4, 5]

    def test_comma_separated(self):
        """Test parsing comma-separated pages."""
        assert parse_page_range("1,3,5", 10) == [1, 3, 5]

    def test_mixed_format(self):
        """Test parsing mixed format."""
        result = parse_page_range("1-3,5,7-9", 10)
        assert result == [1, 2, 3, 5, 7, 8, 9]

    def test_removes_duplicates(self):
        """Test that duplicates are removed."""
        result = parse_page_range("1,1,2,2,3", 10)
        assert result == [1, 2, 3]

    def test_sorts_result(self):
        """Test that result is sorted."""
        result = parse_page_range("5,3,1,4,2", 10)
        assert result == [1, 2, 3, 4, 5]

    def test_invalid_page_raises_error(self):
        """Test that invalid page numbers raise error."""
        with pytest.raises(ValueError):
            parse_page_range("15", 10)

    def test_invalid_format_raises_error(self):
        """Test that invalid format raises error."""
        with pytest.raises(ValueError):
            parse_page_range("abc", 10)


class TestFormatFileSize:
    """Tests for file size formatting."""

    def test_bytes(self):
        """Test formatting bytes."""
        assert format_file_size(500) == "500.0 B"

    def test_kilobytes(self):
        """Test formatting kilobytes."""
        assert format_file_size(1536) == "1.5 KB"

    def test_megabytes(self):
        """Test formatting megabytes."""
        assert format_file_size(1048576) == "1.0 MB"

    def test_gigabytes(self):
        """Test formatting gigabytes."""
        assert format_file_size(1073741824) == "1.0 GB"
