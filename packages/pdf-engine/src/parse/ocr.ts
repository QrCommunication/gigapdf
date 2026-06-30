/**
 * Plain-text / hOCR extraction from scanned pages.
 *
 * Host-side OCR: each page is rasterised to a PNG by the main WASM engine
 * (`renderPage`) and the bitmap is recognised by the native OCR microservice
 * (see `../ocr-engine`). The service returns recognized lines in image pixel
 * space; this module joins them for `"text"` output or wraps them as minimal
 * hOCR for `"hocr"` output. Nothing leaves the host beyond the OCR service.
 */

import { getEngine } from '../wasm';
import { getOcrWords } from '../ocr-engine';

// The OCR service availability probe lives in `../ocr-engine`; re-export it so
// the public `./parse` surface (and the `/api/pdf/ocr` GET route) is unchanged.
export { isOcrAvailable } from '../ocr-engine';

export class OcrUnavailableError extends Error {
  constructor() {
    super('OCR engine unavailable');
    this.name = 'OcrUnavailableError';
  }
}

export interface OcrOptions {
  /** Pages to OCR (1-based). Defaults to all pages. */
  pages?: number[];
  /** Language string (kept for compatibility; the engine is script-based). */
  lang?: string;
  /** Render DPI: 144 (fast) or 300 (high quality). Defaults to 144. */
  dpi?: 144 | 200 | 300;
  /** Output format: "text" (plain) or "hocr" (with bboxes). */
  format?: 'text' | 'hocr';
}

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  /** Only present when format === 'hocr'. Minimal hOCR with word bboxes. */
  hocr?: string;
}

export interface OcrResult {
  pages: OcrPageResult[];
  /** Aggregated text for convenience (pages joined by double newline). */
  fullText: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function buildHocr(
  pageNumber: number,
  words: Array<{ text: string; x: number; y: number; w: number; h: number }>,
): string {
  const spans = words
    .map(
      (word) =>
        `<span class='ocrx_word' title='bbox ${Math.round(word.x)} ${Math.round(word.y)} ` +
        `${Math.round(word.x + word.w)} ${Math.round(word.y + word.h)}'>${escapeHtml(word.text)}</span>`,
    )
    .join(' ');
  return (
    `<div class='ocr_page' id='page_${pageNumber}'>` +
    `<p class='ocr_par'><span class='ocr_line'>${spans}</span></p></div>`
  );
}

export async function ocrPdf(pdfBytes: Uint8Array, options: OcrOptions = {}): Promise<OcrResult> {
  const { pages, dpi = 144, format = 'text' } = options;
  // Render at >= 2× so glyphs stay large enough for the recogniser even at 72dpi.
  const scale = Math.max(2, dpi / 72);

  const giga = await getEngine();
  const doc = giga.open(pdfBytes);
  try {
    const totalPages = doc.pageCount();
    const targetPages = pages
      ? pages.filter((p) => p >= 1 && p <= totalPages)
      : Array.from({ length: totalPages }, (_, i) => i + 1);

    const results: OcrPageResult[] = [];
    for (const pageNumber of targetPages) {
      // Rasterise the page to PNG (main engine) then recognise host-side.
      const png = doc.renderPage(pageNumber, scale);
      const words = await getOcrWords(png);
      const text = words.map((w) => w.text).join('\n').trim();
      results.push(format === 'hocr' ? { pageNumber, text, hocr: buildHocr(pageNumber, words) } : { pageNumber, text });
    }

    return {
      pages: results,
      fullText: results.map((r) => r.text).join('\n\n').trim(),
    };
  } finally {
    doc.close();
  }
}
