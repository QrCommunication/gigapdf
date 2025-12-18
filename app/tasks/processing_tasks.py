"""
Document processing Celery tasks.

Async tasks for merge, split, and other document operations.
"""

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
    import fitz

    from app.core.parser import PDFParser
    from app.repositories.document_repo import document_sessions
    from app.utils.helpers import generate_uuid, parse_page_range

    logger.info(f"Starting merge of {len(document_configs)} documents")

    # Create new document
    new_doc = fitz.open()
    new_doc_id = generate_uuid()

    total_items = len(document_configs)

    for idx, config in enumerate(document_configs):
        doc_id = config["document_id"]
        page_ranges = config.get("page_ranges")

        # Update progress
        progress = ((idx + 1) / total_items) * 100
        self.update_state(
            state="PROGRESS",
            meta={"progress": progress, "message": f"Merging document {idx + 1}"},
        )

        session = document_sessions.get_session(doc_id)
        if not session:
            logger.warning(f"Document not found, skipping: {doc_id}")
            continue

        source_doc = session.pdf_doc

        # Determine pages to include
        if page_ranges:
            pages = parse_page_range(page_ranges, source_doc.page_count)
            # Convert to 0-indexed
            pages = [p - 1 for p in pages]
        else:
            pages = list(range(source_doc.page_count))

        # Insert pages
        new_doc.insert_pdf(source_doc, from_page=min(pages), to_page=max(pages))

    # Parse merged document
    parser = PDFParser(new_doc_id)
    scene_graph = parser.parse_document(new_doc)

    # Create session for new document
    document_sessions.create_session(
        document_id=new_doc_id,
        pdf_doc=new_doc,
        scene_graph=scene_graph,
        filename=output_name or "merged.pdf",
    )

    result = {
        "document_id": new_doc_id,
        "page_count": new_doc.page_count,
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
    import fitz

    from app.core.parser import PDFParser
    from app.repositories.document_repo import document_sessions
    from app.utils.helpers import generate_uuid

    logger.info(f"Starting split of document {document_id}")

    session = document_sessions.get_session(document_id)
    if not session:
        raise ValueError(f"Document session not found: {document_id}")

    source_doc = session.pdf_doc
    page_count = source_doc.page_count

    # Determine split points
    split_points = []

    if split_method == "by_pages" and pages_per_document:
        split_points = list(range(0, page_count, pages_per_document))
        if split_points[-1] != page_count:
            split_points.append(page_count)

    elif split_method == "by_bookmarks" and bookmark_level:
        toc = source_doc.get_toc()
        for item in toc:
            if item[0] <= bookmark_level:
                page_num = item[2] - 1  # Convert to 0-indexed
                if page_num not in split_points:
                    split_points.append(page_num)
        split_points.sort()
        if 0 not in split_points:
            split_points.insert(0, 0)
        if page_count not in split_points:
            split_points.append(page_count)

    else:
        # Default: split every 10 pages
        split_points = list(range(0, page_count, 10))
        if split_points[-1] != page_count:
            split_points.append(page_count)

    # Create split documents
    new_documents = []
    total_splits = len(split_points) - 1

    for idx in range(total_splits):
        start_page = split_points[idx]
        end_page = split_points[idx + 1]

        # Update progress
        progress = ((idx + 1) / total_splits) * 100
        self.update_state(
            state="PROGRESS",
            meta={"progress": progress, "message": f"Creating part {idx + 1}"},
        )

        # Create new document
        new_doc = fitz.open()
        new_doc.insert_pdf(source_doc, from_page=start_page, to_page=end_page - 1)

        new_doc_id = generate_uuid()

        # Parse
        parser = PDFParser(new_doc_id)
        scene_graph = parser.parse_document(new_doc)

        # Create session
        document_sessions.create_session(
            document_id=new_doc_id,
            pdf_doc=new_doc,
            scene_graph=scene_graph,
            filename=f"split_part_{idx + 1}.pdf",
        )

        new_documents.append({
            "document_id": new_doc_id,
            "page_range": f"{start_page + 1}-{end_page}",
            "page_count": end_page - start_page,
        })

    result = {
        "source_document_id": document_id,
        "split_method": split_method,
        "documents": new_documents,
    }

    logger.info(f"Split completed: {len(new_documents)} documents created")
    return result
