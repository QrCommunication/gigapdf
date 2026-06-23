/**
 * PDF Apply Model Ops route
 *
 * POST /api/pdf/apply-model-ops
 * Bakes native paragraph-style and/or list-level formatting edits into a PDF
 * and returns the modified binary. Edits are keyed by the editor's flat engine
 * run index (`source_index` === `TextElement.index`); the engine resolves each
 * to a positional block address `[section, page, index]`, applies the matching
 * `setParagraphStyle` / `setList*` model op, and re-renders the unified model
 * back to PDF (`toModel → applyModelOps → modelToPdf`).
 *
 * This is the structural ("fat-library") bake path: paragraph alignment,
 * indents, spacing, line-height and list level/marker/ordered persist in the
 * document model itself, so reloading the returned bytes shows the change.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   paragraphs — JSON string of ParagraphStyleEdit[] (optional)
 *   lists      — JSON string of ListEdit[] (optional)
 *   tableOps   — JSON string of TableEdit[] (optional)
 *
 * ParagraphStyleEdit:
 *   { sourceIndex: number, patch: { align?, indent_left?, indent_right?,
 *     first_line?, space_before?, space_after?, line_height? } }
 *
 * ListEdit (one of):
 *   { sourceIndex: number, kind: 'level',   level: number }
 *   { sourceIndex: number, kind: 'marker',  marker: GigaListMarker }
 *   { sourceIndex: number, kind: 'ordered', ordered: boolean }
 *
 * TableEdit (one of) — addressed POSITIONALLY by (pageNumber, tableIndexOnPage),
 * NOT by a flat run index (table cell runs carry no `source_index`):
 *   { pageNumber, tableIndexOnPage, kind: 'insertRow'|'deleteRow'|
 *     'insertColumn'|'deleteColumn', at: number }
 *   { pageNumber, tableIndexOnPage, kind: 'setCellSpan', row, col, colSpan, rowSpan }
 *
 * At least one of `paragraphs` / `lists` / `tableOps` must contain an edit.
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { applyParagraphOps, applyTableOps } from '@giga-pdf/pdf-engine';
import type {
  ParagraphStyleEdit,
  ListEdit,
  TableEdit,
} from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify']);
const LIST_KINDS = new Set(['level', 'marker', 'ordered']);
const TABLE_AT_KINDS = new Set([
  'insertRow',
  'deleteRow',
  'insertColumn',
  'deleteColumn',
]);

/** Parse an optional JSON-array form field; returns `[]` when absent. */
function parseJsonArray(raw: string | null, fieldName: string): unknown[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON array.`);
  }
  return parsed;
}

/** A non-negative integer is a valid engine run index (`source_index`). */
function isValidSourceIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** A non-negative integer grid coordinate / count (table `at`/`row`/`col`/span). */
function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** A positive integer (1-based `pageNumber`, span ≥ 1). */
function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Validate + narrow the raw `tableOps` edits. Tables are addressed positionally:
 * a 1-based `pageNumber` + 0-based `tableIndexOnPage`. `insert*`/`delete*` carry a
 * 0-based grid `at`; `setCellSpan` carries `row`/`col` (0-based) + `colSpan`/
 * `rowSpan` (≥ 1). A malformed payload is an explicit 400 (never a silent no-op).
 */
function parseTableEdits(raw: unknown[]): TableEdit[] {
  return raw.map((entry, i) => {
    const e = entry as {
      pageNumber?: unknown;
      tableIndexOnPage?: unknown;
      kind?: unknown;
    };
    if (!isPositiveInt(e.pageNumber)) {
      throw new Error(`tableOps[${i}].pageNumber must be a positive integer.`);
    }
    if (!isNonNegativeInt(e.tableIndexOnPage)) {
      throw new Error(
        `tableOps[${i}].tableIndexOnPage must be a non-negative integer.`,
      );
    }
    if (typeof e.kind !== 'string') {
      throw new Error(`tableOps[${i}].kind must be a string.`);
    }
    if (TABLE_AT_KINDS.has(e.kind)) {
      const at = (e as { at?: unknown }).at;
      if (!isNonNegativeInt(at)) {
        throw new Error(`tableOps[${i}].at must be a non-negative integer.`);
      }
      return e as unknown as TableEdit;
    }
    if (e.kind === 'setCellSpan') {
      const span = e as {
        row?: unknown;
        col?: unknown;
        colSpan?: unknown;
        rowSpan?: unknown;
      };
      if (!isNonNegativeInt(span.row) || !isNonNegativeInt(span.col)) {
        throw new Error(
          `tableOps[${i}].row and .col must be non-negative integers.`,
        );
      }
      if (!isPositiveInt(span.colSpan) || !isPositiveInt(span.rowSpan)) {
        throw new Error(
          `tableOps[${i}].colSpan and .rowSpan must be positive integers.`,
        );
      }
      return e as unknown as TableEdit;
    }
    throw new Error(
      `tableOps[${i}].kind must be one of insertRow|deleteRow|insertColumn|deleteColumn|setCellSpan.`,
    );
  });
}

/**
 * Validate + narrow the raw `paragraphs` edits. Rejects (400) a non-numeric or
 * negative `sourceIndex` and an unknown `align` value so a malformed payload is
 * an explicit error instead of a silent no-op (`NaN` would never resolve).
 */
function parseParagraphEdits(raw: unknown[]): ParagraphStyleEdit[] {
  return raw.map((entry, i) => {
    const e = entry as { sourceIndex?: unknown; patch?: unknown };
    if (!isValidSourceIndex(e.sourceIndex)) {
      throw new Error(
        `paragraphs[${i}].sourceIndex must be a non-negative integer.`,
      );
    }
    if (!e.patch || typeof e.patch !== 'object') {
      throw new Error(`paragraphs[${i}].patch must be an object.`);
    }
    const align = (e.patch as { align?: unknown }).align;
    if (align !== undefined && (typeof align !== 'string' || !ALIGN_VALUES.has(align))) {
      throw new Error(
        `paragraphs[${i}].patch.align must be one of left|center|right|justify.`,
      );
    }
    return e as unknown as ParagraphStyleEdit;
  });
}

/** Validate + narrow the raw `lists` edits (`sourceIndex` + known `kind`). */
function parseListEdits(raw: unknown[]): ListEdit[] {
  return raw.map((entry, i) => {
    const e = entry as { sourceIndex?: unknown; kind?: unknown };
    if (!isValidSourceIndex(e.sourceIndex)) {
      throw new Error(`lists[${i}].sourceIndex must be a non-negative integer.`);
    }
    if (typeof e.kind !== 'string' || !LIST_KINDS.has(e.kind)) {
      throw new Error(`lists[${i}].kind must be one of level|marker|ordered.`);
    }
    return e as unknown as ListEdit;
  });
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    let paragraphs: ParagraphStyleEdit[];
    let lists: ListEdit[];
    let tableOps: TableEdit[];
    try {
      paragraphs = parseParagraphEdits(
        parseJsonArray(formData.get('paragraphs') as string | null, 'paragraphs'),
      );
      lists = parseListEdits(
        parseJsonArray(formData.get('lists') as string | null, 'lists'),
      );
      tableOps = parseTableEdits(
        parseJsonArray(formData.get('tableOps') as string | null, 'tableOps'),
      );
    } catch (parseErr) {
      return NextResponse.json(
        {
          success: false,
          error: parseErr instanceof Error ? parseErr.message : 'Invalid edits.',
        },
        { status: 400 },
      );
    }

    if (paragraphs.length === 0 && lists.length === 0 && tableOps.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'At least one of `paragraphs`, `lists` or `tableOps` must contain an edit.',
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // Paragraph/list ops and table ops are independent structural passes. Run the
    // paragraph/list bake first (when requested), then the table bake on its
    // output, so a single request can carry both. Each bake re-renders the model
    // to PDF; chaining is a no-op when a pass has no edits.
    let bytes: Uint8Array = new Uint8Array(arrayBuffer);
    let resolved = 0;
    let unresolved = 0;

    if (paragraphs.length > 0 || lists.length > 0) {
      const paraResult = await applyParagraphOps(inputBuffer, {
        paragraphs,
        lists,
      });
      bytes = paraResult.bytes;
      resolved += paraResult.resolved;
      unresolved += paraResult.unresolved.length;
    }

    if (tableOps.length > 0) {
      const tableResult = await applyTableOps(Buffer.from(bytes), tableOps);
      bytes = tableResult.bytes;
      resolved += tableResult.resolved;
      unresolved += tableResult.unresolved.length;
    }

    if (unresolved > 0) {
      serverLogger.warn('api.pdf.apply-model-ops: some edits did not resolve', {
        resolved,
        unresolved,
      });
    }

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(bytes.byteLength),
        // Surface how many edits actually baked so the client can fall back to
        // the flat redact+add path for unresolved paragraphs if it chooses to.
        'X-Model-Ops-Resolved': String(resolved),
        'X-Model-Ops-Unresolved': String(unresolved),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFPageOutOfRangeError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.apply-model-ops', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to apply model operations.' },
      { status: 500 },
    );
  }
}
