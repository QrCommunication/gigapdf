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
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { applyParagraphOps } from '@giga-pdf/pdf-engine';
import type { ParagraphStyleEdit, ListEdit } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify']);
const LIST_KINDS = new Set(['level', 'marker', 'ordered']);

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
    try {
      paragraphs = parseParagraphEdits(
        parseJsonArray(formData.get('paragraphs') as string | null, 'paragraphs'),
      );
      lists = parseListEdits(
        parseJsonArray(formData.get('lists') as string | null, 'lists'),
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

    if (paragraphs.length === 0 && lists.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'At least one of `paragraphs` or `lists` must contain an edit.',
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    const result = await applyParagraphOps(inputBuffer, { paragraphs, lists });

    if (result.unresolved.length > 0) {
      serverLogger.warn('api.pdf.apply-model-ops: some edits did not resolve', {
        resolved: result.resolved,
        unresolved: result.unresolved.length,
      });
    }

    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(result.bytes.byteLength),
        // Surface how many edits actually baked so the client can fall back to
        // the flat redact+add path for unresolved paragraphs if it chooses to.
        'X-Model-Ops-Resolved': String(result.resolved),
        'X-Model-Ops-Unresolved': String(result.unresolved.length),
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
