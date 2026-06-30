/**
 * Searchable-PDF OCR pipeline — adds an INVISIBLE text layer on top of
 * scanned (image-only) pages so the PDF becomes selectable/searchable
 * without altering its visual appearance.
 *
 * Strategy (ocrmypdf-style, fully offline via the WASM engine):
 *   1. Detect pages WITHOUT extractable text via the engine's structured text
 *      (`extractPlainText`). `force: true` processes every page.
 *   2. Rasterise the page to a PNG with the main engine (`renderPage`,
 *      POST-rotation) and send the bitmap to the host OCR microservice, which
 *      returns recognized word boxes in PIXELS (top-left origin, y down). The
 *      requested writing systems pick the forced recognizer (`X-Ocr-Model`).
 *   4. Convert each word bbox from image pixels to PDF user space (bottom-left
 *      origin, y up), honouring /Rotate.
 *   5. Add each word via the WASM engine `addTextLayer` (text render mode 3 —
 *      invisible) in a SINGLE content append per page; glyphs stay part of the
 *      content stream so text extraction/search/selection finds them. The layer
 *      carries arbitrary Unicode (a glyphless Type0 font is embedded for
 *      non-WinAnsi runs), so non-Latin OCR text is searchable too.
 */

import { getEngine } from '../wasm';
import { getOcrWords, scriptTokensToOcrModel } from '../ocr-engine';
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
   * Writing-system tokens to recognize, e.g. `['alpha']` (Latin), `['arabic']`,
   * `['cjk']`. Mapped to a single OCR-service recognizer that is FORCED via the
   * `X-Ocr-Model` header (see `scriptTokensToOcrModel`). When several scripts
   * are given, the first non-Latin one wins. Omit (or pass an empty list) to let
   * the service auto-select a recogniser per line.
   */
  languages?: readonly string[];
  /**
   * On-demand handwriting recognition for **Latin** scripts. When `true` (and no
   * non-Latin script is requested), the service's cursive-Latin recognizer
   * (`latin_hw`) is forced instead of the printed Latin model, so handwritten
   * Latin lines are read. This is the ONLY handwriting recognizer the service
   * exposes — it does not cover non-Latin scripts — and it is opt-in (never
   * auto-detected). Defaults to `false` (printed text only).
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

// Recognition moved host-side: there is no longer a per-script model registry to
// preload. The requested writing systems are mapped to a single service model
// (forced via `X-Ocr-Model`) at call time by `scriptTokensToOcrModel`.

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

  // 2. OCR + invisible text layer. The main engine rasterises the page POST-
  //    rotation to a PNG; the host OCR service returns word boxes in image
  //    pixels; `addTextLayer` writes glyphs in render mode 3 (invisible) — one
  //    batched call per page. The requested scripts pick the forced recogniser.
  const scale = dpi / 72;
  const model = scriptTokensToOcrModel(options.languages, options.handwriting);
  const giga = await getEngine();
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

      const png = doc.renderPage(pageNumber, scale);
      const words = await getOcrWords(png, model ? { model } : {});
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
