/**
 * Editable-OCR pipeline — turns a scanned (image-only) PDF into one whose text
 * is BOTH visible and editable, by masking the scanned glyphs and laying real
 * OCR text on top.
 *
 * This is the ONLY OCR mode where masking the source pixels is acceptable
 * (product decision): the user explicitly asked to EDIT the recognized text, so
 * we replace the scanned background of each text zone with its local background
 * colour and place a fresh text run over it. Contrast with
 * {@link makeSearchablePdf}, which adds an INVISIBLE layer and never alters the
 * page's appearance (used for search/selection only — left untouched).
 *
 * Pipeline (offline, fully in the WASM engine):
 *   1. Select pages WITHOUT extractable text (or every page with `force`).
 *   2. Map the requested scripts to a single forced OCR-service recognizer
 *      (shared logic with the searchable pipeline via `scriptTokensToOcrModel`).
 *   3. For each page:
 *        a. `renderPage` → PNG (POST-rotation). The SAME PNG feeds OCR and
 *           background sampling, so image pixels align 1:1 with the word boxes.
 *        b. `getOcrWords(png)` → word boxes (image pixels, top-left origin, y
 *           down) from the host OCR microservice.
 *        c. Group words into LINES (fewer, cleaner masks than per-word; the fill
 *           stays homogeneous over a whole line).
 *        d. For each line: sample the local background colour from the RGBA ring
 *           around the line bbox (median of the perimeter pixels; white fallback)
 *           and paint an opaque rectangle over the line in PDF user space —
 *           hiding the scanned glyphs.
 *        e. For each word: place a real OCR text run (baseline-anchored) on top.
 *   4. After a re-parse, the engine surfaces these runs as ordinary editable text
 *      elements (visible + selectable), with NO scan showing through underneath.
 *
 * Order matters: every mask rectangle is painted BEFORE the text layer of the
 * same page, so the content-stream paint order is [scan] → [masks] → [text].
 */

import type { GigaPdfEngine } from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';
import { getOcrWords, scriptTokensToOcrModel, type NativeOcrWord } from '../ocr-engine';
import { engineLogger } from '../utils/logger';
import { extractPlainText } from './structured-text';
import {
  filterPagesByRange,
  ocrWordToPdfPlacement,
  type MakeSearchablePdfOptions,
  type OcrWordBox,
  type PdfPlacementContext,
} from './ocr-searchable';
import { ocrWordToPdfBox, pdfBoxToImageRect } from './ocr-blocks';

/** Options for {@link makeEditableOcrPdf} (same surface as the searchable mode). */
export type MakeEditableOcrPdfOptions = MakeSearchablePdfOptions;

export interface MakeEditableOcrPdfResult {
  bytes: Uint8Array;
  /** Number of pages that went through the OCR pipeline. */
  pagesProcessed: number;
  /** Number of OCR words written as editable text. */
  wordsAdded: number;
  /** Number of background masks painted (one per recognized line). */
  masksAdded: number;
}

/** A decoded raster page: raw RGBA pixels + dimensions (top-left origin). */
interface DecodedPage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** An axis-aligned image-pixel rectangle (top-left origin, y down). */
interface ImageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** White, used when the local background cannot be sampled. */
const WHITE_RGB = 0xffffff;

/** Normalise a rotation angle to 0|90|180|270. */
function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const wrapped = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return (wrapped === 90 || wrapped === 180 || wrapped === 270 ? wrapped : 0) as
    | 0
    | 90
    | 180
    | 270;
}

/** Median of a numeric list (lower-middle for even counts). 0 for an empty list. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * Sample the local background colour around an image-pixel rectangle by taking
 * the median of the opaque pixels on a thin ring just OUTSIDE the rect (so the
 * scanned glyphs inside the rect don't pollute the estimate). The ring is
 * clamped to the image; if no opaque sample is found (rect flush to an edge, or
 * fully transparent), returns `null` so the caller can fall back to white.
 *
 * Returns an `0xRRGGBB` colour (the encoding `addRectangle` expects). Pure —
 * unit-tested with inline RGBA fixtures.
 *
 * @param ring - ring thickness in pixels (defaults to 2).
 */
export function sampleBackgroundColor(
  image: DecodedPage,
  rect: ImageRect,
  ring = 2,
): number | null {
  const { width: imgW, height: imgH, rgba } = image;
  if (imgW <= 0 || imgH <= 0 || rgba.length < imgW * imgH * 4) return null;

  const x0 = Math.round(rect.left);
  const y0 = Math.round(rect.top);
  const x1 = Math.round(rect.left + rect.width);
  const y1 = Math.round(rect.top + rect.height);

  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  const consider = (px: number, py: number): void => {
    // Skip the rect interior (the glyphs) — only sample the surrounding ring.
    if (px >= x0 && px < x1 && py >= y0 && py < y1) return;
    if (px < 0 || py < 0 || px >= imgW || py >= imgH) return;
    const idx = (py * imgW + px) * 4;
    if (rgba[idx + 3]! < 200) return; // ignore (semi-)transparent pixels
    reds.push(rgba[idx]!);
    greens.push(rgba[idx + 1]!);
    blues.push(rgba[idx + 2]!);
  };

  // Top & bottom bands (rings above and below the rect, spanning its width).
  for (let band = 1; band <= ring; band++) {
    for (let px = x0 - ring; px < x1 + ring; px++) {
      consider(px, y0 - band);
      consider(px, y1 - 1 + band);
    }
  }
  // Left & right bands (rings beside the rect, spanning its height).
  for (let band = 1; band <= ring; band++) {
    for (let py = y0; py < y1; py++) {
      consider(x0 - band, py);
      consider(x1 - 1 + band, py);
    }
  }

  if (reds.length === 0) return null;
  return (median(reds) << 16) | (median(greens) << 8) | median(blues);
}

/**
 * Group recognized words into reading LINES. Words join a line when their
 * vertical centres fall within ~60% of the page's median word height — the same
 * robust left-to-right clustering used by the OCR-blocks extractor. Empty words
 * are dropped. Each returned line keeps its words in left-to-right order.
 */
function groupWordsIntoLines(words: NativeOcrWord[]): NativeOcrWord[][] {
  const nonEmpty = words.filter((w) => w.text.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  const heights = nonEmpty.map((w) => w.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] ?? 1;
  const lineTolerancePx = Math.max(medianH * 0.6, 1);

  const sorted = [...nonEmpty].sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: NativeOcrWord[][] = [];
  for (const word of sorted) {
    const centreY = word.y + word.h / 2;
    const line = lines.find((group) => {
      const ref = group[group.length - 1]!;
      return Math.abs(centreY - (ref.y + ref.h / 2)) <= lineTolerancePx;
    });
    if (line) line.push(word);
    else lines.push([word]);
  }
  return lines.map((line) => [...line].sort((a, b) => a.x - b.x));
}

/** The union pixel bbox of a non-empty list of OCR words. */
function unionWordBox(line: NativeOcrWord[]): OcrWordBox {
  const left = Math.min(...line.map((w) => w.x));
  const top = Math.min(...line.map((w) => w.y));
  const right = Math.max(...line.map((w) => w.x + w.w));
  const bottom = Math.max(...line.map((w) => w.y + w.h));
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * OCR a scanned PDF into an EDITABLE one: mask each recognized line's scanned
 * background and lay real text on top. Pages that already contain extractable
 * text are skipped unless `force: true`. Returns the original bytes untouched
 * (pagesProcessed = 0) when no page needs OCR.
 */
export async function makeEditableOcrPdf(
  pdfBytes: Uint8Array,
  options: MakeEditableOcrPdfOptions = {},
): Promise<MakeEditableOcrPdfResult> {
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
    return { bytes: pdfBytes, pagesProcessed: 0, wordsAdded: 0, masksAdded: 0 };
  }

  const scale = dpi / 72;
  const model = scriptTokensToOcrModel(options.languages, options.handwriting);
  const giga = await getEngine();
  const doc = giga.open(pdfBytes);

  let pagesProcessed = 0;
  let wordsAdded = 0;
  let masksAdded = 0;

  try {
    for (const pageNumber of targetPages) {
      const info = doc.pageInfo(pageNumber);
      const rotation = normalizeRotation(info.rotation);

      // The engine rasterises POST-rotation, so the image axes follow the
      // displayed page. Reconstruct the rasterised image dimensions.
      const displayedW = rotation === 90 || rotation === 270 ? info.height : info.width;
      const displayedH = rotation === 90 || rotation === 270 ? info.width : info.height;
      const ctx: PdfPlacementContext = {
        imageWidth: Math.round(displayedW * scale),
        imageHeight: Math.round(displayedH * scale),
        pageWidth: info.width,
        pageHeight: info.height,
        rotation,
      };

      // Rasterise once (POST-rotation): the SAME PNG feeds OCR recognition and
      // the background sampling, so image pixels align 1:1 with the word boxes.
      const png = doc.renderPage(pageNumber, scale);
      const words = await getOcrWords(png, model ? { model } : {});
      pagesProcessed += 1;

      const lines = groupWordsIntoLines(words);
      if (lines.length === 0) continue;

      // Decode the rendered page so we can sample backgrounds in pixels.
      // A decode failure is non-fatal: masks then fall back to white.
      const background = decodePage(giga, png);

      // 2a. Paint a background mask per line (BEFORE the text, so text is on top).
      for (const line of lines) {
        const pixelBox = unionWordBox(line);
        const pdfBox = ocrWordToPdfBox(pixelBox, ctx);
        if (pdfBox.w < 0.5 || pdfBox.h < 0.5) continue;

        const fill = sampleLineBackground(background, pdfBox, ctx) ?? WHITE_RGB;
        // Pad the mask by ~10% of its height so anti-aliased glyph fringes from
        // the scan are fully covered (kept tight enough not to eat neighbours).
        const pad = Math.min(pdfBox.h * 0.1, 1.5);
        if (
          doc.addRectangle(
            pageNumber,
            pdfBox.x - pad,
            pdfBox.y - pad,
            pdfBox.w + pad * 2,
            pdfBox.h + pad * 2,
            null,
            fill,
            0,
            1,
          )
        ) {
          masksAdded += 1;
        }
      }

      // 2b. Lay the real OCR text on top of the masks.
      const runs: { x: number; y: number; size: number; text: string; rotation: number }[] = [];
      for (const line of lines) {
        for (const word of line) {
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
      }
      if (runs.length > 0) {
        wordsAdded += doc.addTextLayer(pageNumber, runs);
      }
    }

    const bytes = doc.saveCompressed();

    engineLogger.info('ocr-editable: editable OCR text + background masks added', {
      pagesProcessed,
      wordsAdded,
      masksAdded,
      dpi,
      inputBytes: pdfBytes.byteLength,
      outputBytes: bytes.byteLength,
    });

    return { bytes, pagesProcessed, wordsAdded, masksAdded };
  } finally {
    doc.close();
  }
}

/** Decode a rendered page PNG to RGBA, or `null` if decoding fails. */
function decodePage(engine: GigaPdfEngine, png: Uint8Array): DecodedPage | null {
  try {
    const decoded = engine.decodePng(png);
    if (!decoded) return null;
    return { width: decoded.width, height: decoded.height, rgba: decoded.rgba };
  } catch {
    return null;
  }
}

/**
 * Sample a line's background colour: map its PDF-point bbox back into the decoded
 * image's pixels (honouring rotation) and read the perimeter ring. `null` when no
 * background image is available (decode failed) or no opaque sample is found.
 */
function sampleLineBackground(
  background: DecodedPage | null,
  pdfBox: { x: number; y: number; w: number; h: number },
  ctx: PdfPlacementContext,
): number | null {
  if (!background) return null;
  const rect = pdfBoxToImageRect(pdfBox, {
    imageWidth: background.width,
    imageHeight: background.height,
    pageWidth: ctx.pageWidth,
    pageHeight: ctx.pageHeight,
    rotation: ctx.rotation,
  });
  return sampleBackgroundColor(background, rect);
}
