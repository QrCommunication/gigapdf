/**
 * Searchable-PDF OCR pipeline — adds an INVISIBLE text layer on top of
 * scanned (image-only) pages so the PDF becomes selectable/searchable
 * without altering its visual appearance.
 *
 * Strategy (ocrmypdf-style, fully offline via the WASM engine):
 *   1. Detect pages WITHOUT extractable text via the engine's structured text
 *      (`extractPlainText`). `force: true` processes every page.
 *   2. Load the bundled per-script OCR models (`loadAllBundledOcrModels`) so the
 *      CRNN recognizes any shipped script (Latin/Cyrillic/Greek, Arabic/Urdu/
 *      Hebrew, Devanagari, Bengali, Tamil); the engine's script detector routes
 *      each line. Without a model it falls back to the mono-glyph Latin CNN.
 *   3. Run the engine's OCR (`doc.ocr`) which rasterises + recognises in
 *      WebAssembly and returns word boxes in PIXELS of the page rasterised at
 *      `dpi/72` (top-left origin, y down).
 *   4. Convert each word bbox from image pixels to PDF user space (bottom-left
 *      origin, y up), honouring /Rotate.
 *   5. Add each word via the WASM engine `addTextLayer` (text render mode 3 —
 *      invisible) in a SINGLE content append per page; glyphs stay part of the
 *      content stream so text extraction/search/selection finds them. The layer
 *      carries arbitrary Unicode (a glyphless Type0 font is embedded for
 *      non-WinAnsi runs), so non-Latin OCR text is searchable too.
 */

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GigaPdfEngine, OcrScript } from 'gigapdf-lib-ocr';
import { getOcrEngine } from '../wasm-ocr';
import { engineLogger } from '../utils/logger';
import { extractPlainText } from './structured-text';

export interface MakeSearchablePdfOptions {
  /** Render DPI for the OCR rasterisation. Defaults to 144. */
  dpi?: 144 | 200 | 300;
  /**
   * OCR every page, even those that already contain extractable text.
   * Defaults to false (only image-only pages are processed).
   */
  force?: boolean;
  /**
   * OCR scripts to recognize (each loads a per-script CRNN model once). Omit to
   * load ALL bundled models — Latin/Cyrillic/Greek, Arabic/Urdu/Hebrew,
   * Devanagari, Bengali, Tamil, and any added later — so text in any language is
   * recognized. Restrict it (e.g. `['alpha']`) for speed on known-Latin scans.
   */
  languages?: readonly OcrScript[];
  /**
   * On-demand handwriting recognition for **Latin** scripts. When `true`, the
   * bundled cursive-Latin model (`ocr_alpha_hw.gpocr`) is loaded in addition to
   * the printed recognizers, so handwritten Latin lines are read. This is the
   * ONLY handwriting model exposed by the engine — it does not cover non-Latin
   * scripts — and it is opt-in (never auto-detected). Defaults to `false`
   * (printed text only). A load failure is non-fatal: recognition stays on the
   * printed models.
   */
  handwriting?: boolean;
  /**
   * Restrict OCR to a contiguous 1-based page range (inclusive) — e.g.
   * `{ from: 3, to: 3 }` to OCR only page 3 ("current page only"). Omit to
   * process the whole document (historical default). The range further narrows
   * the automatic selection (and `force`), so a page with extractable text is
   * still skipped unless `force` is set; it never widens it. Out-of-bounds or
   * inverted ranges are clamped, yielding zero pages (the original bytes are
   * returned untouched).
   */
  pageRange?: { from: number; to: number };
}

/**
 * Narrow a list of candidate 1-based page numbers to those inside an optional
 * inclusive `pageRange`. Returns the list unchanged when no range is given
 * (whole-document default). Shared by the searchable and editable pipelines so
 * the "current page only" scope behaves identically in both. Pure.
 */
export function filterPagesByRange(
  pages: number[],
  range?: { from: number; to: number },
): number[] {
  if (!range) return pages;
  const lo = Math.min(range.from, range.to);
  const hi = Math.max(range.from, range.to);
  return pages.filter((p) => p >= lo && p <= hi);
}

export interface MakeSearchablePdfResult {
  bytes: Uint8Array;
  /** Number of pages that went through the OCR pipeline. */
  pagesProcessed: number;
  /** Number of invisible words written into the PDF. */
  wordsAdded: number;
}

/** One OCR word bounding box, in image pixels (top-left origin, y down). */
export interface OcrWordBox {
  /** Left edge in image pixels (top-left origin). */
  left: number;
  /** Top edge in image pixels (top-left origin, y down). */
  top: number;
  /** Width in image pixels. */
  width: number;
  /** Height in image pixels. */
  height: number;
}

export interface PdfPlacementContext {
  /** Rendered image width in pixels. */
  imageWidth: number;
  /** Rendered image height in pixels. */
  imageHeight: number;
  /** Page width in PDF points (user space, UNrotated MediaBox). */
  pageWidth: number;
  /** Page height in PDF points (user space, UNrotated MediaBox). */
  pageHeight: number;
  /** Page /Rotate flag. The rendered image shows the page POST-rotation. */
  rotation: 0 | 90 | 180 | 270;
}

export interface PdfWordPlacement {
  /** Baseline start X in PDF user space. */
  x: number;
  /** Baseline start Y in PDF user space. */
  y: number;
  /** Font size in points (≈ 90% of the bbox height). */
  fontSize: number;
  /** Rotation to apply to the drawn text (counterclockwise degrees). */
  rotation: 0 | 90 | 180 | 270;
}

/**
 * Convert an OCR word bbox (image pixels, top-left origin, y down)
 * into a drawText placement (PDF user space, bottom-left origin,
 * y up), accounting for the page /Rotate flag.
 *
 * scale = displayedPageWidthPt / imageWidthPx, where the displayed width is
 * pageHeight for /Rotate 90|270 (the engine rasterises POST-rotation, so the
 * image axes follow the displayed page, not the user-space MediaBox).
 *
 * The baseline is anchored at the BOTTOM of the word bbox — close enough
 * for an invisible layer whose only job is search/selection geometry.
 * Pure function — unit-tested with inline fixtures.
 */
export function ocrWordToPdfPlacement(
  word: OcrWordBox,
  ctx: PdfPlacementContext,
): PdfWordPlacement {
  const displayedWidth =
    ctx.rotation === 90 || ctx.rotation === 270 ? ctx.pageHeight : ctx.pageWidth;
  const scale = displayedWidth / ctx.imageWidth;
  const fontSize = word.height * scale * 0.9;
  const bottomPx = word.top + word.height;

  switch (ctx.rotation) {
    case 90:
      // image (px, py) → user (py·s, px·s); baseline runs along +y.
      return { x: bottomPx * scale, y: word.left * scale, fontSize, rotation: 90 };
    case 180:
      // image (px, py) → user (W − px·s, py·s); baseline runs along −x.
      return {
        x: ctx.pageWidth - word.left * scale,
        y: bottomPx * scale,
        fontSize,
        rotation: 180,
      };
    case 270:
      // image (px, py) → user (W − py·s, H − px·s); baseline runs along −y.
      return {
        x: ctx.pageWidth - bottomPx * scale,
        y: ctx.pageHeight - word.left * scale,
        fontSize,
        rotation: 270,
      };
    default:
      // image (px, py) → user (px·s, H − py·s); Y flip bottom-up.
      return {
        x: word.left * scale,
        y: ctx.pageHeight - bottomPx * scale,
        fontSize,
        rotation: 0,
      };
  }
}

/** Normalise a rotation angle to 0|90|180|270. */
function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const wrapped = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return (wrapped === 90 || wrapped === 180 || wrapped === 270 ? wrapped : 0) as
    | 0
    | 90
    | 180
    | 270;
}

// OCR models load into the engine's GLOBAL registry, and `getEngine()` returns a
// process singleton — so load each model at most once, not per call.
let allOcrModelsLoaded = false;
let allOcrModelsPromise: Promise<number> | null = null;
const loadedOcrScripts = new Set<OcrScript>();

/**
 * The bundled cursive-Latin handwriting model. It is NOT part of the `OcrScript`
 * enum (so `loadBundledOcrModel` cannot load it); it ships as a raw `.gpocr` blob
 * under the engine package's `models/` and is host-loaded via `loadOcrModel`.
 */
// Load-once guard for the handwriting model (engine registry is process-global).
let handwritingModelLoaded = false;
let handwritingModelPromise: Promise<boolean> | null = null;

/**
 * Load the bundled cursive-Latin handwriting model into the engine, once per
 * process. Resolves the blob through the engine package's `./models/*` export so
 * it survives bundling, reads the bytes, and registers them via `loadOcrModel`.
 * Returns `true` once the model is loaded. A failure (blob absent in a future
 * release, read error) is swallowed by the caller and recognition stays on the
 * printed models.
 */
async function ensureHandwritingModel(engine: GigaPdfEngine): Promise<boolean> {
  if (handwritingModelLoaded) return true;
  handwritingModelPromise ??= (async () => {
    const require = createRequire(import.meta.url);
    // Resolve the model via the package's `package.json` (a known module type)
    // then join the path manually. A direct `require.resolve('….gpocr')` makes
    // Turbopack try to bundle the model and fail the build with "Unknown module
    // type"; the bytes are read from disk at runtime (the `.gpocr` files are
    // traced into the standalone output via next.config outputFileTracingIncludes).
    const ocrPkgDir = dirname(require.resolve('gigapdf-lib-ocr/package.json'));
    const modelPath = join(ocrPkgDir, 'models', 'ocr_alpha_hw.gpocr');
    const bytes = await readFile(modelPath);
    const ok = engine.loadOcrModel(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    handwritingModelLoaded = ok;
    return ok;
  })();
  return handwritingModelPromise;
}

/**
 * Ensure the requested OCR models are loaded into the engine (idempotent across
 * calls). With no `languages`, loads every bundled model so the recognizer
 * covers any shipped script (the engine's detector routes each line). When
 * `handwriting` is set, additionally loads the cursive-Latin model so
 * handwritten Latin lines are recognized (opt-in; Latin only). Failures are
 * non-fatal: OCR then falls back to the built-in mono-glyph Latin classifier.
 *
 * Exported so the editable-OCR pipeline ({@link makeEditableOcrPdf}) shares the
 * same process-global, load-once model registry instead of re-implementing it.
 */
export async function ensureOcrModels(
  engine: GigaPdfEngine,
  languages?: readonly OcrScript[],
  handwriting = false,
): Promise<void> {
  try {
    if (!languages || languages.length === 0) {
      if (!allOcrModelsLoaded) {
        allOcrModelsPromise ??= engine.loadAllBundledOcrModels();
        const count = await allOcrModelsPromise;
        allOcrModelsLoaded = true;
        engineLogger.info('ocr-searchable: loaded all bundled OCR models', { count });
      }
    } else {
      const missing = languages.filter((s) => !loadedOcrScripts.has(s));
      if (missing.length > 0) {
        const loaded = await engine.loadBundledOcrModels(missing);
        loaded.forEach((s) => loadedOcrScripts.add(s));
        engineLogger.info('ocr-searchable: loaded OCR models', { requested: languages, loaded });
      }
    }

    // On-demand handwriting (Latin only) — loaded on top of the printed models.
    if (handwriting) {
      const ok = await ensureHandwritingModel(engine);
      engineLogger.info('ocr-searchable: handwriting model', { loaded: ok });
    }
  } catch (err) {
    engineLogger.warn('ocr-searchable: OCR model loading failed — mono-glyph fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Add an invisible (opacity 0) text layer to every image-only page of the
 * PDF, making it searchable and selectable. Pages that already contain
 * extractable text are left untouched unless `force: true`.
 *
 * Returns the original bytes untouched (pagesProcessed = 0) when no page
 * needs OCR.
 */
export async function makeSearchablePdf(
  pdfBytes: Uint8Array,
  options: MakeSearchablePdfOptions = {},
): Promise<MakeSearchablePdfResult> {
  const { dpi = 144, force = false } = options;

  // 1. Page selection — only pages without extractable text, unless forced,
  //    then narrowed to the optional page range ("current page only" scope).
  const pageTexts = await extractPlainText(pdfBytes);
  const targetPages = filterPagesByRange(
    (force ? pageTexts : pageTexts.filter((p) => p.text.trim().length === 0)).map(
      (p) => p.pageNumber,
    ),
    options.pageRange,
  );

  if (targetPages.length === 0) {
    return { bytes: pdfBytes, pagesProcessed: 0, wordsAdded: 0 };
  }

  // 2. OCR + invisible text layer via the WASM engine. `doc.ocr` rasterises
  //    POST-rotation and returns word boxes in image pixels; `addTextLayer`
  //    writes glyphs in render mode 3 (invisible) — one batched call per page.
  const scale = dpi / 72;
  const giga = await getOcrEngine();
  // Load per-script recognizers so non-Latin scripts are recognized, not just
  // the built-in mono-glyph Latin classifier; add the Latin handwriting model
  // when the caller opts in.
  await ensureOcrModels(giga, options.languages, options.handwriting);
  const doc = giga.open(pdfBytes);

  let pagesProcessed = 0;
  let wordsAdded = 0;

  try {
    for (const pageNumber of targetPages) {
      const info = doc.pageInfo(pageNumber);
      const rotation = normalizeRotation(info.rotation);

      // The engine rasterises the page POST-rotation, so the image axes follow
      // the displayed page. Reconstruct the rasterised image dimensions.
      const displayedW = rotation === 90 || rotation === 270 ? info.height : info.width;
      const displayedH = rotation === 90 || rotation === 270 ? info.width : info.height;
      const imageWidth = Math.round(displayedW * scale);
      const imageHeight = Math.round(displayedH * scale);

      const words = doc.ocr(pageNumber, scale);
      pagesProcessed += 1;

      const ctx: PdfPlacementContext = {
        imageWidth,
        imageHeight,
        pageWidth: info.width,
        pageHeight: info.height,
        rotation,
      };

      const runs: { x: number; y: number; size: number; text: string; rotation: number }[] = [];
      for (const word of words) {
        if (word.text.trim().length === 0) continue;
        const placement = ocrWordToPdfPlacement(
          { left: word.x, top: word.y, width: word.w, height: word.h },
          ctx,
        );
        if (placement.fontSize < 1) continue;
        runs.push({
          x: placement.x,
          y: placement.y,
          size: placement.fontSize,
          text: word.text,
          rotation: placement.rotation,
        });
      }
      // addTextLayer embeds a glyphless Type0 font for non-WinAnsi runs, so any
      // script is written; it returns the count actually added.
      if (runs.length > 0) {
        wordsAdded += doc.addTextLayer(pageNumber, runs);
      }
    }

    const bytes = doc.saveCompressed();

    engineLogger.info('ocr-searchable: invisible text layer added', {
      pagesProcessed,
      wordsAdded,
      dpi,
      inputBytes: pdfBytes.byteLength,
      outputBytes: bytes.byteLength,
    });

    return { bytes, pagesProcessed, wordsAdded };
  } finally {
    doc.close();
  }
}
