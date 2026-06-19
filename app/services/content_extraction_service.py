"""Best-effort text extraction from imported files (search/OCR material).

When a document is imported, we extract its plain text so it becomes
findable through both the full-text search (``stored_documents.search_vector``,
fed by ``extracted_text``) and the semantic search (``ocr_blocks`` embeddings).

**Server-side extraction is now a stub for every format.** Text extraction is
done **100% client-side** by the engine's native WASM library (``gigapdf-lib``,
``extractPdfText`` / ``doc.ocr``), which ships the result to the API via the
``extracted_text`` upload field (or the ``/ocr-blocks`` endpoint for positioned
OCR). The server no longer re-extracts:

- **PDF** → no longer parsed server-side (``pdfplumber`` removed from this path;
  the client's WASM engine already carries the text layer). Returns ``""``.
- **Image** (PNG/JPEG/WebP/TIFF/…) → no server-side OCR. The zero-binary policy
  (#61) removed the ``tesseract`` binary; image OCR runs client-side through the
  engine's native WASM OCR (``doc.ocr``) and is ingested via ``/ocr-blocks``.
  Returns ``""``.
- **Anything else** (Office, etc.) → skipped. Office imports are converted to
  PDF by the engine which carries the text layer; that text is sent as
  ``extracted_text``. Returns ``""``.

This module is kept (rather than deleted) so the dispatch shape stays stable and
a future server-side extractor can re-enable any branch with zero call-site
changes. Every function is **synchronous** (meant to be offloaded with
``asyncio.to_thread``) and **never raises**: extraction is an enhancement, not a
precondition for a successful import.

Note: ``pdfplumber`` has been removed from the project entirely. PDF/image
rendering (previews, raster export) is now done by the WASM engine — client-side
or via the Next.js ``@giga-pdf/pdf-engine`` route. The server holds no PDF parser.
"""

from __future__ import annotations

import logging

_logger = logging.getLogger(__name__)

# Documented search-material cap (parity with storage._MAX_EXTRACTED_TEXT_CHARS).
# Retained for a future server-side extractor; callers (storage) cap anyway.
MAX_EXTRACTED_TEXT_CHARS = 500_000

# MIME types we can OCR as raster images.
_IMAGE_MIME_PREFIX = "image/"


def is_pdf(mime_type: str | None, data: bytes | None = None) -> bool:
    """True when the payload is a PDF (by MIME or by ``%PDF-`` magic)."""
    if mime_type and "pdf" in mime_type.lower():
        return True
    return bool(data and data.startswith(b"%PDF-"))


def is_image(mime_type: str | None) -> bool:
    """True when the MIME type denotes a raster image."""
    return bool(mime_type and mime_type.lower().startswith(_IMAGE_MIME_PREFIX))


def extract_text_from_pdf(pdf_bytes: bytes) -> str:  # noqa: ARG001 — stub
    """PDFs are not parsed server-side — always returns ``""``.

    PDF text extraction is now done entirely client-side by the engine's native
    WASM library (``gigapdf-lib``, ``extractPdfText``), which sends the text to
    the API via the ``extracted_text`` upload field. ``pdfplumber`` is no longer
    used here (it remains a project dependency for export/preview). This stub
    keeps the dispatch shape stable; a future server-side extractor can restore
    a real implementation without touching any call site.
    """
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
