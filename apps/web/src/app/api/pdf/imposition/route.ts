/**
 * Imposition / document-JavaScript / optional-content route via the WASM engine.
 *
 * POST /api/pdf/imposition
 *
 * Form fields (multipart/form-data):
 *   file    — PDF file (required)
 *   action  — one of:
 *     "nup"        N-up imposition of ALL pages, `cols × rows` per sheet.
 *                  Params: cols, rows (positive ints); optional sheetWidth,
 *                  sheetHeight, margin, gutter (points). Originals are replaced
 *                  by the imposed sheets. → application/pdf
 *     "placePage"  Draw one source page's content onto a target page, scaled.
 *                  Params: target, source (1-based ints), x, y (points),
 *                  scaleX, scaleY (> 0). → application/pdf
 *     "jsList"     List document-level JavaScripts. → JSON { scripts: [{name,script}] }
 *     "jsAdd"      Install a document-level JavaScript. Params: name, script.
 *                  Re-using a name replaces it. → application/pdf
 *     "jsRemove"   Remove a document-level JavaScript by name. Params: name.
 *                  → application/pdf (404 if no script had that name)
 *     "ocgLayers"  List the document's optional-content layers (OCGs).
 *                  → JSON { layers: LayerInfo[] }
 *     "ocgBegin"   Open an optional-content sequence on a page for a layer.
 *                  Params: page (1-based); either `ocg` (existing layer id) or
 *                  `layerName` (creates a fresh layer). → application/pdf
 *     "ocgEnd"     Close the innermost optional-content sequence on a page.
 *                  Params: page (1-based). → application/pdf
 *
 * The engine is called directly here (rather than via @giga-pdf/pdf-engine)
 * because nUp/placePage, the /Names /JavaScript tree and the optional-content
 * primitives are exposed on GigaPdfDoc; @qrcommunication/gigapdf-lib is a
 * server-external package whose `gigapdf.wasm` is traced for `/api/pdf/**`
 * (see next.config.ts). Mirrors api/pdf/page-boxes/route.ts.
 */

import { NextResponse } from 'next/server';
import { GigaPdfEngine, type GigaPdfDoc } from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

/** Every supported sub-action; used to validate the untrusted `action` field. */
const ACTIONS = [
  'nup',
  'placePage',
  'jsList',
  'jsAdd',
  'jsRemove',
  'ocgLayers',
  'ocgBegin',
  'ocgEnd',
] as const;
type ImpositionAction = (typeof ACTIONS)[number];
const ACTION_SET: ReadonlySet<string> = new Set<string>(ACTIONS);

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

// ── Field parsing ─────────────────────────────────────────────────────────────

/** A 1-based positive integer from a form field; `null` when absent/invalid. */
function parsePositiveInt(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** A finite number from a form field; `null` when absent or non-numeric. */
function parseFiniteNumber(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A trimmed string from a form field; empty string when absent. */
function parseString(raw: FormDataEntryValue | null): string {
  return typeof raw === 'string' ? raw : '';
}

// ── Response helpers ──────────────────────────────────────────────────────────

function badRequest(error: string): Response {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

/** Serialise the saved document as application/pdf, mirroring sibling routes. */
function pdfResponse(
  bytes: Uint8Array,
  filename: string,
  action: ImpositionAction,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': sanitizeContentDisposition(filename),
      'Content-Length': String(bytes.byteLength),
      'X-Imposition-Action': action,
      ...extraHeaders,
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

    const action = parseString(formData.get('action')) || 'nup';
    if (!ACTION_SET.has(action)) {
      return badRequest(`action must be one of: ${ACTIONS.join(', ')}.`);
    }
    const act = action as ImpositionAction;

    const bytes = new Uint8Array(await file.arrayBuffer());

    const giga = await getEngine();
    let doc: GigaPdfDoc | null = null;
    try {
      doc = giga.open(bytes);

      switch (act) {
        // ── Read-only JSON actions ────────────────────────────────────────────
        case 'jsList': {
          const scripts = doc.documentJavascripts();
          return NextResponse.json({ success: true, scripts });
        }
        case 'ocgLayers': {
          const layers = doc.layers();
          return NextResponse.json({ success: true, layers });
        }

        // ── N-up imposition of all pages ──────────────────────────────────────
        case 'nup': {
          const cols = parsePositiveInt(formData.get('cols'));
          const rows = parsePositiveInt(formData.get('rows'));
          if (cols === null || rows === null) {
            return badRequest('cols and rows are required positive integers.');
          }

          const opts: {
            sheetWidth?: number;
            sheetHeight?: number;
            margin?: number;
            gutter?: number;
          } = {};
          const sheetWidth = parseFiniteNumber(formData.get('sheetWidth'));
          const sheetHeight = parseFiniteNumber(formData.get('sheetHeight'));
          const margin = parseFiniteNumber(formData.get('margin'));
          const gutter = parseFiniteNumber(formData.get('gutter'));
          if (sheetWidth !== null) {
            if (sheetWidth <= 0) return badRequest('sheetWidth must be greater than 0.');
            opts.sheetWidth = sheetWidth;
          }
          if (sheetHeight !== null) {
            if (sheetHeight <= 0) return badRequest('sheetHeight must be greater than 0.');
            opts.sheetHeight = sheetHeight;
          }
          if (margin !== null) {
            if (margin < 0) return badRequest('margin must be 0 or greater.');
            opts.margin = margin;
          }
          if (gutter !== null) {
            if (gutter < 0) return badRequest('gutter must be 0 or greater.');
            opts.gutter = gutter;
          }

          const sheets = doc.nUp(cols, rows, opts);
          if (sheets < 0) {
            return NextResponse.json(
              {
                success: false,
                error: 'N-up imposition failed. Check the grid size and that the document has pages.',
              },
              { status: 422 },
            );
          }
          return pdfResponse(doc.save(), file.name, act, { 'X-Imposition-Sheets': String(sheets) });
        }

        // ── Place one page onto another ───────────────────────────────────────
        case 'placePage': {
          const target = parsePositiveInt(formData.get('target'));
          const source = parsePositiveInt(formData.get('source'));
          if (target === null || source === null) {
            return badRequest('target and source are required positive integers (1-based).');
          }
          const x = parseFiniteNumber(formData.get('x'));
          const y = parseFiniteNumber(formData.get('y'));
          const scaleX = parseFiniteNumber(formData.get('scaleX'));
          const scaleY = parseFiniteNumber(formData.get('scaleY'));
          if (x === null || y === null || scaleX === null || scaleY === null) {
            return badRequest('x, y, scaleX and scaleY are required finite numbers.');
          }
          if (scaleX <= 0 || scaleY <= 0) {
            return badRequest('scaleX and scaleY must be greater than 0.');
          }

          const ok = doc.placePage(target, source, x, y, scaleX, scaleY);
          if (!ok) {
            return NextResponse.json(
              { success: false, error: 'Could not place the page. Check the target/source page numbers.' },
              { status: 422 },
            );
          }
          return pdfResponse(doc.save(), file.name, act);
        }

        // ── Document-level JavaScript ─────────────────────────────────────────
        case 'jsAdd': {
          const name = parseString(formData.get('name')).trim();
          const script = parseString(formData.get('script'));
          if (name === '') return badRequest('name is required.');
          if (script.trim() === '') return badRequest('script is required.');

          const ok = doc.addDocumentJavascript(name, script);
          if (!ok) {
            return NextResponse.json(
              { success: false, error: 'Could not install the document JavaScript.' },
              { status: 422 },
            );
          }
          return pdfResponse(doc.save(), file.name, act);
        }
        case 'jsRemove': {
          const name = parseString(formData.get('name')).trim();
          if (name === '') return badRequest('name is required.');

          const removed = doc.removeDocumentJavascript(name);
          if (!removed) {
            return NextResponse.json(
              { success: false, error: `No document JavaScript named "${name}".` },
              { status: 404 },
            );
          }
          return pdfResponse(doc.save(), file.name, act);
        }

        // ── Optional content (layers) ─────────────────────────────────────────
        case 'ocgBegin': {
          const page = parsePositiveInt(formData.get('page'));
          if (page === null) return badRequest('page is required (positive integer, 1-based).');

          // Either reuse an existing layer id, or create one from a name.
          let ocgId = parsePositiveInt(formData.get('ocg'));
          const layerName = parseString(formData.get('layerName')).trim();
          if (ocgId === null) {
            if (layerName === '') {
              return badRequest('Provide either an ocg id or a layerName.');
            }
            const created = doc.addLayer(layerName);
            if (created === 0) {
              return NextResponse.json(
                { success: false, error: 'Could not create the layer.' },
                { status: 422 },
              );
            }
            ocgId = created;
          }

          const property = doc.beginOptionalContent(page, ocgId);
          if (property === '') {
            return NextResponse.json(
              { success: false, error: 'Could not begin optional content. Check the page and layer id.' },
              { status: 422 },
            );
          }
          return pdfResponse(doc.save(), file.name, act, {
            'X-OCG-Id': String(ocgId),
            'X-OCG-Property': property,
          });
        }
        case 'ocgEnd': {
          const page = parsePositiveInt(formData.get('page'));
          if (page === null) return badRequest('page is required (positive integer, 1-based).');

          const ok = doc.endOptionalContent(page);
          if (!ok) {
            return NextResponse.json(
              { success: false, error: 'Could not end optional content. No open sequence on this page?' },
              { status: 422 },
            );
          }
          return pdfResponse(doc.save(), file.name, act);
        }
      }

      // Unreachable: `act` is exhaustively handled above.
      return badRequest('Unsupported action.');
    } catch (engineError: unknown) {
      // The input is a validated, non-empty PDF at this point, so an engine
      // failure means a corrupt/unsupported source or out-of-range parameters —
      // a client-correctable 422, not a server fault.
      serverLogger.warn('api.pdf.imposition.engine', { error: engineError, action: act });
      return NextResponse.json(
        {
          success: false,
          error: 'Imposition operation failed. The PDF may be corrupted or the parameters out of range.',
        },
        { status: 422 },
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.imposition', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Imposition operation failed.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
