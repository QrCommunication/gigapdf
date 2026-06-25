/**
 * PDF Page Labels route
 *
 * POST /api/pdf/page-labels
 * Get or set the document's page-label ranges (`/PageLabels`, ISO 32000-1
 * §12.4.2): per-range numbering style (decimal / lower- & upper-roman /
 * lower- & upper-alpha / none), a prefix, and a starting number. From a range's
 * `startPage` onward (until the next range, or the end of the document) pages
 * are labelled `<prefix><style-formatted number>` counting up from
 * `startNumber` — e.g. front matter "i, ii, iii…", body "1, 2, 3…", appendix
 * "A-1, A-2…".
 *
 * Form fields (multipart/form-data):
 *   file    — PDF file (required)
 *   action  — "get" | "set" (required)
 *   ranges  — JSON PageLabelRange[] — set only, required for "set".
 *             An empty array removes every page label.
 *
 * Range schema (PageLabelRange from @qrcommunication/gigapdf-lib):
 * {
 *   startPage: number,     // 1-based page where the range begins (1..pageCount)
 *   style: PageLabelStyle,  // decimal | romanLower | romanUpper
 *                           // | alphaLower | alphaUpper | none
 *   prefix?: string,        // prepended to every page in the range (default "")
 *   startNumber?: number    // value of the range's first page (>= 1, default 1)
 * }
 *
 * "get" — returns JSON `{ success, data: { ranges, labels, pageCount } }` where
 *         `ranges` is the current PageLabelRange[] (sorted by startPage),
 *         `labels` is the resolved viewer label for each 1-based page, and
 *         `pageCount` is the document page count.
 * "set" — applies the supplied ranges (the engine sorts them and collapses to
 *         one entry per page, last wins) and returns the modified PDF as
 *         application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { openDocument, saveDocument } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
import type { PageLabelRange, PageLabelStyle } from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

// Numbering styles accepted by the engine (ISO 32000-1 §12.4.2). Used to reject
// unknown styles with a 400 before they reach the engine.
const PAGE_LABEL_STYLES = new Set<PageLabelStyle>([
  'decimal',
  'romanLower',
  'romanUpper',
  'alphaLower',
  'alphaUpper',
  'none',
]);

// A document with thousands of single-page ranges is pathological; cap the count
// so a malicious payload cannot exhaust the engine.
const MAX_RANGES = 5000;

/**
 * Validate + normalise an untrusted JSON value into a {@link PageLabelRange}[].
 * Returns an error message string when the payload is not a well-formed array of
 * ranges. `pageCount` bounds the accepted `startPage` (1..pageCount). Omitted
 * `prefix` defaults to `""` and omitted `startNumber` defaults to `1`.
 */
function parseRanges(
  rawJson: string,
  pageCount: number,
): PageLabelRange[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { error: 'ranges must be valid JSON.' };
  }
  if (!Array.isArray(parsed)) {
    return { error: 'ranges must be a JSON array.' };
  }
  if (parsed.length > MAX_RANGES) {
    return { error: `ranges must contain at most ${MAX_RANGES} entries.` };
  }

  const ranges: PageLabelRange[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i] as unknown;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: `ranges[${i}] must be an object.` };
    }
    const src = entry as Record<string, unknown>;

    const startPage = src.startPage;
    if (
      typeof startPage !== 'number' ||
      !Number.isInteger(startPage) ||
      startPage < 1 ||
      startPage > pageCount
    ) {
      return {
        error: `ranges[${i}].startPage must be an integer between 1 and ${pageCount}.`,
      };
    }

    const style = src.style;
    if (
      typeof style !== 'string' ||
      !PAGE_LABEL_STYLES.has(style as PageLabelStyle)
    ) {
      return {
        error: `ranges[${i}].style must be one of: ${[...PAGE_LABEL_STYLES].join(', ')}.`,
      };
    }

    const prefixRaw = src.prefix;
    if (prefixRaw !== undefined && typeof prefixRaw !== 'string') {
      return { error: `ranges[${i}].prefix must be a string.` };
    }
    const prefix = typeof prefixRaw === 'string' ? prefixRaw : '';

    const startNumberRaw = src.startNumber;
    let startNumber = 1;
    if (startNumberRaw !== undefined) {
      if (
        typeof startNumberRaw !== 'number' ||
        !Number.isInteger(startNumberRaw) ||
        startNumberRaw < 1
      ) {
        return { error: `ranges[${i}].startNumber must be an integer >= 1.` };
      }
      startNumber = startNumberRaw;
    }

    ranges.push({
      startPage,
      style: style as PageLabelStyle,
      prefix,
      startNumber,
    });
  }

  return ranges;
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
    if (action !== 'get' && action !== 'set') {
      return NextResponse.json(
        { success: false, error: 'action must be "get" or "set".' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);
    const pageCount = handle._doc.pageCount();

    if (action === 'get') {
      const ranges = handle._doc.getPageLabels();
      const labels: string[] = [];
      for (let page = 1; page <= pageCount; page++) {
        labels.push(handle._doc.pageLabel(page));
      }
      return NextResponse.json({
        success: true,
        data: { ranges, labels, pageCount },
      });
    }

    // action === 'set' — `ranges` is mandatory (an empty array removes labels).
    const rangesRaw = formData.get('ranges') as string | null;
    if (rangesRaw === null) {
      return NextResponse.json(
        { success: false, error: 'ranges is required for the set action.' },
        { status: 400 },
      );
    }

    const result = parseRanges(rangesRaw, pageCount);
    if ('error' in result) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 },
      );
    }

    handle._doc.setPageLabels(result);
    const savedBytes = await saveDocument(handle);

    return new Response(Buffer.from(savedBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(savedBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.page-labels', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to process page labels operation.' },
      { status: 500 },
    );
  }
}
