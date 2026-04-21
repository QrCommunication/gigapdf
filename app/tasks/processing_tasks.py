# DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes instead
"""
Document processing Celery tasks.

Async tasks for merge, split, and other document operations.
"""

import asyncio
import logging
from typing import Optional

from celery import shared_task

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.processing_tasks.merge_documents")
def merge_documents(
    self,
    document_configs: list[dict],
    output_name: Optional[str] = None,
) -> dict:
    """
    Merge multiple documents into one.

    Args:
        self: Celery task instance.
        document_configs: List of {document_id, page_ranges} configs.
        output_name: Name for merged document.

    Returns:
        dict: Merge result with new document ID.
    """
    import io as _io
    import pikepdf
    from app.core.parser import PDFParser
    from app.core.pdf_engine import LegacyDocumentProxy, pdf_engine
    from app.repositories.document_repo import document_sessions
    from app.utils.helpers import generate_uuid, parse_page_range

    logger.info(f"Starting merge of {len(document_configs)} documents")

    new_doc_id = generate_uuid()
    merged_pdf = pikepdf.Pdf.new()
    # Source PDFs must stay open until merged_pdf.save() completes.
    source_pdfs: list[pikepdf.Pdf] = []
    total_page_count = 0

    total_items = len(document_configs)

    try:
        for idx, config in enumerate(document_configs):
            doc_id = config["document_id"]
            page_ranges = config.get("page_ranges")

            # Update progress
            progress = ((idx + 1) / total_items) * 100
            self.update_state(
                state="PROGRESS",
                meta={"progress": progress, "message": f"Merging document {idx + 1}"},
            )

            session = asyncio.run(document_sessions.get_session(doc_id))
            if not session:
                logger.warning(f"Document not found, skipping: {doc_id}")
                continue

            src_bytes = session.pdf_doc.tobytes()
            src = pikepdf.Pdf.open(_io.BytesIO(src_bytes))
            source_pdfs.append(src)
            src_page_count = len(src.pages)

            # Determine pages to include (1-indexed → 0-indexed slice)
            if page_ranges:
                pages_1idx = parse_page_range(page_ranges, src_page_count)
                for p in pages_1idx:
                    merged_pdf.pages.append(src.pages[p - 1])
                    total_page_count += 1
            else:
                merged_pdf.pages.extend(src.pages)
                total_page_count += src_page_count

        # Serialise merged result
        buf = _io.BytesIO()
        merged_pdf.save(buf)
        merged_bytes = buf.getvalue()
    finally:
        for src in source_pdfs:
            src.close()
        merged_pdf.close()

    # Register with engine and build proxy
    pdf_engine._documents[new_doc_id] = merged_bytes
    proxy = LegacyDocumentProxy(new_doc_id, merged_bytes, total_page_count, False)

    # Parse merged document
    parser = PDFParser(new_doc_id)
    scene_graph = parser.parse_document(proxy)

    # Create session for new document and persist to Redis
    asyncio.run(document_sessions.create_session(
        document_id=new_doc_id,
        pdf_doc=proxy,
        scene_graph=scene_graph,
        filename=output_name or "merged.pdf",
    ))

    result = {
        "document_id": new_doc_id,
        "page_count": total_page_count,
        "source_documents": len(document_configs),
    }

    logger.info(f"Merge completed: {result}")
    return result


@celery_app.task(bind=True, name="app.tasks.processing_tasks.split_document")
def split_document(
    self,
    document_id: str,
    split_method: str,
    pages_per_document: Optional[int] = None,
    bookmark_level: Optional[int] = None,
) -> dict:
    """
    Split a document into multiple parts.

    Args:
        self: Celery task instance.
        document_id: Source document ID.
        split_method: "by_pages" or "by_bookmarks".
        pages_per_document: Pages per split (for by_pages).
        bookmark_level: Bookmark level to split at (for by_bookmarks).

    Returns:
        dict: Split result with new document IDs.
    """
    import io as _io
    import pikepdf
    from app.core.parser import PDFParser
    from app.core.pdf_engine import LegacyDocumentProxy, pdf_engine
    from app.repositories.document_repo import document_sessions
    from app.utils.helpers import generate_uuid

    logger.info(f"Starting split of document {document_id}")

    session = asyncio.run(document_sessions.get_session(document_id))
    if not session:
        raise ValueError(f"Document session not found: {document_id}")

    source_doc = session.pdf_doc
    page_count = source_doc.page_count
    src_bytes = source_doc.tobytes()

    # Determine split points (0-indexed page boundaries)
    split_points: list[int] = []

    if split_method == "by_pages" and pages_per_document:
        split_points = list(range(0, page_count, pages_per_document))
        if split_points[-1] != page_count:
            split_points.append(page_count)

    elif split_method == "by_bookmarks" and bookmark_level:
        # pdfplumber does not expose TOC directly; use pikepdf to read outlines.
        try:
            with pikepdf.Pdf.open(_io.BytesIO(src_bytes)) as pdf:
                root = pdf.Root
                outlines = root.get("/Outlines")
                if outlines:
                    # Walk top-level outlines only (level 1)
                    current = outlines.get("/First")
                    while current:
                        dest = current.get("/Dest") or current.get("/A", {}).get("/D")
                        if dest:
                            try:
                                page_ref = dest[0]
                                page_num = pdf.pages.index(page_ref)
                                if page_num not in split_points:
                                    split_points.append(page_num)
                            except Exception:
                                pass
                        current = current.get("/Next")
        except Exception as exc:
            logger.warning("Could not read bookmarks via pikepdf: %s", exc)

        split_points.sort()
        if 0 not in split_points:
            split_points.insert(0, 0)
        if page_count not in split_points:
            split_points.append(page_count)

    if not split_points or len(split_points) < 2:
        # Default: split every 10 pages
        split_points = list(range(0, page_count, 10))
        if split_points[-1] != page_count:
            split_points.append(page_count)

    # Create split documents via pikepdf
    new_documents = []
    total_splits = len(split_points) - 1

    for idx in range(total_splits):
        start_page = split_points[idx]   # 0-indexed inclusive
        end_page = split_points[idx + 1]  # 0-indexed exclusive

        # Update progress
        progress = ((idx + 1) / total_splits) * 100
        self.update_state(
            state="PROGRESS",
            meta={"progress": progress, "message": f"Creating part {idx + 1}"},
        )

        # Extract page slice
        src = pikepdf.Pdf.open(_io.BytesIO(src_bytes))
        try:
            new_pdf = pikepdf.Pdf.new()
            new_pdf.pages.extend(src.pages[start_page:end_page])
            buf = _io.BytesIO()
            new_pdf.save(buf)
            part_bytes = buf.getvalue()
        finally:
            new_pdf.close()
            src.close()

        part_page_count = end_page - start_page
        new_doc_id = generate_uuid()
        pdf_engine._documents[new_doc_id] = part_bytes
        proxy = LegacyDocumentProxy(new_doc_id, part_bytes, part_page_count, False)

        # Parse
        parser = PDFParser(new_doc_id)
        scene_graph = parser.parse_document(proxy)

        # Create session and persist to Redis
        asyncio.run(document_sessions.create_session(
            document_id=new_doc_id,
            pdf_doc=proxy,
            scene_graph=scene_graph,
            filename=f"split_part_{idx + 1}.pdf",
        ))

        new_documents.append({
            "document_id": new_doc_id,
            "page_range": f"{start_page + 1}-{end_page}",
            "page_count": part_page_count,
        })

    result = {
        "source_document_id": document_id,
        "split_method": split_method,
        "documents": new_documents,
    }

    logger.info(f"Split completed: {len(new_documents)} documents created")
    return result
