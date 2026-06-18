/**
 * Structured text extraction via the WASM engine (`@qrcommunication/gigapdf-lib`).
 *
 * Native engine path. The engine returns reading-order lines with
 * bounding boxes per page; we expose them through the same `StructuredPage`
 * shape the callers already use (one text block per page, line-level granularity
 * — per-character quads are not emitted).
 */

import { getEngine } from '../wasm';
import { engineLogger } from '../utils/logger';

export interface StructuredChar {
  /** Unicode character. */
  c: string;
  /** Glyph origin point [x, y] in PDF user-space. */
  origin: [number, number];
  /** Quad: 4 corners of the glyph bounding box [x0,y0, x1,y1, x2,y2, x3,y3]. */
  quad: [number, number, number, number, number, number, number, number];
  /** Font size (effective, post-matrix). */
  size: number;
  /** Resolved font family name. */
  fontFamily: string;
  /** Colour in [0, 1] range — single channel (gray), 3 (RGB) or 4 (CMYK). */
  color: number[];
}

export interface StructuredLine {
  bbox: [number, number, number, number];
  /** Writing mode: 0 = horizontal, 1 = vertical. */
  wmode: number;
  chars: StructuredChar[];
  /** Aggregated text content for convenience. */
  text: string;
}

export interface StructuredBlock {
  type: 'text' | 'image';
  bbox: [number, number, number, number];
  /** Text blocks only. */
  lines?: StructuredLine[];
}

export interface StructuredPage {
  pageNumber: number; // 1-based
  width: number;
  height: number;
  blocks: StructuredBlock[];
}

export interface ExtractStructuredTextOptions {
  /** Restrict extraction to specific 1-based page numbers. */
  pages?: number[];
}

function targetPageNumbers(total: number, pages?: number[]): number[] {
  return pages
    ? pages.filter((p) => p >= 1 && p <= total)
    : Array.from({ length: total }, (_, i) => i + 1);
}

export async function extractStructuredText(
  pdfBytes: Uint8Array,
  options: ExtractStructuredTextOptions = {},
): Promise<StructuredPage[]> {
  const giga = await getEngine();
  const doc = giga.open(pdfBytes);
  try {
    const results: StructuredPage[] = targetPageNumbers(doc.pageCount(), options.pages).map(
      (pageNumber) => {
        const lines = doc.structuredText(pageNumber);
        const sLines: StructuredLine[] = lines.map((l) => ({
          bbox: [l.x, l.y, l.x + l.w, l.y + l.h],
          wmode: 0,
          chars: [],
          text: l.text,
        }));
        const width = lines.reduce((m, l) => Math.max(m, l.x + l.w), 0);
        const height = lines.reduce((m, l) => Math.max(m, l.y + l.h), 0);
        return {
          pageNumber,
          width,
          height,
          blocks: sLines.length
            ? [{ type: 'text', bbox: [0, 0, width, height], lines: sLines }]
            : [],
        };
      },
    );

    engineLogger.info('structured-text: extracted', {
      pages: results.length,
      totalBlocks: results.reduce((s, p) => s + p.blocks.length, 0),
    });
    return results;
  } finally {
    doc.close();
  }
}

/** Plain text per page, lines joined with newlines. */
export async function extractPlainText(
  pdfBytes: Uint8Array,
  options: { pages?: number[] } = {},
): Promise<Array<{ pageNumber: number; text: string }>> {
  const giga = await getEngine();
  const doc = giga.open(pdfBytes);
  try {
    return targetPageNumbers(doc.pageCount(), options.pages).map((pageNumber) => ({
      pageNumber,
      text: doc
        .structuredText(pageNumber)
        .map((l) => l.text)
        .join('\n'),
    }));
  } finally {
    doc.close();
  }
}
