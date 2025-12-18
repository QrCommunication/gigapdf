"""
Export Celery tasks.

Async tasks for document export to various formats.
"""

import io
import logging
import zipfile
from typing import Optional

from celery import shared_task

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.export_tasks.export_document")
def export_document(
    self,
    document_id: str,
    format: str,
    page_range: Optional[str] = None,
    dpi: int = 150,
    quality: int = 85,
    single_file: bool = False,
) -> dict:
    """
    Export document to various formats.

    Args:
        self: Celery task instance.
        document_id: Document identifier.
        format: Output format (png, jpeg, svg, docx, xlsx, html, txt).
        page_range: Pages to export (all if None).
        dpi: Resolution for image formats.
        quality: Quality for JPEG/WebP.
        single_file: Combine into single file/archive.

    Returns:
        dict: Export result with file path or data.
    """
    from app.core.preview import PreviewGenerator
    from app.repositories.document_repo import document_sessions
    from app.utils.helpers import parse_page_range

    logger.info(f"Starting export for document {document_id} to {format}")

    session = document_sessions.get_session(document_id)
    if not session:
        raise ValueError(f"Document session not found: {document_id}")

    doc = session.pdf_doc
    page_count = doc.page_count

    # Parse page range
    if page_range:
        pages = parse_page_range(page_range, page_count)
    else:
        pages = list(range(1, page_count + 1))

    total_pages = len(pages)
    exported_files = []

    # Image formats
    if format in ("png", "jpeg", "webp", "svg"):
        generator = PreviewGenerator(doc)

        for idx, page_num in enumerate(pages):
            # Update progress
            progress = ((idx + 1) / total_pages) * 100
            self.update_state(
                state="PROGRESS",
                meta={"progress": progress, "message": f"Exporting page {page_num}"},
            )

            # Render page
            image_data = generator.render_page(
                page_number=page_num,
                dpi=dpi,
                format=format,
                quality=quality,
            )

            exported_files.append({
                "page": page_num,
                "format": format,
                "size": len(image_data),
                "data": image_data,
            })

        # Create ZIP if multiple files
        if single_file and len(exported_files) > 1:
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for file in exported_files:
                    filename = f"page_{file['page']:04d}.{format}"
                    zf.writestr(filename, file["data"])

            return {
                "document_id": document_id,
                "format": "zip",
                "pages": len(exported_files),
                "data": zip_buffer.getvalue(),
            }

    # Text format
    elif format == "txt":
        text_parts = []

        for idx, page_num in enumerate(pages):
            progress = ((idx + 1) / total_pages) * 100
            self.update_state(
                state="PROGRESS",
                meta={"progress": progress, "message": f"Extracting text from page {page_num}"},
            )

            page = doc[page_num - 1]
            text = page.get_text("text")
            text_parts.append(f"--- Page {page_num} ---\n{text}\n")

        return {
            "document_id": document_id,
            "format": "txt",
            "pages": len(pages),
            "data": "\n".join(text_parts).encode("utf-8"),
        }

    # HTML format
    elif format == "html":
        html_parts = ['<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>']

        for idx, page_num in enumerate(pages):
            progress = ((idx + 1) / total_pages) * 100
            self.update_state(
                state="PROGRESS",
                meta={"progress": progress, "message": f"Converting page {page_num}"},
            )

            page = doc[page_num - 1]
            text = page.get_text("html")
            html_parts.append(f'<div class="page" data-page="{page_num}">{text}</div>')

        html_parts.append("</body>\n</html>")

        return {
            "document_id": document_id,
            "format": "html",
            "pages": len(pages),
            "data": "\n".join(html_parts).encode("utf-8"),
        }

    # Word (DOCX) format
    elif format == "docx":
        from docx import Document as DocxDocument
        from docx.shared import Inches, Pt
        from docx.enum.text import WD_ALIGN_PARAGRAPH

        docx_doc = DocxDocument()

        for idx, page_num in enumerate(pages):
            progress = ((idx + 1) / total_pages) * 100
            self.update_state(
                state="PROGRESS",
                meta={"progress": progress, "message": f"Converting page {page_num} to Word"},
            )

            page = doc[page_num - 1]

            # Add page header
            if idx > 0:
                docx_doc.add_page_break()

            # Extract text blocks with their positions
            blocks = page.get_text("dict")["blocks"]

            for block in blocks:
                if "lines" in block:
                    # Text block
                    for line in block["lines"]:
                        para_text = ""
                        for span in line["spans"]:
                            para_text += span["text"]

                        if para_text.strip():
                            para = docx_doc.add_paragraph(para_text)
                            # Try to preserve some formatting
                            if line["spans"]:
                                font_size = line["spans"][0].get("size", 12)
                                for run in para.runs:
                                    run.font.size = Pt(font_size)

                elif "image" in block:
                    # Image block - extract and embed
                    try:
                        img_rect = block["bbox"]
                        # Get image from page
                        pix = page.get_pixmap(clip=img_rect, dpi=150)
                        img_data = pix.tobytes("png")

                        # Save to temp stream and add to doc
                        img_stream = io.BytesIO(img_data)
                        width = Inches(min(6.0, (img_rect[2] - img_rect[0]) / 72.0))
                        docx_doc.add_picture(img_stream, width=width)
                    except Exception as e:
                        logger.warning(f"Could not extract image: {e}")

        # Save to bytes
        docx_buffer = io.BytesIO()
        docx_doc.save(docx_buffer)
        docx_buffer.seek(0)

        return {
            "document_id": document_id,
            "format": "docx",
            "pages": len(pages),
            "data": docx_buffer.getvalue(),
        }

    # Excel (XLSX) format
    elif format == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment

        wb = Workbook()
        ws = wb.active
        ws.title = "PDF Content"

        current_row = 1

        for idx, page_num in enumerate(pages):
            progress = ((idx + 1) / total_pages) * 100
            self.update_state(
                state="PROGRESS",
                meta={"progress": progress, "message": f"Converting page {page_num} to Excel"},
            )

            page = doc[page_num - 1]

            # Add page header
            ws.cell(row=current_row, column=1, value=f"--- Page {page_num} ---")
            ws.cell(row=current_row, column=1).font = Font(bold=True, size=14)
            current_row += 2

            # Extract text with layout preserved
            text = page.get_text("text")
            lines = text.split("\n")

            for line in lines:
                if line.strip():
                    ws.cell(row=current_row, column=1, value=line)
                    current_row += 1

            current_row += 2  # Space between pages

            # Try to extract tables
            try:
                tables = page.find_tables()
                for table in tables:
                    # Add table header
                    ws.cell(row=current_row, column=1, value="[Table]")
                    ws.cell(row=current_row, column=1).font = Font(italic=True)
                    current_row += 1

                    # Extract table data
                    table_data = table.extract()
                    for row_data in table_data:
                        for col_idx, cell_value in enumerate(row_data):
                            ws.cell(row=current_row, column=col_idx + 1, value=cell_value or "")
                        current_row += 1

                    current_row += 1  # Space after table
            except Exception as e:
                logger.debug(f"No tables found or error extracting: {e}")

        # Auto-fit column width
        for column in ws.columns:
            max_length = 0
            column_letter = column[0].column_letter
            for cell in column:
                try:
                    if cell.value:
                        max_length = max(max_length, len(str(cell.value)))
                except:
                    pass
            adjusted_width = min(max_length + 2, 100)
            ws.column_dimensions[column_letter].width = adjusted_width

        # Save to bytes
        xlsx_buffer = io.BytesIO()
        wb.save(xlsx_buffer)
        xlsx_buffer.seek(0)

        return {
            "document_id": document_id,
            "format": "xlsx",
            "pages": len(pages),
            "data": xlsx_buffer.getvalue(),
        }

    else:
        raise ValueError(f"Unsupported export format: {format}")

    return {
        "document_id": document_id,
        "format": format,
        "pages": len(exported_files),
        "files": [{"page": f["page"], "size": f["size"]} for f in exported_files],
    }
