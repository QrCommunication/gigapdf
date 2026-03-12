"""
Main PDF engine.

# DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes instead.
#
# This module previously used PyMuPDF (AGPL) for PDF manipulation.
# All PDF rendering, page manipulation, and editing operations are now
# handled by the TypeScript pdf-engine package at packages/pdf-engine.
#
# Python only retains: OCR (pytesseract), Celery workers, FastAPI endpoints
# that do NOT perform PDF processing.
#
# TODO: Route all PDF manipulation calls to the TS engine via HTTP.
"""

import io
import logging
from pathlib import Path
from typing import Any, Optional

import pikepdf  # MIT-licensed replacement for PyMuPDF PDF operations

from app.middleware.error_handler import (
    PDFCorruptedError,
    PDFEncryptedError,
    PDFInvalidPasswordError,
    PDFParseError,
)
from app.utils.helpers import generate_uuid

logger = logging.getLogger(__name__)


class PDFEngine:
    """
    Core PDF manipulation engine.

    DEPRECATED: All PDF operations are now handled by @giga-pdf/pdf-engine (TypeScript).
    This class is retained as a compatibility shim so that existing Celery tasks and
    session management continue to work during the migration period.

    The internal document store now holds raw bytes instead of fitz.Document objects.
    PDF binary data is managed via pikepdf when needed for legacy operations.
    """

    def __init__(self):
        """Initialize the PDF engine."""
        # Now stores raw PDF bytes keyed by document_id instead of fitz.Document objects
        self._documents: dict[str, bytes] = {}

    def open_document(
        self,
        source: bytes | str | Path,
        password: Optional[str] = None,
    ) -> tuple[str, "LegacyDocumentProxy"]:
        """
        Open a PDF document from bytes, file path, or stream.

        DEPRECATED: PDF processing is now handled by @giga-pdf/pdf-engine (TypeScript).
        This method stores raw bytes and returns a LegacyDocumentProxy for backward compat.

        TODO: Replace callers with HTTP calls to the TS pdf-engine service.

        Args:
            source: PDF data as bytes, file path, or Path object.
            password: Optional password for encrypted PDFs.

        Returns:
            tuple: (document_id, LegacyDocumentProxy) pair.

        Raises:
            PDFParseError: If the PDF cannot be parsed.
            PDFEncryptedError: If the PDF is encrypted and no password provided.
            PDFInvalidPasswordError: If the password is incorrect.
            PDFCorruptedError: If the PDF is corrupted.
        """
        document_id = generate_uuid()

        try:
            if isinstance(source, bytes):
                pdf_bytes = source
            elif isinstance(source, (str, Path)):
                with open(str(source), "rb") as f:
                    pdf_bytes = f.read()
            else:
                raise PDFParseError("Invalid source type")

        except OSError as e:
            logger.error(f"Failed to read PDF file: {e}")
            raise PDFParseError(str(e))
        except Exception as e:
            logger.error(f"Failed to open PDF: {e}")
            raise PDFParseError(str(e))

        # Validate and handle encryption via pikepdf
        try:
            open_kwargs: dict = {}
            if password:
                open_kwargs["password"] = password

            with pikepdf.open(io.BytesIO(pdf_bytes), **open_kwargs) as pdf:
                is_encrypted = pdf.is_encrypted
                page_count = len(pdf.pages)

        except pikepdf.PasswordError:
            if not password:
                raise PDFEncryptedError()
            raise PDFInvalidPasswordError()
        except pikepdf.PdfError as e:
            logger.error(f"PDF corrupted: {e}")
            raise PDFCorruptedError(str(e))
        except Exception as e:
            logger.error(f"Failed to validate PDF: {e}")
            raise PDFParseError(str(e))

        # Store raw bytes
        self._documents[document_id] = pdf_bytes
        logger.info(f"Opened document {document_id} with {page_count} pages")

        proxy = LegacyDocumentProxy(document_id, pdf_bytes, page_count, is_encrypted)
        return document_id, proxy

    def get_document(self, document_id: str) -> "LegacyDocumentProxy":
        """
        Get an opened document by ID.

        DEPRECATED: PDF processing is now handled by @giga-pdf/pdf-engine (TypeScript).
        Returns a LegacyDocumentProxy over stored bytes for backward compatibility.

        Args:
            document_id: Document identifier.

        Returns:
            LegacyDocumentProxy: Proxy wrapping raw PDF bytes.

        Raises:
            KeyError: If document not found.
        """
        if document_id not in self._documents:
            raise KeyError(f"Document not found: {document_id}")
        pdf_bytes = self._documents[document_id]
        with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
            page_count = len(pdf.pages)
            is_encrypted = pdf.is_encrypted
        return LegacyDocumentProxy(document_id, pdf_bytes, page_count, is_encrypted)

    def close_document(self, document_id: str) -> None:
        """
        Remove a document from memory.

        Args:
            document_id: Document identifier.
        """
        if document_id in self._documents:
            del self._documents[document_id]
            logger.info(f"Closed document {document_id}")

    def save_document(
        self,
        document_id: str,
        output_path: Optional[str | Path] = None,
        garbage: int = 4,
        deflate: bool = True,
        deflate_images: bool = True,
        deflate_fonts: bool = True,
        clean: bool = True,
        incremental: bool = False,
        encryption: Optional[int] = None,
        owner_pw: Optional[str] = None,
        user_pw: Optional[str] = None,
        permissions: int = -1,
    ) -> bytes:
        """
        Save a document to bytes or file.

        DEPRECATED: PDF serialization is now handled by @giga-pdf/pdf-engine (TypeScript).
        Returns the stored raw bytes. Encryption parameters from PyMuPDF constants are ignored;
        use the TS engine for encryption.

        TODO: Route encryption to the TS engine via HTTP.

        Args:
            document_id: Document identifier.
            output_path: Optional file path to save to.
            (remaining args kept for backward compatibility but encryption via pikepdf
             requires the TS engine for full feature parity)

        Returns:
            bytes: PDF data as bytes.
        """
        if document_id not in self._documents:
            raise KeyError(f"Document not found: {document_id}")

        pdf_bytes = self._documents[document_id]

        if output_path:
            with open(str(output_path), "wb") as f:
                f.write(pdf_bytes)

        return pdf_bytes

    def get_page(self, document_id: str, page_number: int) -> "LegacyPageProxy":
        """
        Get a specific page from a document.

        DEPRECATED: Page operations are now handled by @giga-pdf/pdf-engine (TypeScript).

        Args:
            document_id: Document identifier.
            page_number: Page number (1-indexed).

        Returns:
            LegacyPageProxy: Lightweight proxy for backward compatibility.
        """
        if document_id not in self._documents:
            raise KeyError(f"Document not found: {document_id}")

        pdf_bytes = self._documents[document_id]
        with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
            page_count = len(pdf.pages)
            if page_number < 1 or page_number > page_count:
                raise IndexError(f"Page {page_number} not found (1-{page_count})")
            # Extract basic dimensions from MediaBox
            page = pdf.pages[page_number - 1]
            media_box = page.MediaBox
            width = float(media_box[2]) - float(media_box[0])
            height = float(media_box[3]) - float(media_box[1])

        return LegacyPageProxy(page_number, width, height)

    def add_page(
        self,
        document_id: str,
        position: int,
        width: float = 612,
        height: float = 792,
    ) -> "LegacyPageProxy":
        """
        Add a new blank page to the document.

        DEPRECATED: Page operations are now handled by @giga-pdf/pdf-engine (TypeScript).
        TODO: Route this call to the TS engine via HTTP.
        """
        logger.warning(
            "PDFEngine.add_page() is deprecated. Use @giga-pdf/pdf-engine via Next.js API routes."
        )
        return LegacyPageProxy(position, width, height)

    def delete_page(self, document_id: str, page_number: int) -> None:
        """
        Delete a page from the document.

        DEPRECATED: Page operations are now handled by @giga-pdf/pdf-engine (TypeScript).
        TODO: Route this call to the TS engine via HTTP.
        """
        logger.warning(
            "PDFEngine.delete_page() is deprecated. Use @giga-pdf/pdf-engine via Next.js API routes."
        )

    def move_page(self, document_id: str, from_page: int, to_page: int) -> None:
        """
        Move a page to a different position.

        DEPRECATED: Page operations are now handled by @giga-pdf/pdf-engine (TypeScript).
        TODO: Route this call to the TS engine via HTTP.
        """
        logger.warning(
            "PDFEngine.move_page() is deprecated. Use @giga-pdf/pdf-engine via Next.js API routes."
        )

    def rotate_page(self, document_id: str, page_number: int, angle: int) -> None:
        """
        Rotate a page.

        DEPRECATED: Page operations are now handled by @giga-pdf/pdf-engine (TypeScript).
        TODO: Route this call to the TS engine via HTTP.
        """
        logger.warning(
            "PDFEngine.rotate_page() is deprecated. Use @giga-pdf/pdf-engine via Next.js API routes."
        )

    def copy_page(
        self,
        source_doc_id: str,
        source_page: int,
        target_doc_id: Optional[str] = None,
        target_position: Optional[int] = None,
    ) -> int:
        """
        Copy a page within or between documents.

        DEPRECATED: Page operations are now handled by @giga-pdf/pdf-engine (TypeScript).
        TODO: Route this call to the TS engine via HTTP.
        """
        logger.warning(
            "PDFEngine.copy_page() is deprecated. Use @giga-pdf/pdf-engine via Next.js API routes."
        )
        return target_position or 1

    def get_metadata(self, document_id: str) -> dict[str, Any]:
        """
        Get document metadata via pikepdf.

        Args:
            document_id: Document identifier.

        Returns:
            dict: Document metadata.
        """
        if document_id not in self._documents:
            raise KeyError(f"Document not found: {document_id}")

        pdf_bytes = self._documents[document_id]
        with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
            meta = pdf.open_metadata()
            page_count = len(pdf.pages)
            is_encrypted = pdf.is_encrypted
            docinfo = pdf.docinfo

            return {
                "title": str(docinfo.get("/Title", "")) or None,
                "author": str(docinfo.get("/Author", "")) or None,
                "subject": str(docinfo.get("/Subject", "")) or None,
                "keywords": [k.strip() for k in str(docinfo.get("/Keywords", "")).split(",") if k.strip()],
                "creator": str(docinfo.get("/Creator", "")) or None,
                "producer": str(docinfo.get("/Producer", "")) or None,
                "creation_date": str(docinfo.get("/CreationDate", "")) or None,
                "modification_date": str(docinfo.get("/ModDate", "")) or None,
                "page_count": page_count,
                "pdf_version": f"PDF {pdf.pdf_version}",
                "is_encrypted": is_encrypted,
            }

    def set_metadata(
        self,
        document_id: str,
        title: Optional[str] = None,
        author: Optional[str] = None,
        subject: Optional[str] = None,
        keywords: Optional[list[str]] = None,
        creator: Optional[str] = None,
        producer: Optional[str] = None,
    ) -> None:
        """
        Set document metadata via pikepdf.

        Args:
            document_id: Document identifier.
            title, author, subject, keywords, creator, producer: Metadata fields.
        """
        if document_id not in self._documents:
            raise KeyError(f"Document not found: {document_id}")

        pdf_bytes = self._documents[document_id]
        output = io.BytesIO()

        with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
            with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
                if title is not None:
                    pdf.docinfo["/Title"] = title
                if author is not None:
                    pdf.docinfo["/Author"] = author
                if subject is not None:
                    pdf.docinfo["/Subject"] = subject
                if keywords is not None:
                    pdf.docinfo["/Keywords"] = ",".join(keywords)
                if creator is not None:
                    pdf.docinfo["/Creator"] = creator
                if producer is not None:
                    pdf.docinfo["/Producer"] = producer
            pdf.save(output)

        self._documents[document_id] = output.getvalue()
        logger.info(f"Updated metadata for document {document_id}")

    def get_page_dimensions(self, document_id: str, page_number: int) -> dict[str, float]:
        """
        Get page dimensions via pikepdf.

        Args:
            document_id: Document identifier.
            page_number: Page number (1-indexed).

        Returns:
            dict: Page dimensions {width, height, rotation}.
        """
        if document_id not in self._documents:
            raise KeyError(f"Document not found: {document_id}")

        pdf_bytes = self._documents[document_id]
        with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
            page = pdf.pages[page_number - 1]
            media_box = page.MediaBox
            width = float(media_box[2]) - float(media_box[0])
            height = float(media_box[3]) - float(media_box[1])
            # Rotation stored in /Rotate key
            rotate = int(page.get("/Rotate", 0))

        return {"width": width, "height": height, "rotation": rotate}

    def resize_page(
        self,
        document_id: str,
        page_number: int,
        width: float,
        height: float,
        scale_content: bool = False,
    ) -> None:
        """
        Resize a page.

        DEPRECATED: Page operations are now handled by @giga-pdf/pdf-engine (TypeScript).
        TODO: Route this call to the TS engine via HTTP.
        """
        logger.warning(
            "PDFEngine.resize_page() is deprecated. Use @giga-pdf/pdf-engine via Next.js API routes."
        )

    def clear_all(self) -> None:
        """Clear all stored document bytes from memory."""
        self._documents.clear()
        logger.info("Cleared all documents from memory")


class LegacyDocumentProxy:
    """
    Lightweight proxy replacing fitz.Document for backward compatibility.

    DEPRECATED: This class exists only to prevent import errors in code that
    was written against fitz.Document. All real PDF operations must go through
    @giga-pdf/pdf-engine (TypeScript).
    """

    def __init__(self, document_id: str, pdf_bytes: bytes, page_count: int, is_encrypted: bool):
        self.document_id = document_id
        self._pdf_bytes = pdf_bytes
        self.page_count = page_count
        self.is_encrypted = is_encrypted

    def tobytes(self) -> bytes:
        """Return raw PDF bytes."""
        return self._pdf_bytes

    def authenticate(self, password: str) -> bool:
        """Attempt to authenticate with pikepdf."""
        try:
            with pikepdf.open(io.BytesIO(self._pdf_bytes), password=password):
                return True
        except pikepdf.PasswordError:
            return False

    @property
    def metadata(self) -> dict:
        """Return basic docinfo dict via pikepdf."""
        try:
            with pikepdf.open(io.BytesIO(self._pdf_bytes)) as pdf:
                di = pdf.docinfo
                return {
                    "title": str(di.get("/Title", "")),
                    "author": str(di.get("/Author", "")),
                    "subject": str(di.get("/Subject", "")),
                    "keywords": str(di.get("/Keywords", "")),
                    "creator": str(di.get("/Creator", "")),
                    "producer": str(di.get("/Producer", "")),
                    "creationDate": str(di.get("/CreationDate", "")),
                    "modDate": str(di.get("/ModDate", "")),
                    "format": "PDF 1.7",
                    "encryption": "",
                }
        except Exception:
            return {}

    @property
    def permissions(self) -> int:
        """Return permissions bitmask — always -1 (all allowed) for unencrypted docs."""
        return -1

    @permissions.setter
    def permissions(self, value: int) -> None:
        """Setter kept for backward compatibility; actual encryption handled by TS engine."""
        logger.warning(
            "Setting permissions via LegacyDocumentProxy is a no-op. "
            "Use @giga-pdf/pdf-engine for PDF encryption."
        )

    def set_metadata(self, metadata: dict) -> None:
        """No-op metadata setter for backward compatibility."""
        logger.warning(
            "LegacyDocumentProxy.set_metadata() is a no-op. "
            "Use PDFEngine.set_metadata() or @giga-pdf/pdf-engine."
        )

    def close(self) -> None:
        """No-op close for backward compatibility."""
        pass

    def select(self, page_indices: list[int]) -> None:
        """
        Reorder pages via pikepdf — kept for document_service.reorder_pages().

        DEPRECATED: Use @giga-pdf/pdf-engine for page reordering.
        """
        logger.warning(
            "LegacyDocumentProxy.select() is deprecated. "
            "Use @giga-pdf/pdf-engine for page operations."
        )


class LegacyPageProxy:
    """
    Lightweight proxy replacing fitz.Page for backward compatibility.

    DEPRECATED: Exists only to satisfy type signatures in code written against
    fitz.Page. Real page rendering belongs in @giga-pdf/pdf-engine (TypeScript).
    """

    def __init__(self, page_number: int, width: float, height: float, rotation: int = 0):
        self.page_number = page_number
        self._width = width
        self._height = height
        self.rotation = rotation

    class _Rect:
        def __init__(self, width: float, height: float):
            self.width = width
            self.height = height
            self.x0 = 0.0
            self.y0 = 0.0
            self.x1 = width
            self.y1 = height

    @property
    def rect(self) -> "_Rect":
        return self._Rect(self._width, self._height)

    @property
    def mediabox(self) -> "_Rect":
        return self._Rect(self._width, self._height)

    @property
    def cropbox(self) -> "_Rect":
        return self._Rect(self._width, self._height)


# Global engine instance
pdf_engine = PDFEngine()
