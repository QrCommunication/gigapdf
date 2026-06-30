"""
Core PDF manipulation modules for Giga-PDF.

PDF rendering is handled by @giga-pdf/pdf-engine (TypeScript).
Python only retains: OCR block ingestion (host-side gigapdf-ocr-rten service via store_ocr_blocks), Celery tasks, and FastAPI routing.
"""

from app.core.pdf_engine import PDFEngine

__all__ = [
    "PDFEngine",
]
