"""
Core PDF manipulation modules for Giga-PDF.

PDF rendering is handled by @giga-pdf/pdf-engine (TypeScript).
Python only retains: OCR, Celery tasks, and FastAPI routing.
"""

from app.core.pdf_engine import PDFEngine
from app.core.preview import PreviewGenerator

__all__ = [
    "PDFEngine",
    "PreviewGenerator",
]
