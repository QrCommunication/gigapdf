/**
 * Parity guard: the native lib's text extraction (`structuredText`) must capture
 * the same text *content* as pdfjs (`extractTextElements`) across diverse
 * fixtures (embedded fonts, CID/CJK, RTL, rotation, tables). This pins the
 * content-completeness invariant that lets the lib replace pdfjs for text
 * extraction — positions are validated separately (the lib also renders the
 * background, so overlay + background share one coordinate engine).
 *
 * It asserts character-set completeness (order-independent): every character
 * pdfjs sees, the lib sees too. It does NOT assert run granularity or intra-line
 * order, which legitimately differ (lib groups runs into lines; table cell order
 * can differ) without losing any text.
 */
import { describe, it, expect } from 'vitest';
import { pdfjsLib } from './setup';
import { extractTextElements } from '../../src/parse/text-extractor';
import { loadFixture } from '../helpers';
import { getEngine } from '../../src/wasm';

const FIXTURES = [
  'simple.pdf',
  'simple-text.pdf',
  'mixed-fonts.pdf',
  'multi-page.pdf',
  'embedded-fonts.pdf',
  'cjk-text.pdf',
  'rtl-text.pdf',
  'table-grid.pdf',
  'rotated-pages.pdf',
  'three-page-one-text.pdf',
];

const norm = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

describe('text extraction parity: pdfjs vs lib structuredText', () => {
  for (const name of FIXTURES) {
    it(`captures all pdfjs text content — ${name}`, async () => {
      const data = loadFixture(name);
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
      const giga = await getEngine();
      const ldoc = giga.open(new Uint8Array(data));
      try {
        const pages = Math.min(doc.numPages, 3);
        for (let p = 1; p <= pages; p++) {
          const page = await doc.getPage(p);
          const vp = page.getViewport({ scale: 1 });
          const pdfjsEls = await extractTextElements(page, p, vp.height);
          const libLines = ldoc.structuredText(p);

          const pdfjsChars = new Set(norm(pdfjsEls.map((e) => e.content).join('')));
          const libChars = new Set(norm(libLines.map((l) => l.text).join('')));

          // Every character pdfjs extracts must also be extracted by the lib.
          const missing = [...pdfjsChars].filter((c) => !libChars.has(c));
          expect(missing, `page ${p} chars only in pdfjs: ${missing.join('')}`).toEqual([]);
        }
      } finally {
        ldoc.close();
      }
    });
  }
});
