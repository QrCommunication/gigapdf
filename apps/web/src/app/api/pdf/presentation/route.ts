/**
 * Presentation / page-setup + figure-accessibility route via the WASM engine.
 *
 * POST /api/pdf/presentation
 *
 * Form fields (multipart/form-data):
 *   file     — PDF file (required)
 *   action   — one of:
 *                "transition"  set or clear a page-transition + auto-advance
 *                "scale"       scale page content / set the user-unit
 *                "collection"  mark the PDF as a portfolio (/Collection)
 *                "figureAlt"   bake author alt-text onto figures (a11y)
 *
 * ── action="transition" ───────────────────────────────────────────────────────
 *   op             "set" (default) | "clear" | "get"
 *   pages          optional JSON array of 1-based page numbers; absent/empty = all
 *                  (ignored for op="get", which always reads every page)
 *   style          (set) one of PAGE_TRANSITION_STYLES
 *   duration       (set) transition effect duration, seconds (> 0)
 *   dimension      (set) "horizontal" | "vertical"   (split/blinds)
 *   motion         (set) "inward" | "outward"        (split/box)
 *   direction      (set) "0"|"90"|"180"|"270"|"315"|"none"
 *   scale          (set) starting/ending scale for `fly` (> 0)
 *   flyAreaOpaque  (set) "true"/"1"                  (fly)
 *   displayDuration(set) page auto-advance time, seconds (> 0)
 *
 * ── action="scale" ────────────────────────────────────────────────────────────
 *   mode           "uniform" (default) | "xy" | "fit" | "userUnit"
 *   pages          optional JSON array of 1-based page numbers; absent/empty = all
 *   factor         (uniform) finite, positive
 *   sx, sy         (xy) finite, positive
 *   width, height  (fit) target points, finite, positive
 *   unit           (userUnit) finite, positive (1.0 = default)
 *
 * ── action="collection" (portfolio) ───────────────────────────────────────────
 *   config         JSON CollectionConfig ({ view?, schema?, sort?, defaultFile?, items? })
 *
 * ── action="figureAlt" (accessibility) ────────────────────────────────────────
 *   figureAlts     JSON array of strings: alt text per document-global figure index
 *
 * Returns the modified PDF as application/pdf, or 400 on bad input / 422 when the
 * engine cannot process the source. The read-only `action="transition"` +
 * `op="get"` instead returns JSON `{ success, data: { transitions } }`, where
 * `transitions[i]` is the `PageTransition | null` of page `i+1`.
 *
 * The engine is called directly here (rather than via @giga-pdf/pdf-engine)
 * because this presentation/page surface is exposed by GigaPdfDoc;
 * @qrcommunication/gigapdf-lib is a server-external package whose `gigapdf.wasm`
 * is traced for `/api/pdf/**` (see next.config.ts). Mirrors api/pdf/pdfa/route.ts.
 */

import { NextResponse } from 'next/server';
import {
  GigaPdfEngine,
  PAGE_TRANSITION_STYLES,
  type GigaPdfDoc,
  type PageTransition,
  type PageTransitionStyle,
  type PageTransitionDimension,
  type PageTransitionMotion,
  type PageTransitionDirection,
  type CollectionConfig,
  type CollectionView,
  type CollectionField,
  type CollectionFieldSubtype,
} from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

type PresentationAction = 'transition' | 'scale' | 'collection' | 'figureAlt';
const VALID_ACTIONS: PresentationAction[] = ['transition', 'scale', 'collection', 'figureAlt'];

type ScaleMode = 'uniform' | 'xy' | 'fit' | 'userUnit';
const VALID_SCALE_MODES: ScaleMode[] = ['uniform', 'xy', 'fit', 'userUnit'];

const TRANSITION_DIMENSIONS: PageTransitionDimension[] = ['horizontal', 'vertical'];
const TRANSITION_MOTIONS: PageTransitionMotion[] = ['inward', 'outward'];
const COLLECTION_VIEWS: CollectionView[] = ['details', 'tile', 'hidden'];
const COLLECTION_SUBTYPES: CollectionFieldSubtype[] = [
  'text',
  'date',
  'number',
  'filename',
  'description',
  'size',
  'creationDate',
  'modDate',
];

/**
 * The Rust→WASM engine, instantiated once and shared across requests. Mirrors
 * the singleton in api/pdf/pdfa/route.ts — `loadDefault()` reads the self-
 * contained `gigapdf.wasm` from disk (no third-party PDF libraries).
 */
let enginePromise: Promise<GigaPdfEngine> | null = null;
function getEngine(): Promise<GigaPdfEngine> {
  enginePromise ??= GigaPdfEngine.loadDefault();
  return enginePromise;
}

/** A 400 Bad Request with a `{ success: false, error }` body. */
function badRequest(error: string): Response {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

/** Read a form field as a trimmed string, or `null` when absent/blank. */
function str(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Parse a finite, strictly positive number; `null` on any other input. */
function positiveNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve the optional `pages` JSON array into a concrete list of 1-based page
 * numbers within `[1, pageCount]`. Absent/empty selects every page. Returns
 * `null` for a malformed array or an out-of-range / non-integer entry.
 */
function parsePages(raw: string | null, pageCount: number): number[] | null {
  if (raw === null) return Array.from({ length: pageCount }, (_, i) => i + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages: number[] = [];
  for (const entry of parsed) {
    const n = typeof entry === 'number' ? entry : Number(entry);
    if (!Number.isInteger(n) || n < 1 || n > pageCount) return null;
    pages.push(n);
  }
  return pages;
}

/** Parse the optional `figureAlts` JSON array; `null` signals a malformed value. */
function parseFigureAlts(raw: string | null): string[] | null {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((v) => (typeof v === 'string' ? v : String(v ?? '')));
  } catch {
    return null;
  }
}

/**
 * Build a {@link PageTransition} from the form, copying only the optional
 * sub-keys that were supplied (the engine writes only the ones that apply to the
 * chosen style). Returns `{ error }` on an invalid enum/number.
 */
function buildTransition(form: FormData): { trans: PageTransition } | { error: string } {
  const style = str(form, 'style');
  if (style === null || !(PAGE_TRANSITION_STYLES as readonly string[]).includes(style)) {
    return { error: `style must be one of: ${PAGE_TRANSITION_STYLES.join(', ')}.` };
  }
  const trans: PageTransition = { style: style as PageTransitionStyle };

  const duration = str(form, 'duration');
  if (duration !== null) {
    const n = positiveNumber(duration);
    if (n === null) return { error: 'duration must be a positive number (seconds).' };
    trans.duration = n;
  }

  const dimension = str(form, 'dimension');
  if (dimension !== null) {
    if (!(TRANSITION_DIMENSIONS as string[]).includes(dimension)) {
      return { error: `dimension must be one of: ${TRANSITION_DIMENSIONS.join(', ')}.` };
    }
    trans.dimension = dimension as PageTransitionDimension;
  }

  const motion = str(form, 'motion');
  if (motion !== null) {
    if (!(TRANSITION_MOTIONS as string[]).includes(motion)) {
      return { error: `motion must be one of: ${TRANSITION_MOTIONS.join(', ')}.` };
    }
    trans.motion = motion as PageTransitionMotion;
  }

  const direction = str(form, 'direction');
  if (direction !== null) {
    const parsedDir = parseDirection(direction);
    if (parsedDir === null) {
      return { error: 'direction must be one of: 0, 90, 180, 270, 315, none.' };
    }
    trans.direction = parsedDir;
  }

  const scale = str(form, 'scale');
  if (scale !== null) {
    const n = positiveNumber(scale);
    if (n === null) return { error: 'scale must be a positive number.' };
    trans.scale = n;
  }

  const flyAreaOpaque = form.get('flyAreaOpaque');
  if (flyAreaOpaque === 'true' || flyAreaOpaque === '1') trans.flyAreaOpaque = true;

  const displayDuration = str(form, 'displayDuration');
  if (displayDuration !== null) {
    const n = positiveNumber(displayDuration);
    if (n === null) return { error: 'displayDuration must be a positive number (seconds).' };
    trans.displayDuration = n;
  }

  return { trans };
}

/** Map the `direction` form value onto a {@link PageTransitionDirection}, or `null`. */
function parseDirection(raw: string): PageTransitionDirection | null {
  switch (raw) {
    case 'none':
      return 'none';
    case '0':
      return 0;
    case '90':
      return 90;
    case '180':
      return 180;
    case '270':
      return 270;
    case '315':
      return 315;
    default:
      return null;
  }
}

/**
 * Validate + normalise the `config` JSON for a portfolio. Keeps only the known
 * keys (defence against arbitrary objects) and rejects bad enum/shape values.
 */
function buildCollectionConfig(raw: string | null): { config: CollectionConfig } | { error: string } {
  if (raw === null) return { error: 'config (a JSON object) is required for action=collection.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'config must be valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'config must be a JSON object.' };
  }
  const input = parsed as Record<string, unknown>;
  const config: CollectionConfig = {};

  if (input.view !== undefined) {
    if (typeof input.view !== 'string' || !(COLLECTION_VIEWS as string[]).includes(input.view)) {
      return { error: `config.view must be one of: ${COLLECTION_VIEWS.join(', ')}.` };
    }
    config.view = input.view as CollectionView;
  }

  if (input.schema !== undefined) {
    if (!Array.isArray(input.schema)) return { error: 'config.schema must be an array.' };
    const schema: CollectionField[] = [];
    for (const col of input.schema) {
      if (typeof col !== 'object' || col === null) {
        return { error: 'config.schema entries must be objects.' };
      }
      const c = col as Record<string, unknown>;
      if (typeof c.key !== 'string' || c.key.trim() === '') {
        return { error: 'each config.schema entry needs a non-empty string "key".' };
      }
      const field: CollectionField = { key: c.key };
      if (typeof c.name === 'string') field.name = c.name;
      if (c.subtype !== undefined) {
        if (typeof c.subtype !== 'string' || !(COLLECTION_SUBTYPES as string[]).includes(c.subtype)) {
          return { error: `config.schema subtype must be one of: ${COLLECTION_SUBTYPES.join(', ')}.` };
        }
        field.subtype = c.subtype as CollectionFieldSubtype;
      }
      if (typeof c.order === 'number' && Number.isFinite(c.order)) field.order = c.order;
      if (typeof c.visible === 'boolean') field.visible = c.visible;
      schema.push(field);
    }
    config.schema = schema;
  }

  return { config };
}

/**
 * Read the current page-transition of every page (1-based) into a dense array.
 * `transitions[i]` is the {@link PageTransition} of page `i+1`, or `null` when
 * that page carries no transition. Used by the editor to pre-fill the dialog
 * with the document's existing presentation state (read-only, no save).
 */
function readTransitions(doc: GigaPdfDoc): Response {
  const count = doc.pageCount();
  const transitions: (PageTransition | null)[] = [];
  for (let page = 1; page <= count; page++) {
    transitions.push(doc.getPageTransition(page));
  }
  return NextResponse.json({ success: true, data: { transitions } });
}

/** Apply a transition set/clear across the resolved pages. */
function applyTransition(doc: GigaPdfDoc, form: FormData, pages: number[]): Response | null {
  const op = str(form, 'op') ?? 'set';
  if (op === 'clear') {
    for (const p of pages) doc.clearPageTransition(p);
    return null;
  }
  if (op !== 'set') return badRequest('op must be "set" or "clear".');

  const built = buildTransition(form);
  if ('error' in built) return badRequest(built.error);
  for (const p of pages) doc.setPageTransition(p, built.trans);
  return null;
}

/** Apply a scale/user-unit change across the resolved pages. */
function applyScale(doc: GigaPdfDoc, form: FormData, pages: number[]): Response | null {
  const mode = (str(form, 'mode') ?? 'uniform') as ScaleMode;
  if (!VALID_SCALE_MODES.includes(mode)) {
    return badRequest(`mode must be one of: ${VALID_SCALE_MODES.join(', ')}.`);
  }

  if (mode === 'uniform') {
    const factor = positiveNumber(str(form, 'factor'));
    if (factor === null) return badRequest('factor must be a positive number.');
    for (const p of pages) doc.scalePageContent(p, factor);
    return null;
  }
  if (mode === 'xy') {
    const sx = positiveNumber(str(form, 'sx'));
    const sy = positiveNumber(str(form, 'sy'));
    if (sx === null || sy === null) return badRequest('sx and sy must be positive numbers.');
    for (const p of pages) doc.scalePageContentXY(p, sx, sy);
    return null;
  }
  if (mode === 'fit') {
    const width = positiveNumber(str(form, 'width'));
    const height = positiveNumber(str(form, 'height'));
    if (width === null || height === null) {
      return badRequest('width and height must be positive numbers (points).');
    }
    for (const p of pages) doc.scalePageTo(p, width, height);
    return null;
  }
  // mode === 'userUnit'
  const unit = positiveNumber(str(form, 'unit'));
  if (unit === null) return badRequest('unit must be a positive number.');
  for (const p of pages) doc.setUserUnit(p, unit);
  return null;
}

/** Bake author-supplied figure alt-text, bounded by figureCount(). */
function applyFigureAlt(doc: GigaPdfDoc, form: FormData): Response | null {
  const figureAlts = parseFigureAlts(str(form, 'figureAlts'));
  if (figureAlts === null) return badRequest('figureAlts must be a JSON array of strings.');
  const figureCount = doc.figureCount();
  const upTo = Math.min(figureAlts.length, figureCount);
  for (let i = 0; i < upTo; i++) {
    const alt = figureAlts[i]?.trim();
    if (alt) doc.setFigureAlt(i, alt);
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  let action: PresentationAction | null = null;
  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    action = (str(formData, 'action') ?? '') as PresentationAction;
    if (!VALID_ACTIONS.includes(action)) {
      return badRequest(`action must be one of: ${VALID_ACTIONS.join(', ')}.`);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const giga = await getEngine();
    let doc: GigaPdfDoc | null = null;
    try {
      doc = giga.open(bytes);

      // Each handler validates its own fields, mutates the doc in place, and
      // returns a 4xx Response on bad input (or null to proceed to save).
      let failure: Response | null = null;
      if (action === 'transition') {
        // Read-only path: return the existing per-page transitions as JSON
        // (no mutation, no save) so the editor can pre-fill its dialog.
        if ((str(formData, 'op') ?? 'set') === 'get') {
          return readTransitions(doc);
        }
        const pages = parsePages(str(formData, 'pages'), doc.pageCount());
        if (pages === null) {
          return badRequest('pages must be a JSON array of valid 1-based page numbers.');
        }
        failure = applyTransition(doc, formData, pages);
      } else if (action === 'scale') {
        const pages = parsePages(str(formData, 'pages'), doc.pageCount());
        if (pages === null) {
          return badRequest('pages must be a JSON array of valid 1-based page numbers.');
        }
        failure = applyScale(doc, formData, pages);
      } else if (action === 'collection') {
        const built = buildCollectionConfig(str(formData, 'config'));
        if ('error' in built) return badRequest(built.error);
        doc.setCollection(built.config);
      } else {
        failure = applyFigureAlt(doc, formData);
      }
      if (failure) return failure;

      const result = doc.saveCompressed();
      const renamed = file.name.replace(/\.pdf$/i, '') + '.presentation.pdf';

      return new Response(Buffer.from(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(renamed),
          'Content-Length': String(result.byteLength),
          'X-Presentation-Action': action,
        },
      });
    } catch (engineError: unknown) {
      // The input is a validated, non-empty PDF at this point, so an engine
      // failure means a corrupt/unsupported source — a client-correctable 422.
      serverLogger.warn('api.pdf.presentation.engine', { error: engineError, action });
      return NextResponse.json(
        {
          success: false,
          error:
            'Presentation update failed. The PDF may be corrupted or use unsupported features.',
        },
        { status: 422 },
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.presentation', { error, action });
    return NextResponse.json(
      {
        success: false,
        error: 'Presentation update failed.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
