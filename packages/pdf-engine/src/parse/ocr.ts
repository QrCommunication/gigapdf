/**
 * OCR via the WASM engine's built-in recognizer (`@qrcommunication/gigapdf-lib`).
 *
 * Native engine path: OCR now runs
 * entirely in WebAssembly (offline-trained CNN), so there is no external binary
 * to install and nothing leaves the process. The public API is unchanged; the
 * `Tesseract*`/`isTesseractAvailable` names are kept for caller compatibility.
 */

import { getEngine } from '../wasm';

export class TesseractNotInstalledError extends Error {
  constructor() {
    super('OCR engine unavailable');
    this.name = 'TesseractNotInstalledError';
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

/** The WASM OCR engine is always available (no system dependency). */
export async function isTesseractAvailable(): Promise<boolean> {
  return true;
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
  const scale = Math.max(2, dpi / 72);

  const giga = await getEngine();
  const doc = giga.open(pdfBytes);
  try {
    const totalPages = doc.pageCount();
    const targetPages = pages
      ? pages.filter((p) => p >= 1 && p <= totalPages)
      : Array.from({ length: totalPages }, (_, i) => i + 1);

    const results: OcrPageResult[] = targetPages.map((pageNumber) => {
      if (format === 'hocr') {
        const words = doc.ocr(pageNumber, scale);
        return {
          pageNumber,
          text: words.map((w) => w.text).join(' '),
          hocr: buildHocr(pageNumber, words),
        };
      }
      return { pageNumber, text: doc.ocrText(pageNumber, scale).trim() };
    });

    return {
      pages: results,
      fullText: results.map((r) => r.text).join('\n\n').trim(),
    };
  } finally {
    doc.close();
  }
}
