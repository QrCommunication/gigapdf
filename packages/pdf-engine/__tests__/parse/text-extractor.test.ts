import { describe, it, expect, beforeAll } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { pdfjsLib } from './setup';
import { extractTextElements } from '../../src/parse/text-extractor';
import { loadFixture, SIMPLE_PDF, MULTI_PAGE_PDF } from '../helpers';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadPdf(name: string): Promise<PDFDocumentProxy> {
  const data = loadFixture(name);
  return pdfjsLib.getDocument({ data }).promise;
}

async function getPage(doc: PDFDocumentProxy, pageNumber: number): Promise<{ page: PDFPageProxy; pageHeight: number }> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return { page, pageHeight: viewport.height };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('extractTextElements', () => {
  let simpleDoc: PDFDocumentProxy;

  beforeAll(async () => {
    simpleDoc = await loadPdf(SIMPLE_PDF);
  });

  describe('simple.pdf page 1 — content extraction', () => {
    it('returns at least two text elements from page 1', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      expect(elements.length).toBeGreaterThanOrEqual(2);
    });

    it('finds the "Hello GigaPDF Test" string', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      const contents = elements.map((el) => el.content);
      expect(contents.some((c) => c.includes('Hello GigaPDF Test'))).toBe(true);
    });

    it('finds the "Second line of text" string', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      const contents = elements.map((el) => el.content);
      expect(contents.some((c) => c.includes('Second line of text'))).toBe(true);
    });

    it('does not include blank-only strings', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.content.trim()).not.toBe('');
      }
    });
  });

  describe('element structure — required fields', () => {
    it('every element has type "text"', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.type).toBe('text');
      }
    });

    it('every element has a UUID elementId', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (const el of elements) {
        expect(el.elementId).toMatch(uuidPattern);
      }
    });

    it('every element has unique elementIds (no duplicates)', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      const ids = elements.map((el) => el.elementId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every element has a bounds object with numeric x, y, width, height', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(typeof el.bounds.x).toBe('number');
        expect(typeof el.bounds.y).toBe('number');
        expect(typeof el.bounds.width).toBe('number');
        expect(typeof el.bounds.height).toBe('number');
      }
    });

    it('every element has a style object with fontFamily, fontSize, and color', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.style).toBeDefined();
        expect(typeof el.style.fontFamily).toBe('string');
        expect(el.style.fontFamily.length).toBeGreaterThan(0);
        expect(typeof el.style.fontSize).toBe('number');
        expect(el.style.fontSize).toBeGreaterThan(0);
        expect(typeof el.style.color).toBe('string');
      }
    });

    it('every element has a transform with rotation=0', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.transform.rotation).toBe(0);
        expect(el.transform.scaleX).toBe(1);
        expect(el.transform.scaleY).toBe(1);
      }
    });

    it('every element has locked=false and visible=true', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.locked).toBe(false);
        expect(el.visible).toBe(true);
      }
    });
  });

  describe('coordinate conversion — web coordinates (top-left origin)', () => {
    it('y coordinate is non-negative (top-left origin, not PDF bottom-left)', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        // In web coords: y >= 0
        expect(el.bounds.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('y coordinate is less than pageHeight', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.bounds.y).toBeLessThan(pageHeight);
      }
    });

    it('"Hello GigaPDF Test" appears above "Second line of text" (smaller y)', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);

      const firstLine = elements.find((el) => el.content.includes('Hello GigaPDF Test'));
      const secondLine = elements.find((el) => el.content.includes('Second line of text'));

      // Both must be found
      expect(firstLine).toBeDefined();
      expect(secondLine).toBeDefined();

      // In web coords (top-left origin), the first line has a smaller y value
      expect(firstLine!.bounds.y).toBeLessThan(secondLine!.bounds.y);
    });

    it('"Hello GigaPDF Test" has a larger font size than "Second line of text"', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);

      const heading = elements.find((el) => el.content.includes('Hello GigaPDF Test'));
      const body = elements.find((el) => el.content.includes('Second line of text'));

      expect(heading).toBeDefined();
      expect(body).toBeDefined();
      // fixture uses size=24 for heading, 14 for body
      expect(heading!.style.fontSize).toBeGreaterThan(body!.style.fontSize);
    });
  });

  describe('style defaults', () => {
    it('color defaults to "#000000"', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      // At least one element should have the default black color
      const blackEl = elements.find((el) => el.style.color === '#000000');
      expect(blackEl).toBeDefined();
    });

    it('textAlign defaults to "left"', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.style.textAlign).toBe('left');
      }
    });

    it('writingMode defaults to "horizontal-tb"', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.style.writingMode).toBe('horizontal-tb');
      }
    });

    it('underline and strikethrough default to false', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.style.underline).toBe(false);
        expect(el.style.strikethrough).toBe(false);
      }
    });

    it('ocrConfidence is null (no OCR on synthetic PDFs)', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.ocrConfidence).toBeNull();
      }
    });

    it('linkUrl and linkPage are null by default', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      for (const el of elements) {
        expect(el.linkUrl).toBeNull();
        expect(el.linkPage).toBeNull();
      }
    });
  });

  describe('multi-page.pdf — per-page extraction', () => {
    let multiDoc: PDFDocumentProxy;

    beforeAll(async () => {
      multiDoc = await loadPdf(MULTI_PAGE_PDF);
    });

    it('extracts "Page 1" text from page 1', async () => {
      const { page, pageHeight } = await getPage(multiDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      const contents = elements.map((el) => el.content).join(' ');
      expect(contents).toContain('Page 1');
    });

    it('extracts "Page 3" text from page 3', async () => {
      const { page, pageHeight } = await getPage(multiDoc, 3);
      const elements = await extractTextElements(page, 3, pageHeight);
      const contents = elements.map((el) => el.content).join(' ');
      expect(contents).toContain('Page 3');
    });

    it('page 1 does not contain "Page 2" text', async () => {
      const { page, pageHeight } = await getPage(multiDoc, 1);
      const elements = await extractTextElements(page, 1, pageHeight);
      const contents = elements.map((el) => el.content).join(' ');
      expect(contents).not.toContain('Page 2');
    });

    it('passes pageNumber as second argument without affecting output structure', async () => {
      const { page, pageHeight } = await getPage(multiDoc, 2);
      // _pageNumber is unused in implementation but we verify the call contract
      const elements = await extractTextElements(page, 2, pageHeight);
      expect(Array.isArray(elements)).toBe(true);
    });
  });
});
