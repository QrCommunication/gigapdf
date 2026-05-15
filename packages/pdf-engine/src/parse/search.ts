/**
 * Full-text search in a PDF via MuPDF.
 *
 * MuPDF's `Page.search(needle, maxHits)` returns an array of quads
 * (4-corner bounding boxes in PDF user-space) for every match. Combined
 * with `StructuredText.search()` we get exact glyph quads instead of
 * approximated rectangles, ideal for frontend highlighting.
 *
 * The search is case-insensitive by default (MuPDF behaviour) and
 * supports Unicode normalisation (NFC/NFD identical hits).
 */

import { engineLogger } from '../utils/logger';

export interface SearchHit {
  pageNumber: number; // 1-based
  /** Match index within the page (0, 1, 2, ...). */
  matchIndex: number;
  /** Quads making up this match. Multi-quad happens on multi-line matches. */
  quads: Array<[number, number, number, number, number, number, number, number]>;
  /** Aggregate bounding rectangle [x0, y0, x1, y1] in PDF user-space. */
  bbox: [number, number, number, number];
}

export interface SearchOptions {
  /** Restrict to specific pages. Default: all pages. */
  pages?: number[];
  /** Max hits per page. Default: 500. */
  maxHitsPerPage?: number;
}

export interface SearchResult {
  needle: string;
  totalHits: number;
  pagesSearched: number;
  hits: SearchHit[];
}

export async function searchPdf(
  pdfBytes: Uint8Array,
  needle: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  if (!needle.trim()) {
    return { needle, totalHits: 0, pagesSearched: 0, hits: [] };
  }

  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');

  const totalPages = doc.countPages();
  const targetPages = options.pages
    ? options.pages.filter((p) => p >= 1 && p <= totalPages)
    : Array.from({ length: totalPages }, (_, i) => i + 1);

  const maxHits = options.maxHitsPerPage ?? 500;
  const hits: SearchHit[] = [];

  for (const pageNumber of targetPages) {
    const page = doc.loadPage(pageNumber - 1);
    const stext = page.toStructuredText();
    const pageHits = stext.search(needle, maxHits);

    for (let i = 0; i < pageHits.length; i++) {
      const quads = pageHits[i]!;
      // Aggregate bbox = enclosing rectangle of all quads in this match.
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const q of quads) {
        for (let k = 0; k < 8; k += 2) {
          const x = q[k]!;
          const y = q[k + 1]!;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      hits.push({
        pageNumber,
        matchIndex: i,
        quads,
        bbox: [minX, minY, maxX, maxY],
      });
    }
  }

  engineLogger.info('search: full-text search complete', {
    needle,
    totalHits: hits.length,
    pagesSearched: targetPages.length,
  });

  return {
    needle,
    totalHits: hits.length,
    pagesSearched: targetPages.length,
    hits,
  };
}
