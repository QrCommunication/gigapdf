"""
Document Service - High-level document operations.

Orchestrates PDF operations between the engine, parser,
and session management.
"""

import logging
from typing import Any, Optional

import fitz  # PyMuPDF

from app.config import get_settings
from app.core.parser import PDFParser
from app.core.pdf_engine import pdf_engine
from app.core.preview import PreviewGenerator
from app.middleware.error_handler import (
    DocumentNotFoundError,
    InvalidOperationError,
    PDFParseError,
)
from app.models.document import DocumentObject
from app.models.page import PageObject
from app.repositories.document_repo import DocumentSession, document_sessions
from app.utils.helpers import generate_uuid, sanitize_filename

logger = logging.getLogger(__name__)


class DocumentService:
    """
    High-level document operations service.

    Handles document upload, parsing, manipulation, and export.
    """

    def __init__(self):
        """Initialize document service."""
        self.settings = get_settings()
        self.engine = pdf_engine

    async def upload_document(
        self,
        file_data: bytes,
        filename: str,
        password: Optional[str] = None,
        owner_id: Optional[str] = None,
        extract_text: bool = True,
        generate_previews: bool = True,
    ) -> tuple[str, DocumentObject]:
        """
        Upload and parse a PDF document.

        Args:
            file_data: PDF file bytes.
            filename: Original filename.
            password: PDF password if encrypted.
            owner_id: Owner user ID.
            extract_text: Extract text elements.
            generate_previews: Generate preview URLs.

        Returns:
            tuple: (document_id, DocumentObject)
        """
        # Validate file size
        if len(file_data) > self.settings.max_upload_size_bytes:
            raise InvalidOperationError(
                f"File too large. Maximum size: {self.settings.max_upload_size_mb}MB"
            )

        # Sanitize filename
        safe_filename = sanitize_filename(filename)

        # Open document
        document_id, pdf_doc = self.engine.open_document(file_data, password)

        try:
            # Validate page count
            if pdf_doc.page_count > self.settings.max_pages_per_document:
                raise InvalidOperationError(
                    f"Document has too many pages. Maximum: {self.settings.max_pages_per_document}"
                )

            # Parse document to scene graph
            parser = PDFParser(document_id)
            scene_graph = parser.parse_document(
                pdf_doc,
                extract_text=extract_text,
                include_previews=generate_previews,
            )

            # Create session with PDF bytes for Redis storage
            session = document_sessions.create_session(
                document_id=document_id,
                pdf_doc=pdf_doc,
                scene_graph=scene_graph,
                owner_id=owner_id,
                filename=safe_filename,
                file_size=len(file_data),
                pdf_bytes=file_data,
            )

            logger.info(f"Document uploaded: {document_id} ({safe_filename})")
            return document_id, scene_graph

        except Exception as e:
            # Clean up on error
            self.engine.close_document(document_id)
            raise

    def get_document(
        self,
        document_id: str,
        include_elements: bool = True,
        page_range: Optional[str] = None,
    ) -> DocumentObject:
        """
        Get document structure.

        Args:
            document_id: Document identifier.
            include_elements: Include page elements.
            page_range: Optional page range filter.

        Returns:
            DocumentObject: Document structure.
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        doc = session.scene_graph

        # Filter pages if range specified
        if page_range:
            from app.utils.helpers import parse_page_range
            page_nums = parse_page_range(page_range, doc.metadata.page_count)
            doc = DocumentObject(
                document_id=doc.document_id,
                metadata=doc.metadata,
                pages=[p for p in doc.pages if p.page_number in page_nums],
                outlines=doc.outlines,
                layers=doc.layers,
                embedded_files=doc.embedded_files,
            )

        # Remove elements if not requested
        if not include_elements:
            for page in doc.pages:
                page.elements = []

        return doc

    def get_page(
        self,
        document_id: str,
        page_number: int,
        include_elements: bool = True,
    ) -> PageObject:
        """
        Get a specific page.

        Args:
            document_id: Document identifier.
            page_number: Page number (1-indexed).
            include_elements: Include page elements.

        Returns:
            PageObject: Page structure.
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        doc = session.scene_graph

        if page_number < 1 or page_number > len(doc.pages):
            from app.middleware.error_handler import PageNotFoundError
            raise PageNotFoundError(page_number)

        page = doc.pages[page_number - 1]

        if not include_elements:
            page = PageObject(
                page_id=page.page_id,
                page_number=page.page_number,
                dimensions=page.dimensions,
                media_box=page.media_box,
                crop_box=page.crop_box,
                elements=[],
                preview=page.preview,
            )

        return page

    def get_page_preview(
        self,
        document_id: str,
        page_number: int,
        dpi: int = 150,
        format: str = "png",
        quality: int = 85,
    ) -> tuple[bytes, str]:
        """
        Get page preview image.

        Args:
            document_id: Document identifier.
            page_number: Page number (1-indexed).
            dpi: Resolution.
            format: Image format.
            quality: JPEG/WebP quality.

        Returns:
            tuple: (image_bytes, content_type)
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        generator = PreviewGenerator(session.pdf_doc)

        image_data = generator.render_page(
            page_number=page_number,
            dpi=min(dpi, self.settings.preview_max_dpi),
            format=format,
            quality=quality,
        )

        content_type_map = {
            "png": "image/png",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
            "svg": "image/svg+xml",
        }

        return image_data, content_type_map.get(format, "image/png")

    def download_document(
        self,
        document_id: str,
        flatten_forms: bool = False,
        flatten_annotations: bool = False,
        optimize: bool = False,
    ) -> tuple[bytes, str]:
        """
        Download the modified PDF.

        Args:
            document_id: Document identifier.
            flatten_forms: Flatten form fields.
            flatten_annotations: Flatten annotations.
            optimize: Optimize file size.

        Returns:
            tuple: (pdf_bytes, filename)
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        # Apply flattening if requested
        if flatten_forms or flatten_annotations:
            from app.core.renderer import PDFRenderer
            renderer = PDFRenderer(session.pdf_doc)

            if flatten_forms:
                renderer.flatten_forms()
            if flatten_annotations:
                renderer.flatten_annotations()

        # Save to bytes
        pdf_bytes = self.engine.save_document(
            document_id,
            garbage=4 if optimize else 0,
            deflate=optimize,
            clean=optimize,
        )

        filename = session.original_filename or f"document_{document_id}.pdf"

        return pdf_bytes, filename

    def delete_document(self, document_id: str) -> bool:
        """
        Delete a document and free memory.

        Args:
            document_id: Document identifier.

        Returns:
            bool: True if deleted.
        """
        # Close engine document
        try:
            self.engine.close_document(document_id)
        except KeyError:
            pass

        # Delete session
        deleted = document_sessions.delete_session(document_id)

        if deleted:
            logger.info(f"Document deleted: {document_id}")

        return deleted

    def add_page(
        self,
        document_id: str,
        position: int,
        width: float = 612,
        height: float = 792,
    ) -> PageObject:
        """
        Add a blank page to the document.

        Args:
            document_id: Document identifier.
            position: Position to insert (1-indexed).
            width: Page width in points.
            height: Page height in points.

        Returns:
            PageObject: New page.
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        # Add page to PDF
        self.engine.add_page(document_id, position, width, height)

        # Re-parse the page
        parser = PDFParser(document_id)
        new_page = parser.parse_page(
            session.pdf_doc[position - 1],
            position,
        )

        # Update scene graph
        session.scene_graph.pages.insert(position - 1, new_page)

        # Update page numbers
        for i, page in enumerate(session.scene_graph.pages):
            page.page_number = i + 1

        # Update metadata
        session.scene_graph.metadata.page_count = len(session.scene_graph.pages)

        # Add history entry
        document_sessions.push_history(
            document_id,
            f"Added blank page at position {position}",
            affected_pages=[position],
        )

        return new_page

    def delete_page(self, document_id: str, page_number: int) -> int:
        """
        Delete a page from the document.

        Args:
            document_id: Document identifier.
            page_number: Page to delete (1-indexed).

        Returns:
            int: New page count.
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        if session.scene_graph.metadata.page_count <= 1:
            raise InvalidOperationError("Cannot delete the last page")

        # Delete from PDF
        self.engine.delete_page(document_id, page_number)

        # Update scene graph
        del session.scene_graph.pages[page_number - 1]

        # Update page numbers
        for i, page in enumerate(session.scene_graph.pages):
            page.page_number = i + 1

        # Update metadata
        session.scene_graph.metadata.page_count = len(session.scene_graph.pages)

        # Add history entry
        document_sessions.push_history(
            document_id,
            f"Deleted page {page_number}",
            affected_pages=[page_number],
        )

        return session.scene_graph.metadata.page_count

    def rotate_page(
        self,
        document_id: str,
        page_number: int,
        angle: int,
    ) -> PageObject:
        """
        Rotate a page.

        Args:
            document_id: Document identifier.
            page_number: Page to rotate (1-indexed).
            angle: Rotation angle (90, 180, 270, -90, etc).

        Returns:
            PageObject: Updated page.
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        # Validate angle
        from app.utils.validators import validate_rotation
        normalized_angle = validate_rotation(angle)

        # Rotate in PDF
        self.engine.rotate_page(document_id, page_number, normalized_angle)

        # Update scene graph
        page = session.scene_graph.pages[page_number - 1]
        page.dimensions.rotation = (page.dimensions.rotation + normalized_angle) % 360

        # Add history entry
        document_sessions.push_history(
            document_id,
            f"Rotated page {page_number} by {angle} degrees",
            affected_pages=[page_number],
        )

        return page

    def reorder_pages(
        self,
        document_id: str,
        new_order: list[int],
    ) -> list[PageObject]:
        """
        Reorder pages in the document.

        Args:
            document_id: Document identifier.
            new_order: New page order (1-indexed page numbers).

        Returns:
            list[PageObject]: Reordered pages.
        """
        session = document_sessions.get_session(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        page_count = session.scene_graph.metadata.page_count

        # Validate new order
        if sorted(new_order) != list(range(1, page_count + 1)):
            raise InvalidOperationError(
                f"Invalid page order. Expected pages 1-{page_count}"
            )

        # Reorder in PDF
        # PyMuPDF requires sequential moves, so we use select
        session.pdf_doc.select([p - 1 for p in new_order])

        # Reorder scene graph pages
        new_pages = [session.scene_graph.pages[p - 1] for p in new_order]
        for i, page in enumerate(new_pages):
            page.page_number = i + 1
        session.scene_graph.pages = new_pages

        # Add history entry
        document_sessions.push_history(
            document_id,
            "Reordered pages",
            affected_pages=list(range(1, page_count + 1)),
        )

        return session.scene_graph.pages


# Global service instance
document_service = DocumentService()
