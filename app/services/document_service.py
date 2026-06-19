# DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes instead
"""
Document Service - High-level document operations.

Orchestrates PDF operations between the engine, parser,
and session management.
"""

import logging

import httpx

from app.config import get_settings
from app.core.pdf_engine import pdf_engine
from app.middleware.error_handler import (
    DocumentNotFoundError,
    InvalidOperationError,
    PageNotFoundError,
)
from app.models.document import DocumentMetadata, DocumentObject
from app.models.page import Dimensions, MediaBox, PageObject
from app.repositories.document_repo import document_sessions
from app.utils.helpers import generate_uuid, sanitize_filename

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Next.js engine integration (page rendering)
# ---------------------------------------------------------------------------
# Page rendering is performed by the Next.js TypeScript engine via
# POST /api/pdf/preview (which renders a PDF page to PNG/JPEG/WebP through
# @giga-pdf/pdf-engine). The Python process no longer rasterises pages itself.
_NEXTJS_PREVIEW_PATH = "/api/pdf/preview"
_TS_ENGINE_TIMEOUT = 30.0  # seconds per page render request
# Image formats the TS engine can produce.
_TS_PREVIEW_FORMATS = frozenset({"png", "jpeg", "webp"})


def _render_page_via_ts_sync(
    pdf_bytes: bytes,
    page_number: int,
    fmt: str,
    dpi: int,
    quality: int,
) -> bytes:
    """
    Render a single PDF page to an image via the Next.js @giga-pdf/pdf-engine.

    Synchronous (uses httpx.Client) so it can be called from the synchronous
    DocumentService.get_page_preview without spinning up an event loop.

    Args:
        pdf_bytes: Raw PDF file bytes.
        page_number: 1-based page number to render.
        fmt: Output image format — "png", "jpeg", or "webp".
        dpi: Render resolution.
        quality: Compression quality for jpeg/webp (1-100).

    Returns:
        Raw image bytes in the requested format.

    Raises:
        httpx.HTTPStatusError: If the TS engine returns a non-2xx response.
        httpx.TimeoutException: If the request exceeds _TS_ENGINE_TIMEOUT seconds.
        RuntimeError: If the response body is unexpectedly empty.
    """
    settings = get_settings()
    base_url = settings.nextjs_internal_url.rstrip("/")
    url = f"{base_url}{_NEXTJS_PREVIEW_PATH}"

    # /api/pdf/preview requires authentication (requireSession). As a
    # server-to-server caller the API process has no user session, so it
    # authenticates with the shared internal secret instead. Must match
    # INTERNAL_API_SECRET in the Next.js environment.
    headers: dict[str, str] = {}
    if settings.internal_api_secret:
        headers["X-Internal-Secret"] = settings.internal_api_secret

    with httpx.Client(timeout=_TS_ENGINE_TIMEOUT) as client:
        response = client.post(
            url,
            headers=headers,
            files={"file": ("document.pdf", pdf_bytes, "application/pdf")},
            data={
                "mode": "page",
                "pageNumber": str(page_number),
                "format": fmt,
                "dpi": str(dpi),
                "quality": str(quality),
            },
        )
        response.raise_for_status()

    image_bytes = response.content
    if not image_bytes:
        raise RuntimeError(
            f"TS engine returned empty body for page {page_number} "
            f"(format={fmt}, status={response.status_code})"
        )
    return image_bytes


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
        password: str | None = None,
        owner_id: str | None = None,
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

            # Build a minimal scene_graph: page dimensions only.
            # The real scene_graph (text, images, annotations, forms) is loaded
            # by the TypeScript pdf-engine via /api/pdf/parse-from-s3.
            #
            # Use get_all_page_dimensions() to extract all page dimensions in a
            # single pikepdf.open() call instead of calling get_page() once per
            # page (which was an N+1 pikepdf.open() pattern).
            all_dims = self.engine.get_all_page_dimensions(document_id)
            pages = [
                PageObject(
                    page_id=generate_uuid(),
                    page_number=d["page_number"],
                    dimensions=Dimensions(
                        width=d["width"],
                        height=d["height"],
                        rotation=d["rotation"],
                    ),
                    media_box=MediaBox(
                        x=0,
                        y=0,
                        width=d["width"],
                        height=d["height"],
                    ),
                    elements=[],
                )
                for d in all_dims
            ]
            scene_graph = DocumentObject(
                document_id=document_id,
                metadata=DocumentMetadata(page_count=pdf_doc.page_count),
                pages=pages,
            )

            # Create session with PDF bytes for Redis storage (awaited — durable before return)
            await document_sessions.create_session(
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

        except Exception:
            # Clean up on error
            self.engine.close_document(document_id)
            raise

    def get_document(
        self,
        document_id: str,
        include_elements: bool = True,
        page_range: str | None = None,
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
        session = document_sessions.get_session_sync(document_id)
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
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        doc = session.scene_graph

        if page_number < 1 or page_number > len(doc.pages):
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
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        content_type_map = {
            "png": "image/png",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
            "svg": "image/svg+xml",
        }

        # SVG is not produced by the TS engine (nor was it ever truly rendered
        # Python-side — the old PreviewGenerator returned an empty SVG stub).
        # Preserve that behaviour so the endpoint contract does not change.
        if format == "svg":
            return (
                b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
                content_type_map["svg"],
            )

        # Raster formats are rendered by @giga-pdf/pdf-engine via the Next.js
        # POST /api/pdf/preview route. session.pdf_doc exposes .tobytes().
        pdf_bytes = session.pdf_doc.tobytes()
        image_data = _render_page_via_ts_sync(
            pdf_bytes=pdf_bytes,
            page_number=page_number,
            fmt=format,
            dpi=min(dpi, self.settings.preview_max_dpi),
            quality=quality,
        )

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
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        # Flattening is handled by @giga-pdf/pdf-engine (TypeScript).
        # The flatten_forms/flatten_annotations flags are passed through to the TS engine
        # on save; no Python-side operation is required here.
        if flatten_forms or flatten_annotations:
            logger.debug(
                "flatten_forms=%s flatten_annotations=%s: applied by TS engine on save",
                flatten_forms,
                flatten_annotations,
            )

        # Save to bytes
        pdf_bytes = self.engine.save_document(
            document_id,
            garbage=4 if optimize else 0,
            deflate=optimize,
            clean=optimize,
        )

        filename = session.original_filename or f"document_{document_id}.pdf"

        return pdf_bytes, filename

    async def delete_document(self, document_id: str) -> bool:
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

        # Delete session from local cache and Redis
        deleted = await document_sessions.delete_session(document_id)

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
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        # Add page to PDF (0-indexed: position - 1 inserts before existing page at that slot)
        self.engine.add_page(document_id, position - 1, width, height)

        # Propagate updated bytes to session proxy so save_session / tobytes() are correct
        updated_bytes = self.engine._documents[document_id]
        session._pdf_bytes = updated_bytes
        session.pdf_doc._pdf_bytes = updated_bytes

        # Build a minimal PageObject for the new blank page.
        # The TS engine loads the real scene_graph via parse-from-s3.
        new_page = PageObject(
            page_id=generate_uuid(),
            page_number=position,
            dimensions=Dimensions(width=width, height=height, rotation=0),
            media_box=MediaBox(x=0, y=0, width=width, height=height),
            elements=[],
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
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        if session.scene_graph.metadata.page_count <= 1:
            raise InvalidOperationError("Cannot delete the last page")

        # Delete from PDF
        self.engine.delete_page(document_id, page_number)

        # Propagate updated bytes to session proxy so save_session / tobytes() are correct
        updated_bytes = self.engine._documents[document_id]
        session._pdf_bytes = updated_bytes
        session.pdf_doc._pdf_bytes = updated_bytes

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
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        # Validate angle
        from app.utils.validators import validate_rotation
        normalized_angle = validate_rotation(angle)

        # Compute the new absolute rotation (PDF /Rotate is absolute, not cumulative)
        page = session.scene_graph.pages[page_number - 1]
        absolute_rotation = (page.dimensions.rotation + normalized_angle) % 360

        # Rotate in PDF with the absolute target angle
        self.engine.rotate_page(document_id, page_number, absolute_rotation)

        # Propagate updated bytes to session proxy so save_session / tobytes() are correct
        updated_bytes = self.engine._documents[document_id]
        session._pdf_bytes = updated_bytes
        session.pdf_doc._pdf_bytes = updated_bytes

        # Update scene graph
        page.dimensions.rotation = absolute_rotation

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
        session = document_sessions.get_session_sync(document_id)
        if not session:
            raise DocumentNotFoundError(document_id)

        page_count = session.scene_graph.metadata.page_count

        # Validate new order
        if sorted(new_order) != list(range(1, page_count + 1)):
            raise InvalidOperationError(
                f"Invalid page order. Expected pages 1-{page_count}"
            )

        # Reorder in PDF via engine (0-indexed).
        # session.pdf_doc.select() delegates to pdf_engine.reorder_pages() and
        # updates session.pdf_doc._pdf_bytes automatically.
        session.pdf_doc.select([p - 1 for p in new_order])

        # Keep session bytes in sync with the proxy bytes
        session._pdf_bytes = session.pdf_doc._pdf_bytes

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
