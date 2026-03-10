"""
Main PDF engine using PyMuPDF.

Provides the core functionality for opening, manipulating,
and saving PDF documents.
"""

import io
import logging
from pathlib import Path
from typing import Any, Optional

import fitz  # PyMuPDF

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
    Core PDF manipulation engine using PyMuPDF.

    Handles low-level PDF operations including opening, editing,
    and saving PDF documents.
    """

    def __init__(self):
        """Initialize the PDF engine."""
        self._documents: dict[str, fitz.Document] = {}

    def open_document(
        self,
        source: bytes | str | Path,
        password: Optional[str] = None,
    ) -> tuple[str, fitz.Document]:
        """
        Open a PDF document from bytes, file path, or stream.

        Args:
            source: PDF data as bytes, file path, or Path object.
            password: Optional password for encrypted PDFs.

        Returns:
            tuple: (document_id, fitz.Document) pair.

        Raises:
            PDFParseError: If the PDF cannot be parsed.
            PDFEncryptedError: If the PDF is encrypted and no password provided.
            PDFInvalidPasswordError: If the password is incorrect.
            PDFCorruptedError: If the PDF is corrupted.
        """
        document_id = generate_uuid()

        try:
            if isinstance(source, bytes):
                # Open from bytes
                doc = fitz.open(stream=source, filetype="pdf")
            elif isinstance(source, (str, Path)):
                # Open from file path
                doc = fitz.open(str(source))
            else:
                raise PDFParseError("Invalid source type")

        except fitz.FileDataError as e:
            logger.error(f"PDF corrupted: {e}")
            raise PDFCorruptedError(str(e))
        except Exception as e:
            logger.error(f"Failed to open PDF: {e}")
            raise PDFParseError(str(e))

        # Handle encrypted documents
        if doc.is_encrypted:
            if not password:
                doc.close()
                raise PDFEncryptedError()

            if not doc.authenticate(password):
                doc.close()
                raise PDFInvalidPasswordError()

        # Store document
        self._documents[document_id] = doc
        logger.info(f"Opened document {document_id} with {doc.page_count} pages")

        return document_id, doc

    def get_document(self, document_id: str) -> fitz.Document:
        """
        Get an opened document by ID.

        Args:
            document_id: Document identifier.

        Returns:
            fitz.Document: The PDF document.

        Raises:
            KeyError: If document not found.
        """
        if document_id not in self._documents:
            raise KeyError(f"Document not found: {document_id}")
        return self._documents[document_id]

    def close_document(self, document_id: str) -> None:
        """
        Close and remove a document from memory.

        Args:
            document_id: Document identifier.
        """
        if document_id in self._documents:
            self._documents[document_id].close()
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

        Args:
            document_id: Document identifier.
            output_path: Optional file path to save to.
            garbage: Garbage collection level (0-4).
            deflate: Compress streams.
            deflate_images: Compress images.
            deflate_fonts: Compress fonts.
            clean: Clean and sanitize content.
            incremental: Incremental save (if opened from file).
            encryption: Encryption method (fitz constants).
            owner_pw: Owner password for encryption.
            user_pw: User password for encryption.
            permissions: Permission flags.

        Returns:
            bytes: PDF data as bytes.
        """
        doc = self.get_document(document_id)

        # Build save options
        options = {
            "garbage": garbage,
            "deflate": deflate,
            "deflate_images": deflate_images,
            "deflate_fonts": deflate_fonts,
            "clean": clean,
        }

        # Add encryption if specified
        if encryption is not None:
            options["encryption"] = encryption
            if owner_pw:
                options["owner_pw"] = owner_pw
            if user_pw:
                options["user_pw"] = user_pw
            options["permissions"] = permissions

        # Save
        if output_path:
            doc.save(str(output_path), **options)
            with open(output_path, "rb") as f:
                return f.read()
        else:
            return doc.tobytes(**options)

    def get_page(self, document_id: str, page_number: int) -> fitz.Page:
        """
        Get a specific page from a document.

        Args:
            document_id: Document identifier.
            page_number: Page number (1-indexed).

        Returns:
            fitz.Page: The requested page.

        Raises:
            IndexError: If page number is out of range.
        """
        doc = self.get_document(document_id)

        # Convert to 0-indexed
        page_index = page_number - 1

        if page_index < 0 or page_index >= doc.page_count:
            raise IndexError(f"Page {page_number} not found (1-{doc.page_count})")

        return doc[page_index]

    def add_page(
        self,
        document_id: str,
        position: int,
        width: float = 612,
        height: float = 792,
    ) -> fitz.Page:
        """
        Add a new blank page to the document.

        Args:
            document_id: Document identifier.
            position: Position to insert (1-indexed).
            width: Page width in points.
            height: Page height in points.

        Returns:
            fitz.Page: The new page.
        """
        doc = self.get_document(document_id)

        # Convert to 0-indexed
        page_index = position - 1
        page_index = max(0, min(page_index, doc.page_count))

        # Insert blank page
        page = doc.new_page(pno=page_index, width=width, height=height)

        logger.info(f"Added page at position {position} in document {document_id}")
        return page

    def delete_page(self, document_id: str, page_number: int) -> None:
        """
        Delete a page from the document.

        Args:
            document_id: Document identifier.
            page_number: Page number to delete (1-indexed).
        """
        doc = self.get_document(document_id)

        # Convert to 0-indexed
        page_index = page_number - 1

        if page_index < 0 or page_index >= doc.page_count:
            raise IndexError(f"Page {page_number} not found (1-{doc.page_count})")

        doc.delete_page(page_index)
        logger.info(f"Deleted page {page_number} from document {document_id}")

    def move_page(self, document_id: str, from_page: int, to_page: int) -> None:
        """
        Move a page to a different position.

        Args:
            document_id: Document identifier.
            from_page: Current page number (1-indexed).
            to_page: Target page number (1-indexed).
        """
        doc = self.get_document(document_id)

        # Convert to 0-indexed
        from_index = from_page - 1
        to_index = to_page - 1

        doc.move_page(from_index, to_index)
        logger.info(f"Moved page {from_page} to {to_page} in document {document_id}")

    def rotate_page(self, document_id: str, page_number: int, angle: int) -> None:
        """
        Rotate a page.

        Args:
            document_id: Document identifier.
            page_number: Page number (1-indexed).
            angle: Rotation angle (multiple of 90).
        """
        page = self.get_page(document_id, page_number)

        # Normalize angle
        angle = angle % 360

        # Set rotation
        page.set_rotation(angle)
        logger.info(f"Rotated page {page_number} by {angle} degrees")

    def copy_page(
        self,
        source_doc_id: str,
        source_page: int,
        target_doc_id: Optional[str] = None,
        target_position: Optional[int] = None,
    ) -> int:
        """
        Copy a page within or between documents.

        Args:
            source_doc_id: Source document ID.
            source_page: Source page number (1-indexed).
            target_doc_id: Target document ID (same as source if None).
            target_position: Target position (end if None).

        Returns:
            int: New page number in target document.
        """
        source_doc = self.get_document(source_doc_id)
        target_doc = self.get_document(target_doc_id or source_doc_id)

        # Source page (0-indexed)
        source_index = source_page - 1

        # Target position
        if target_position is None:
            target_index = target_doc.page_count
        else:
            target_index = target_position - 1

        # Copy page
        target_doc.insert_pdf(
            source_doc,
            from_page=source_index,
            to_page=source_index,
            start_at=target_index,
        )

        return target_index + 1

    def get_metadata(self, document_id: str) -> dict[str, Any]:
        """
        Get document metadata.

        Args:
            document_id: Document identifier.

        Returns:
            dict: Document metadata.
        """
        doc = self.get_document(document_id)

        metadata = doc.metadata or {}

        return {
            "title": metadata.get("title"),
            "author": metadata.get("author"),
            "subject": metadata.get("subject"),
            "keywords": metadata.get("keywords", "").split(",") if metadata.get("keywords") else [],
            "creator": metadata.get("creator"),
            "producer": metadata.get("producer"),
            "creation_date": metadata.get("creationDate"),
            "modification_date": metadata.get("modDate"),
            "page_count": doc.page_count,
            "pdf_version": f"{doc.metadata.get('format', 'PDF 1.7')}",
            "is_encrypted": doc.is_encrypted,
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
        Set document metadata.

        Args:
            document_id: Document identifier.
            title: Document title.
            author: Document author.
            subject: Document subject.
            keywords: Document keywords.
            creator: Creating application.
            producer: PDF producer.
        """
        doc = self.get_document(document_id)

        metadata = doc.metadata or {}

        if title is not None:
            metadata["title"] = title
        if author is not None:
            metadata["author"] = author
        if subject is not None:
            metadata["subject"] = subject
        if keywords is not None:
            metadata["keywords"] = ",".join(keywords)
        if creator is not None:
            metadata["creator"] = creator
        if producer is not None:
            metadata["producer"] = producer

        doc.set_metadata(metadata)
        logger.info(f"Updated metadata for document {document_id}")

    def get_page_dimensions(self, document_id: str, page_number: int) -> dict[str, float]:
        """
        Get page dimensions.

        Args:
            document_id: Document identifier.
            page_number: Page number (1-indexed).

        Returns:
            dict: Page dimensions {width, height, rotation}.
        """
        page = self.get_page(document_id, page_number)

        return {
            "width": page.rect.width,
            "height": page.rect.height,
            "rotation": page.rotation,
        }

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

        Args:
            document_id: Document identifier.
            page_number: Page number (1-indexed).
            width: New width in points.
            height: New height in points.
            scale_content: Whether to scale page content.
        """
        page = self.get_page(document_id, page_number)

        old_rect = page.rect
        new_rect = fitz.Rect(0, 0, width, height)

        if scale_content:
            # Calculate scale factors
            scale_x = width / old_rect.width
            scale_y = height / old_rect.height

            # Apply transformation matrix
            mat = fitz.Matrix(scale_x, scale_y)
            page.set_mediabox(new_rect)

            # Transform content
            # Note: This is a simplified approach
            # Full content scaling requires more complex handling
        else:
            page.set_mediabox(new_rect)

        logger.info(f"Resized page {page_number} to {width}x{height}")

    def clear_all(self) -> None:
        """Close all documents and clear memory."""
        for doc_id in list(self._documents.keys()):
            self.close_document(doc_id)
        logger.info("Cleared all documents from memory")


# Global engine instance
pdf_engine = PDFEngine()
