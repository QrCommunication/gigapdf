/**
 * Page boundary boxes route — read/write a page's five PDF boxes
 * (MediaBox/CropBox/BleedBox/TrimBox/ArtBox, ISO 32000-1 §14.11.2) via the
 * WASM engine.
 *
 * POST /api/pdf/page-boxes
 *
 * Form fields (multipart/form-data):
 *   file  — PDF file (required)
 *   page  — 1-based page number (optional, default 1)
 *   mode  — "get" | "set" (optional, default "get")
 *   --- set only ---
 *   kind  — one of "media" | "crop" | "bleed" | "trim" | "art"
 *   x,y,w,h — box origin + size in points (finite numbers; w, h > 0). Written
 *             as [x, y, x+w, y+h]; the engine normalises reversed sizes.
 *
 * "get" → JSON `{ success, page, boxes }` where `boxes` is the engine
 *         {@link PageBoxes}: the five **effective** rects `[x0,y0,x1,y1]`
 *         (ISO inheritance + default chain applied) plus the `declared` flags.
 * "set" → applies `setPageBox(page, kind, {x,y,w,h})` and returns the modified
 *         PDF as application/pdf binary. Sibling boxes are preserved.
 *
 * The engine is called directly here (rather than via @giga-pdf/pdf-engine)
 * because getPageBoxes/setPageBox are exposed on GigaPdfDoc;
 * @qrcommunication/gigapdf-lib is a server-external package whose `gigapdf.wasm`
 * is traced for `/api/pdf/**` (see next.config.ts). Mirrors api/pdf/pdfa/route.ts.
 */

import { NextResponse } from 'next/server';
import {
  GigaPdfEngine,
  PAGE_BOX_KINDS,
  type GigaPdfDoc,
  type PageBoxKind,
} from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

/**
 * The Rust→WASM engine, instantiated once and shared across requests. Mirrors
 * the singleton in @giga-pdf/pdf-engine — `loadDefault()` reads the self-
 * contained `gigapdf.wasm` from disk (no third-party PDF libraries).
 */
let enginePromise: Promise<GigaPdfEngine> | null = null;
function getEngine(): Promise<GigaPdfEngine> {
  enginePromise ??= GigaPdfEngine.loadDefault();
  return enginePromise;
}

/** Set of valid box kinds, for O(1) validation of the untrusted `kind` field. */
const PAGE_BOX_KIND_SET: ReadonlySet<string> = new Set<string>(PAGE_BOX_KINDS);

/** Parse a finite number from a form field; `null` when absent or non-numeric. */
function parseFiniteNumber(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const mode = ((formData.get('mode') as string | null) ?? 'get').toLowerCase();
    if (mode !== 'get' && mode !== 'set') {
      return NextResponse.json(
        { success: false, error: 'mode must be "get" or "set".' },
        { status: 400 },
      );
    }

    // 1-based page number; default to the first page.
    let page = 1;
    const pageRaw = formData.get('page');
    if (typeof pageRaw === 'string' && pageRaw.trim() !== '') {
      const parsed = Number(pageRaw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return NextResponse.json(
          { success: false, error: 'page must be a positive integer (1-based).' },
          { status: 400 },
        );
      }
      page = parsed;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const giga = await getEngine();
    let doc: GigaPdfDoc | null = null;
    try {
      doc = giga.open(bytes);

      if (mode === 'get') {
        // The five effective rects + `declared` flags — a plain JSON-safe object.
        const boxes = doc.getPageBoxes(page);
        return NextResponse.json({ success: true, page, boxes });
      }

      // mode === 'set' — validate the kind and the box before touching the engine.
      const kind = (formData.get('kind') as string | null) ?? '';
      if (!PAGE_BOX_KIND_SET.has(kind)) {
        return NextResponse.json(
          { success: false, error: `kind must be one of: ${PAGE_BOX_KINDS.join(', ')}.` },
          { status: 400 },
        );
      }

      const x = parseFiniteNumber(formData.get('x'));
      const y = parseFiniteNumber(formData.get('y'));
      const w = parseFiniteNumber(formData.get('w'));
      const h = parseFiniteNumber(formData.get('h'));
      if (x === null || y === null || w === null || h === null) {
        return NextResponse.json(
          { success: false, error: 'x, y, w and h are required finite numbers (points).' },
          { status: 400 },
        );
      }
      if (w <= 0 || h <= 0) {
        return NextResponse.json(
          { success: false, error: 'w and h must be greater than 0.' },
          { status: 400 },
        );
      }

      const ok = doc.setPageBox(page, kind as PageBoxKind, { x, y, w, h });
      if (!ok) {
        // The engine rejects an unknown kind, a degenerate box (zero/negative
        // area), or a bad page number — all client-correctable (422, not 500).
        return NextResponse.json(
          {
            success: false,
            error:
              'Could not set the page box. Check the page number and that the box has a positive area.',
          },
          { status: 422 },
        );
      }

      const result = doc.save();

      return new Response(Buffer.from(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(file.name),
          'Content-Length': String(result.byteLength),
          'X-Page-Box-Kind': kind,
          'X-Page-Number': String(page),
        },
      });
    } catch (engineError: unknown) {
      // The input is a validated, non-empty PDF at this point, so an engine
      // failure means a corrupt/unsupported source or an out-of-range page — a
      // client-correctable 422, not a server fault.
      serverLogger.warn('api.pdf.page-boxes.engine', { error: engineError, mode, page });
      return NextResponse.json(
        {
          success: false,
          error:
            'Page box operation failed. The PDF may be corrupted or the page number out of range.',
        },
        { status: 422 },
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.page-boxes', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Page box operation failed.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
