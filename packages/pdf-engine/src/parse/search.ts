/**
 * Full-text search in a PDF via the WASM engine (`@qrcommunication/gigapdf-lib`).
 *
 * The engine returns, per match, the matched text and its bounding box in PDF
 * user-space. We expose the same `SearchResult` shape used by the callers (one
 * synthesized quad per match — the engine reports rectangles, not glyph quads).
 */

import { getEngine } from '../wasm';
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

  const giga = await getEngine();
  const doc = giga.open(pdfBytes);
  try {
    const totalPages = doc.pageCount();
    const allow = options.pages
      ? new Set(options.pages.filter((p) => p >= 1 && p <= totalPages))
      : null;
    const maxHits = options.maxHitsPerPage ?? 500;

    const perPage = new Map<number, number>();
    const hits: SearchHit[] = [];
    for (const m of doc.search(needle, true)) {
      if (allow && !allow.has(m.page)) continue;
      const matchIndex = perPage.get(m.page) ?? 0;
      if (matchIndex >= maxHits) continue;
      perPage.set(m.page, matchIndex + 1);
      const x0 = m.x;
      const y0 = m.y;
      const x1 = m.x + m.w;
      const y1 = m.y + m.h;
      hits.push({
        pageNumber: m.page,
        matchIndex,
        quads: [[x0, y0, x1, y0, x1, y1, x0, y1]],
        bbox: [x0, y0, x1, y1],
      });
    }

    const pagesSearched = allow ? allow.size : totalPages;
    engineLogger.info('search: full-text search complete', {
      needle,
      totalHits: hits.length,
      pagesSearched,
    });
    return { needle, totalHits: hits.length, pagesSearched, hits };
  } finally {
    doc.close();
  }
}
