/**
 * Structured text extraction via MuPDF — preserves layout (blocks → lines
 * → chars), bounding boxes, font metadata, and reading order.
 *
 * The legacy approach in `text-extractor.ts` uses pdfjs `getTextContent()`
 * which returns a flat list of text runs without layout grouping. Tables
 * collapse into single lines, multi-column layouts get scrambled, and
 * justified text loses line boundaries.
 *
 * MuPDF's `Page.toStructuredText()` returns a tree with:
 *   - Blocks (text vs image), each with a bbox
 *   - Lines inside each text block, with writing-mode + direction
 *   - Characters with origin point, font, size, quad, colour
 *
 * Use cases:
 *   - Better xlsx export (columns / rows correctly aligned)
 *   - OCR-ready output for downstream pipelines
 *   - In-PDF search hit highlighting (`StructuredText.search(needle)`
 *     returns the matched quads directly)
 *   - Reading-order preservation for accessibility / TTS
 */

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
  /** MuPDF stext options passed through (e.g. "preserve-ligatures"). */
  mupdfOptions?: string;
}

export async function extractStructuredText(
  pdfBytes: Uint8Array,
  options: ExtractStructuredTextOptions = {},
): Promise<StructuredPage[]> {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');

  const totalPages = doc.countPages();
  const targetPages = options.pages
    ? options.pages.filter((p) => p >= 1 && p <= totalPages)
    : Array.from({ length: totalPages }, (_, i) => i + 1);

  const results: StructuredPage[] = [];

  for (const pageNumber of targetPages) {
    const page = doc.loadPage(pageNumber - 1);
    const bounds = page.getBounds();
    const stext = page.toStructuredText(options.mupdfOptions);

    const blocks: StructuredBlock[] = [];
    let currentLine: StructuredLine | null = null;
    let currentBlock: StructuredBlock | null = null;
    let currentText = '';

    stext.walk({
      beginTextBlock(bbox) {
        currentBlock = {
          type: 'text',
          bbox: bbox as [number, number, number, number],
          lines: [],
        };
      },
      endTextBlock() {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = null;
      },
      beginLine(bbox, wmode) {
        currentLine = {
          bbox: bbox as [number, number, number, number],
          wmode,
          chars: [],
          text: '',
        };
        currentText = '';
      },
      endLine() {
        if (currentLine && currentBlock?.lines) {
          currentLine.text = currentText;
          currentBlock.lines.push(currentLine);
        }
        currentLine = null;
        currentText = '';
      },
      onChar(c, origin, font, size, quad, color) {
        if (!currentLine) return;
        currentLine.chars.push({
          c,
          origin: [origin[0], origin[1]],
          quad: quad as [number, number, number, number, number, number, number, number],
          size,
          fontFamily: font.getName?.() ?? 'unknown',
          color: Array.isArray(color) ? Array.from(color) : [],
        });
        currentText += c;
      },
      onImageBlock(bbox) {
        blocks.push({
          type: 'image',
          bbox: bbox as [number, number, number, number],
        });
      },
    });

    results.push({
      pageNumber,
      width: bounds[2] - bounds[0],
      height: bounds[3] - bounds[1],
      blocks,
    });
  }

  engineLogger.info('structured-text: extracted', {
    pages: results.length,
    totalBlocks: results.reduce((s, p) => s + p.blocks.length, 0),
  });

  return results;
}

/**
 * Faster shortcut when callers just want the plain text per page —
 * goes through `StructuredText.asText()` which preserves line breaks
 * (newlines between lines, double newlines between blocks) better
 * than pdfjs string concat.
 */
export async function extractPlainText(
  pdfBytes: Uint8Array,
  options: { pages?: number[] } = {},
): Promise<Array<{ pageNumber: number; text: string }>> {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');

  const totalPages = doc.countPages();
  const targetPages = options.pages
    ? options.pages.filter((p) => p >= 1 && p <= totalPages)
    : Array.from({ length: totalPages }, (_, i) => i + 1);

  return targetPages.map((pageNumber) => {
    const page = doc.loadPage(pageNumber - 1);
    const stext = page.toStructuredText();
    return { pageNumber, text: stext.asText() };
  });
}
