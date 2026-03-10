"""
OCR Celery tasks.

Async tasks for OCR processing of scanned PDF pages.
"""

import logging
from typing import Optional

from celery import shared_task

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.ocr_tasks.process_ocr")
def process_ocr(
    self,
    document_id: str,
    page_numbers: Optional[list[int]] = None,
    languages: str = "eng+fra",
    confidence_threshold: float = 60.0,
    output_type: str = "overlay",
) -> dict:
    """
    Process OCR on document pages.

    Args:
        self: Celery task instance.
        document_id: Document identifier.
        page_numbers: Pages to process (all if None).
        languages: Tesseract language codes.
        confidence_threshold: Minimum confidence threshold.
        output_type: "overlay" (add invisible layer) or "replace".

    Returns:
        dict: OCR results with element counts per page.
    """
    from app.core.ocr import ocr_processor
    from app.repositories.document_repo import document_sessions

    logger.info(f"Starting OCR for document {document_id}")

    session = document_sessions.get_session(document_id)
    if not session:
        raise ValueError(f"Document session not found: {document_id}")

    def progress_callback(progress: float, message: str):
        """Update task progress."""
        self.update_state(
            state="PROGRESS",
            meta={"progress": progress, "message": message},
        )

    # Run OCR
    results = ocr_processor.process_document(
        doc=session.pdf_doc,
        page_numbers=page_numbers,
        languages=languages,
        confidence_threshold=confidence_threshold,
        progress_callback=progress_callback,
    )

    # Add OCR layer or replace content
    for page_num, elements in results.items():
        if output_type == "overlay":
            ocr_processor.add_ocr_layer(session.pdf_doc, page_num, elements)
        else:
            # Add elements to scene graph
            session.scene_graph.pages[page_num - 1].elements.extend(elements)

    # Build result summary
    summary = {
        "document_id": document_id,
        "pages_processed": len(results),
        "elements_by_page": {
            str(page_num): len(elements)
            for page_num, elements in results.items()
        },
        "total_elements": sum(len(e) for e in results.values()),
    }

    logger.info(f"OCR completed for document {document_id}: {summary['total_elements']} elements")
    return summary
