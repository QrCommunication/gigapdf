/**
 * On-demand OCR block extraction for semantic indexing (#85).
 *
 * Unlike {@link makeSearchablePdf} (which bakes an invisible text layer into the
 * PDF), this returns the recognized words as structured blocks with bounding
 * boxes in PDF user space (points, bottom-left origin, y up) — the shape the
 * backend ingestion endpoint expects:
 *
 *   POST /api/v1/storage/documents/{id}/ocr-blocks
 *   body: { blocks: [{ page, bbox: { x, y, w, h }, text }] }
 *
 * The pixel→point geometry mirrors {@link ocrWordToPdfPlacement} exactly (same
 * `/Rotate` handling, same `scale = displayedWidthPt / imageWidthPx`), but
 * produces the FULL word box (x, y, w, h) rather than a baseline placement,
 * because search highlighting needs the visual rectangle, not a draw anchor.
 *
 * Words are grouped per source line (the engine returns words top-to-bottom,
 * left-to-right) so a single block carries a readable phrase rather than a
 * fragmented per-word token — better embeddings, fewer rows, tighter snippets.
 */

import { getEngine } from '../wasm';
import { engineLogger } from '../utils/logger';
import type { OcrWordBox, PdfPlacementContext } from './ocr-searchable';

/** One OCR block: text + bounding box in PDF points (bottom-left origin, y up). */
export interface OcrBlock {
  /** 1-based page number this block was recognized on. */
  page: number;
  /** Recognized text for the block (a line or a single word). */
  text: string;
  /** Bounding box in PDF user space (points). x/y = lower-left corner. */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface ExtractOcrBlocksOptions {
  /** Pages to OCR (1-based). Defaults to all pages. */
  pages?: number[];
  /** Render DPI for the OCR rasterisation. 144 (fast) | 200 | 300. Defaults to 144. */
  dpi?: 144 | 200 | 300;
  /**
   * Grouping granularity. `"line"` (default) merges words that share a text
   * line into one block; `"word"` emits one block per recognized word.
   */
  granularity?: 'line' | 'word';
}

export interface ExtractOcrBlocksResult {
  blocks: OcrBlock[];
  /** Number of pages that went through OCR. */
  pagesProcessed: number;
}

/** Normalise a rotation angle to 0|90|180|270. */
function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const wrapped = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return (wrapped === 90 || wrapped === 180 || wrapped === 270 ? wrapped : 0) as
    | 0
    | 90
    | 180
    | 270;
}

/**
 * Convert an OCR word bbox (image pixels, top-left origin, y down) into the FULL
 * word rectangle in PDF user space (points, bottom-left origin, y up), honouring
 * the page `/Rotate` flag. Pure — unit-tested with inline fixtures.
 *
 * The four image corners are mapped to user space and the axis-aligned bounding
 * box of the result is returned, so the rectangle is always valid (non-negative
 * w/h) regardless of rotation.
 */
export function ocrWordToPdfBox(
  word: OcrWordBox,
  ctx: PdfPlacementContext,
): { x: number; y: number; w: number; h: number } {
  const displayedWidth =
    ctx.rotation === 90 || ctx.rotation === 270 ? ctx.pageHeight : ctx.pageWidth;
  const scale = displayedWidth / ctx.imageWidth;

  // The two opposite image corners (px, py) in image space.
  const leftPx = word.left;
  const rightPx = word.left + word.width;
  const topPx = word.top;
  const bottomPx = word.top + word.height;

  // Map an image-space point to PDF user space for the given rotation.
  const toUser = (px: number, py: number): { x: number; y: number } => {
    switch (ctx.rotation) {
      case 90:
        return { x: py * scale, y: px * scale };
      case 180:
        return { x: ctx.pageWidth - px * scale, y: py * scale };
      case 270:
        return { x: ctx.pageWidth - py * scale, y: ctx.pageHeight - px * scale };
      default:
        return { x: px * scale, y: ctx.pageHeight - py * scale };
    }
  };

  const corners = [
    toUser(leftPx, topPx),
    toUser(rightPx, topPx),
    toUser(rightPx, bottomPx),
    toUser(leftPx, bottomPx),
  ];

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Inverse of {@link ocrWordToPdfBox}: map a PDF-point bounding box (lower-left
 * origin, y up) back into the RENDERED image's pixel rectangle (top-left origin,
 * y down), honouring the page `/Rotate` flag.
 *
 * Used to highlight a semantic-search hit's bbox over a rasterised page preview:
 * the search result carries the bbox in PDF points, the preview is the page
 * rendered at some scale, and this returns the rect (px) to overlay.
 *
 * Pure — unit-tested with inline fixtures.
 */
export function pdfBoxToImageRect(
  box: { x: number; y: number; w: number; h: number },
  ctx: {
    /** Rendered image width in pixels (post-rotation, as displayed). */
    imageWidth: number;
    /** Rendered image height in pixels (post-rotation, as displayed). */
    imageHeight: number;
    /** Page width in PDF points (UNrotated MediaBox). */
    pageWidth: number;
    /** Page height in PDF points (UNrotated MediaBox). */
    pageHeight: number;
    /** Page /Rotate flag. */
    rotation: 0 | 90 | 180 | 270;
  },
): { left: number; top: number; width: number; height: number } {
  const displayedWidth =
    ctx.rotation === 90 || ctx.rotation === 270 ? ctx.pageHeight : ctx.pageWidth;
  // pixels-per-point. ocrWordToPdfBox uses s = displayedWidth/imageWidth
  // (points-per-pixel) and computes user = pixel·s; the inverse multiplies
  // points by `pxPerPt = imageWidth/displayedWidth = 1/s`.
  const pxPerPt = ctx.imageWidth / displayedWidth;

  // Map a PDF user-space point (ux, uy) back to image pixels (px, py), the exact
  // inverse of the toUser() map in ocrWordToPdfBox.
  const toImage = (ux: number, uy: number): { px: number; py: number } => {
    switch (ctx.rotation) {
      case 90:
        // user (py·s, px·s) → image (uy·pxPerPt, ux·pxPerPt)
        return { px: uy * pxPerPt, py: ux * pxPerPt };
      case 180:
        // user (W − px·s, py·s) → image ((W − ux)·pxPerPt, uy·pxPerPt)
        return { px: (ctx.pageWidth - ux) * pxPerPt, py: uy * pxPerPt };
      case 270:
        // user (W − py·s, H − px·s) → image ((H − uy)·pxPerPt, (W − ux)·pxPerPt)
        return {
          px: (ctx.pageHeight - uy) * pxPerPt,
          py: (ctx.pageWidth - ux) * pxPerPt,
        };
      default:
        // user (px·s, H − py·s) → image (ux·pxPerPt, (H − uy)·pxPerPt)
        return { px: ux * pxPerPt, py: (ctx.pageHeight - uy) * pxPerPt };
    }
  };

  const corners = [
    toImage(box.x, box.y),
    toImage(box.x + box.w, box.y),
    toImage(box.x + box.w, box.y + box.h),
    toImage(box.x, box.y + box.h),
  ];
  const pxs = corners.map((c) => c.px);
  const pys = corners.map((c) => c.py);
  const minPx = Math.min(...pxs);
  const maxPx = Math.max(...pxs);
  const minPy = Math.min(...pys);
  const maxPy = Math.max(...pys);

  return { left: minPx, top: minPy, width: maxPx - minPx, height: maxPy - minPy };
}

/** Engine OCR word: text + pixel bbox (top-left origin, y down). */
interface EngineOcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Merge a page's recognized words into line blocks. Words are grouped when
 * their vertical centres fall within ~60% of the median word height of each
 * other (a simple, robust line clustering for left-to-right scripts). Within a
 * line, words keep their reading order and the block bbox is their union.
 */
function groupWordsIntoLines(
  words: EngineOcrWord[],
  ctx: PdfPlacementContext,
  pageNumber: number,
): OcrBlock[] {
  const nonEmpty = words.filter((w) => w.text.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  const heights = nonEmpty.map((w) => w.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] ?? 1;
  const lineTolerancePx = Math.max(medianH * 0.6, 1);

  // Sort top-to-bottom, then left-to-right (image coords: y down, x right).
  const sorted = [...nonEmpty].sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: EngineOcrWord[][] = [];
  for (const word of sorted) {
    const centreY = word.y + word.h / 2;
    const line = lines.find((group) => {
      const ref = group[group.length - 1]!;
      const refCentreY = ref.y + ref.h / 2;
      return Math.abs(centreY - refCentreY) <= lineTolerancePx;
    });
    if (line) line.push(word);
    else lines.push([word]);
  }

  const blocks: OcrBlock[] = [];
  for (const line of lines) {
    const ordered = [...line].sort((a, b) => a.x - b.x);
    const text = ordered
      .map((w) => w.text.trim())
      .filter(Boolean)
      .join(' ');
    if (text.length === 0) continue;

    // Union of word pixel boxes for the line, then convert once to points.
    const left = Math.min(...ordered.map((w) => w.x));
    const top = Math.min(...ordered.map((w) => w.y));
    const right = Math.max(...ordered.map((w) => w.x + w.w));
    const bottom = Math.max(...ordered.map((w) => w.y + w.h));
    const bbox = ocrWordToPdfBox(
      { left, top, width: right - left, height: bottom - top },
      ctx,
    );
    if (bbox.w < 0.5 || bbox.h < 0.5) continue;
    blocks.push({ page: pageNumber, text, bbox });
  }
  return blocks;
}

/** Emit one block per recognized word (no line grouping). */
function wordsToBlocks(
  words: EngineOcrWord[],
  ctx: PdfPlacementContext,
  pageNumber: number,
): OcrBlock[] {
  const blocks: OcrBlock[] = [];
  for (const word of words) {
    const text = word.text.trim();
    if (text.length === 0) continue;
    const bbox = ocrWordToPdfBox(
      { left: word.x, top: word.y, width: word.w, height: word.h },
      ctx,
    );
    if (bbox.w < 0.5 || bbox.h < 0.5) continue;
    blocks.push({ page: pageNumber, text, bbox });
  }
  return blocks;
}

/**
 * OCR the requested pages and return text blocks with PDF-point bounding boxes,
 * ready to POST to the semantic-index ingestion endpoint.
 *
 * Runs entirely in WebAssembly (offline CNN, no external binary). Page selection
 * is explicit via `options.pages`; pass a single page for on-demand per-page OCR
 * from the editor.
 */
export async function extractOcrBlocks(
  pdfBytes: Uint8Array,
  options: ExtractOcrBlocksOptions = {},
): Promise<ExtractOcrBlocksResult> {
  const { pages, dpi = 144, granularity = 'line' } = options;
  const scale = dpi / 72;

  const giga = await getEngine();
  const doc = giga.open(pdfBytes);

  const blocks: OcrBlock[] = [];
  let pagesProcessed = 0;

  try {
    const totalPages = doc.pageCount();
    const targetPages = pages
      ? pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= totalPages)
      : Array.from({ length: totalPages }, (_, i) => i + 1);

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

      const words = doc.ocr(pageNumber, scale) as EngineOcrWord[];
      pagesProcessed += 1;

      const pageBlocks =
        granularity === 'word'
          ? wordsToBlocks(words, ctx, pageNumber)
          : groupWordsIntoLines(words, ctx, pageNumber);
      blocks.push(...pageBlocks);
    }

    engineLogger.info('ocr-blocks: extracted OCR blocks', {
      pagesProcessed,
      blocks: blocks.length,
      dpi,
      granularity,
    });

    return { blocks, pagesProcessed };
  } finally {
    doc.close();
  }
}
