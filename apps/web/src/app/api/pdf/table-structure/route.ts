/**
 * PDF Table Structure route — enumerate the document's tables for the editor.
 *
 * POST /api/pdf/table-structure
 *
 * Tables are reconstructed by the engine into the unified model and surfaced
 * here with a POSITIONAL handle — `(pageNumber, tableIndexOnPage)` — plus the
 * grid size and (when the engine carried one) the placement frame in PDF
 * user-space (origin bottom-left). The editor uses `frame` to draw a selectable
 * overlay over each table and the handle to address an add/remove row/column
 * edit (which `/api/pdf/apply-model-ops` resolves back to the table's block
 * address). Tables are addressed positionally — not by `source_index` — because
 * table cell runs carry no `source_index`.
 *
 * Form fields (multipart/form-data):
 *   file — PDF file (required)
 *
 * Returns JSON:
 *   { success: true, tables: [{ pageNumber, tableIndexOnPage, rowCount,
 *     colCount, frame: { x, y, w, h } | null,
 *     cells: [{ row, col, colSpan, rowSpan, sourceIndices }] }, ...] }
 *
 * `cells[].sourceIndices` lets the editor map a clicked `TextElement.index` to a
 * specific cell `(row, col)` — enabling cell selection and precise row/column
 * insertion. The block `addr` is intentionally NOT returned — the client never
 * needs it (it addresses by the positional handle); the server re-resolves it at
 * bake time from the same enumeration, keeping the address authoritative.
 */

import { NextResponse } from 'next/server';
import { listPdfTables } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const arrayBuffer = await file.arrayBuffer();
    const tables = await listPdfTables(Buffer.from(arrayBuffer));

    // Strip the internal block `addr` from the response — the client addresses by
    // the positional handle, never the raw [section, page, index] coordinates.
    // Cells (grid position + spans + run indices) are forwarded for cell-level
    // selection + precise insertion.
    const payload = tables.map((t) => ({
      pageNumber: t.pageNumber,
      tableIndexOnPage: t.tableIndexOnPage,
      rowCount: t.rowCount,
      colCount: t.colCount,
      frame: t.frame,
      cells: t.cells,
    }));

    return NextResponse.json({ success: true, tables: payload });
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }
    serverLogger.error('api.pdf.table-structure', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to read table structure.' },
      { status: 500 },
    );
  }
}
