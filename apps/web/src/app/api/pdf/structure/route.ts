/**
 * PDF Structure (chapter detection & bake) route
 *
 * POST /api/pdf/structure
 * Recover a navigable chapter/section hierarchy from a PDF that carries no
 * embedded outline, and optionally bake the (detected or user-edited) chapters
 * into real `/Outlines` bookmarks.
 *
 * Form fields (multipart/form-data):
 *   file    — PDF file (required)
 *   action  — "detect" | "bake"
 *
 *   detect  — no extra fields. Walks every page's structural reconstruction
 *             ({@link GigaPdfDoc.pageBlocks}) and distils its heading blocks into
 *             a flat chapter list. Returns JSON
 *             `{ success, data: { chapters: { title, level, page }[], pageCount } }`
 *             where `level` is a 0-based nesting depth and `page` is 1-based.
 *
 *   bake    — chapters: JSON array of `{ title, level (>=0), page (1..pageCount) }`.
 *             Each becomes a GoTo bookmark (a `page` → a `/XYZ` destination);
 *             deeper consecutive `level`s nest as children. An empty array clears
 *             the outline. Returns the modified PDF as application/pdf binary.
 *
 * Error codes:
 *   400  — missing/invalid file, unknown action, malformed chapters payload
 *   401  — unauthenticated
 *   422  — PDF corrupted, or the engine rejected the bookmark write
 *   500  — unexpected server error
 */

import { NextResponse } from 'next/server';
import { openDocument, saveDocument, PDFCorruptedError } from '@giga-pdf/pdf-engine';
import type { Bookmark } from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';
import { extractChaptersFromPages, type PageBlocks } from './extract-chapters';

// A document with thousands of chapters is pathological; cap both the detected
// output and an inbound bake payload so a malicious request cannot exhaust the
// engine (mirrors the `links` route's MAX_BOOKMARKS).
const MAX_CHAPTERS = 5000;
const MAX_LEVEL = 32;

type ParseError = { error: string };
const isError = (v: unknown): v is ParseError =>
  typeof v === 'object' && v !== null && 'error' in v;

/** Validate an untrusted value as an integer within `[min, max]`. */
function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Parse + validate the `chapters` JSON into a {@link Bookmark}[]. Each entry is
 * `{ title, level (0..MAX_LEVEL), page (1..pageCount) }`; the `page` becomes a
 * GoTo `/XYZ` destination. An empty array is valid (clears the outline).
 */
function parseChapters(rawJson: string, pageCount: number): Bookmark[] | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { error: 'chapters must be valid JSON.' };
  }
  if (!Array.isArray(parsed)) {
    return { error: 'chapters must be a JSON array.' };
  }
  if (parsed.length > MAX_CHAPTERS) {
    return { error: `chapters must contain at most ${MAX_CHAPTERS} entries.` };
  }

  const bookmarks: Bookmark[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i] as unknown;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: `chapters[${i}] must be an object.` };
    }
    const src = entry as Record<string, unknown>;

    if (typeof src.title !== 'string' || src.title.trim().length === 0) {
      return { error: `chapters[${i}].title must be a non-empty string.` };
    }
    if (!isIntInRange(src.level, 0, MAX_LEVEL)) {
      return {
        error: `chapters[${i}].level must be an integer between 0 and ${MAX_LEVEL}.`,
      };
    }
    if (!isIntInRange(src.page, 1, pageCount)) {
      return {
        error: `chapters[${i}].page must be an integer between 1 and ${pageCount}.`,
      };
    }

    bookmarks.push({
      title: src.title,
      level: src.level,
      action: { type: 'goto', dest: { fit: 'xyz', page: src.page } },
    });
  }

  return bookmarks;
}

/** Build the PDF binary response shared by the mutating `bake` action. */
function pdfResponse(savedBytes: Uint8Array, fileName: string): Response {
  return new Response(Buffer.from(savedBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': sanitizeContentDisposition(fileName),
      'Content-Length': String(savedBytes.byteLength),
    },
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

    const action = formData.get('action') as string | null;
    if (action !== 'detect' && action !== 'bake') {
      return NextResponse.json(
        { success: false, error: 'action must be one of: detect, bake.' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);
    const doc = handle._doc;
    const pageCount = doc.pageCount();

    // ── detect ─────────────────────────────────────────────────────────────
    if (action === 'detect') {
      const pages: PageBlocks[] = [];
      for (let page = 1; page <= pageCount; page++) {
        pages.push({ page, blocks: doc.pageBlocks(page) });
      }
      const chapters = extractChaptersFromPages(pages, { maxChapters: MAX_CHAPTERS });
      return NextResponse.json({
        success: true,
        data: { chapters, pageCount },
      });
    }

    // ── bake ───────────────────────────────────────────────────────────────
    const chaptersRaw = formData.get('chapters') as string | null;
    if (chaptersRaw === null) {
      return NextResponse.json(
        { success: false, error: 'chapters is required for bake.' },
        { status: 400 },
      );
    }
    const bookmarks = parseChapters(chaptersRaw, pageCount);
    if (isError(bookmarks)) {
      return NextResponse.json({ success: false, error: bookmarks.error }, { status: 400 });
    }

    const ok = doc.setBookmarks(bookmarks);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: 'Could not bake the chapters into bookmarks.' },
        { status: 422 },
      );
    }
    const savedBytes = await saveDocument(handle);
    return pdfResponse(savedBytes, file.name);
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.structure', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to process structure operation.' },
      { status: 500 },
    );
  }
}
