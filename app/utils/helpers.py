"""
General helper utilities for Giga-PDF.
"""

import hashlib
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def generate_uuid() -> str:
    """
    Generate a new UUID v4 string.

    Returns:
        str: UUID v4 as string.
    """
    return str(uuid.uuid4())


def sanitize_filename(filename: str, max_length: int = 255) -> str:
    """
    Sanitize a filename for safe filesystem storage.

    Removes or replaces potentially dangerous characters
    and ensures the filename is within length limits.

    Args:
        filename: Original filename.
        max_length: Maximum allowed length.

    Returns:
        str: Sanitized filename.
    """
    # Remove null bytes and path separators
    filename = filename.replace("\x00", "").replace("/", "_").replace("\\", "_")

    # Remove other potentially dangerous characters
    filename = re.sub(r'[<>:"|?*]', "_", filename)

    # Remove leading/trailing spaces and dots
    filename = filename.strip(" .")

    # Ensure filename is not empty
    if not filename:
        filename = "unnamed"

    # Truncate if too long, preserving extension
    if len(filename) > max_length:
        name, ext = split_filename(filename)
        max_name_length = max_length - len(ext) - 1
        filename = f"{name[:max_name_length]}.{ext}" if ext else name[:max_length]

    return filename


def split_filename(filename: str) -> tuple[str, str]:
    """
    Split a filename into name and extension.

    Args:
        filename: Full filename.

    Returns:
        tuple: (name, extension) without the dot.
    """
    path = Path(filename)
    ext = path.suffix[1:] if path.suffix else ""
    name = path.stem
    return name, ext


def get_mime_type(filename: str) -> str:
    """
    Determine MIME type from filename extension.

    Args:
        filename: Filename with extension.

    Returns:
        str: MIME type string.
    """
    mime_types = {
        "pdf": "application/pdf",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "svg": "image/svg+xml",
        "tiff": "image/tiff",
        "tif": "image/tiff",
        "bmp": "image/bmp",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "html": "text/html",
        "txt": "text/plain",
        "json": "application/json",
    }

    _, ext = split_filename(filename)
    return mime_types.get(ext.lower(), "application/octet-stream")


def calculate_file_hash(data: bytes, algorithm: str = "sha256") -> str:
    """
    Calculate hash of file data.

    Args:
        data: File bytes.
        algorithm: Hash algorithm (sha256, md5, etc.).

    Returns:
        str: Hex digest of hash.
    """
    hasher = hashlib.new(algorithm)
    hasher.update(data)
    return hasher.hexdigest()


def format_file_size(size_bytes: int) -> str:
    """
    Format file size for human readability.

    Args:
        size_bytes: Size in bytes.

    Returns:
        str: Human-readable size string.
    """
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def now_utc() -> datetime:
    """
    Get current UTC datetime.

    Returns:
        datetime: Current time in UTC with timezone info.
    """
    return datetime.now(timezone.utc)


def now_utc_naive() -> datetime:
    """
    Get current UTC datetime without timezone info.

    Use this for database columns defined as TIMESTAMP WITHOUT TIME ZONE.

    Returns:
        datetime: Current time in UTC without timezone info (naive).
    """
    return datetime.utcnow()


def parse_page_range(page_range: str, max_pages: int) -> list[int]:
    """
    Parse a page range string into a list of page numbers.

    Supports formats like:
    - "1" (single page)
    - "1-5" (range)
    - "1,3,5" (list)
    - "1-3,7,9-11" (mixed)

    Args:
        page_range: Page range string.
        max_pages: Maximum page number (for validation).

    Returns:
        list[int]: Sorted list of unique page numbers.

    Raises:
        ValueError: If format is invalid or pages are out of range.
    """
    pages: set[int] = set()

    for part in page_range.split(","):
        part = part.strip()
        if not part:
            continue

        if "-" in part:
            # Range: "1-5"
            try:
                start, end = part.split("-", 1)
                start_num = int(start.strip())
                end_num = int(end.strip())

                if start_num < 1 or end_num > max_pages:
                    raise ValueError(f"Page range {part} out of bounds (1-{max_pages})")

                if start_num > end_num:
                    start_num, end_num = end_num, start_num

                pages.update(range(start_num, end_num + 1))
            except ValueError as e:
                if "invalid literal" in str(e):
                    raise ValueError(f"Invalid page range format: {part}")
                raise
        else:
            # Single page
            try:
                page_num = int(part)
                if page_num < 1 or page_num > max_pages:
                    raise ValueError(f"Page {page_num} out of bounds (1-{max_pages})")
                pages.add(page_num)
            except ValueError:
                raise ValueError(f"Invalid page number: {part}")

    return sorted(pages)


def deep_merge(base: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    """
    Deep merge two dictionaries.

    Values from 'update' override values in 'base'.
    Nested dicts are merged recursively.

    Args:
        base: Base dictionary.
        update: Dictionary with updates.

    Returns:
        dict: Merged dictionary.
    """
    result = base.copy()

    for key, value in update.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value

    return result
