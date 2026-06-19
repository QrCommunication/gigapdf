"""Best-effort text extraction from imported files (search/OCR material).

When a document is imported, we extract its plain text so it becomes
findable through both the full-text search (``stored_documents.search_vector``,
fed by ``extracted_text``) and the semantic search (``ocr_blocks`` embeddings).

The extraction strategy is chosen from the file's MIME type / format:

- **PDF** → text layer via :mod:`pdfplumber` (no OCR; scanned PDFs without a
  text layer yield little/nothing, which is expected — the TS engine's OCR
  pipeline handles those on demand).
- **Image** (PNG/JPEG/WebP/TIFF/…) → **no server-side OCR**. The zero-binary
  policy (#61) removed the ``tesseract`` binary, so images are OCR'd
  client-side through the engine's native WASM OCR (``doc.ocr``) and ingested
  via the ``/ocr-blocks`` pipeline. Server-side extraction yields no text for
  images (they are still stored verbatim and become searchable once the client
  OCR pipeline indexes them).
- **Anything else** (Office, etc.) → skipped here. Office imports are converted
  to PDF by the TS engine which carries the text layer; the PDF text is what
  gets indexed.

Every function is **synchronous and CPU-bound** (meant to be offloaded with
``asyncio.to_thread``) and **never raises**: extraction is an enhancement, not
a precondition for a successful import.
"""

from __future__ import annotations

import io
import logging

_logger = logging.getLogger(__name__)

# Keep parity with storage._MAX_EXTRACTED_TEXT_CHARS (search material cap).
MAX_EXTRACTED_TEXT_CHARS = 500_000

# MIME types we can OCR as raster images.
_IMAGE_MIME_PREFIX = "image/"


def _truncate(text: str) -> str:
    """Collapse to the search-material cap (defensive — callers also cap)."""
    return text[:MAX_EXTRACTED_TEXT_CHARS]


def is_pdf(mime_type: str | None, data: bytes | None = None) -> bool:
    """True when the payload is a PDF (by MIME or by ``%PDF-`` magic)."""
    if mime_type and "pdf" in mime_type.lower():
        return True
    return bool(data and data.startswith(b"%PDF-"))


def is_image(mime_type: str | None) -> bool:
    """True when the MIME type denotes a raster image."""
    return bool(mime_type and mime_type.lower().startswith(_IMAGE_MIME_PREFIX))


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Return the concatenated text layer of a PDF (never raises).

    Uses :mod:`pdfplumber`. Pages with no text layer contribute nothing.
    Returns an empty string on any failure.
    """
    try:
        import pdfplumber  # lazy — heavy import, only when extracting a PDF

        parts: list[str] = []
        total = 0
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                if total >= MAX_EXTRACTED_TEXT_CHARS:
                    break
                page_text = page.extract_text() or ""
                if page_text:
                    parts.append(page_text)
                    total += len(page_text)
        return _truncate("\n".join(parts))
    except Exception:  # noqa: BLE001 — extraction is best-effort
        _logger.warning("PDF text extraction failed", exc_info=True)
        return ""


def extract_text_from_image(image_bytes: bytes) -> str:  # noqa: ARG001 — stub
    """Images are not OCR'd server-side — always returns ``""``.

    The zero-binary policy (#61) removed the ``tesseract`` binary, so image OCR
    runs client-side through the engine's native WASM OCR (``doc.ocr``) and is
    ingested via the ``/ocr-blocks`` pipeline. This stub keeps the dispatch
    shape stable; the image is stored verbatim and becomes searchable once the
    client OCR pipeline indexes it.
    """
    return ""


def extract_text(data: bytes, mime_type: str | None) -> str:
    """Extract searchable text from *data* according to *mime_type*.

    Dispatches to the PDF text layer or image OCR; returns ``""`` for formats
    handled elsewhere (Office) or on any failure. Never raises.
    """
    if not data:
        return ""
    try:
        if is_pdf(mime_type, data):
            return extract_text_from_pdf(data)
        if is_image(mime_type):
            return extract_text_from_image(data)
    except Exception:  # noqa: BLE001 — defensive: dispatch must never raise
        _logger.warning(
            "Content extraction failed (mime=%s)", mime_type, exc_info=True
        )
    return ""
