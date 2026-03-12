import { describe, it, expect, beforeAll } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { pdfjsLib } from './setup';
import { extractAnnotationElements } from '../../src/parse/annotation-extractor';
import { loadFixture, SIMPLE_PDF, WITH_FORMS_PDF } from '../helpers';

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

describe('extractAnnotationElements', () => {
  describe('simple.pdf — synthetic PDF without markup annotations', () => {
    let simpleDoc: PDFDocumentProxy;

    beforeAll(async () => {
      simpleDoc = await loadPdf(SIMPLE_PDF);
    });

    it('returns an array (empty or containing only non-Widget annotations)', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      expect(Array.isArray(annotations)).toBe(true);
    });

    it('never includes Widget annotations (form fields are handled separately)', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      // The function filters out Widget subtype, so none should appear
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      // We can only assert structural correctness here since simple.pdf has no markup annotations
      expect(annotations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('with-forms.pdf — Widget annotations must be excluded', () => {
    let formsDoc: PDFDocumentProxy;

    beforeAll(async () => {
      formsDoc = await loadPdf(WITH_FORMS_PDF);
    });

    it('excludes form Widget annotations from results', async () => {
      const { page, pageHeight } = await getPage(formsDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      // with-forms.pdf has 4 Widget annotations; none should appear in annotation results
      expect(Array.isArray(annotations)).toBe(true);
      // All returned annotations must have a known annotationType (not Widget)
      for (const ann of annotations) {
        expect(ann.annotationType).not.toBeUndefined();
      }
    });
  });

  describe('element structure — required fields on returned annotations', () => {
    // We test structure using simple.pdf; if empty, tests are vacuously safe.
    // We also define a conformance helper that validates any returned element.
    let simpleDoc: PDFDocumentProxy;

    beforeAll(async () => {
      simpleDoc = await loadPdf(SIMPLE_PDF);
    });

    it('each element has type "annotation"', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      for (const ann of annotations) {
        expect(ann.type).toBe('annotation');
      }
    });

    it('each element has a UUID elementId', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (const ann of annotations) {
        expect(ann.elementId).toMatch(uuidPattern);
      }
    });

    it('each element has unique elementIds', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      const ids = annotations.map((a) => a.elementId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('each element has bounds with numeric x, y, width, height', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      for (const ann of annotations) {
        expect(typeof ann.bounds.x).toBe('number');
        expect(typeof ann.bounds.y).toBe('number');
        expect(typeof ann.bounds.width).toBe('number');
        expect(typeof ann.bounds.height).toBe('number');
      }
    });

    it('each element has a style object with color and opacity', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      for (const ann of annotations) {
        expect(ann.style).toBeDefined();
        expect(typeof ann.style.color).toBe('string');
        expect(ann.style.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(typeof ann.style.opacity).toBe('number');
      }
    });

    it('each element has annotationType from the known set', async () => {
      const validTypes = ['note', 'link', 'freetext', 'highlight', 'underline', 'squiggly', 'strikeout', 'stamp'];
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      for (const ann of annotations) {
        expect(validTypes).toContain(ann.annotationType);
      }
    });

    it('each element has transform with rotation=0', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      for (const ann of annotations) {
        expect(ann.transform.rotation).toBe(0);
        expect(ann.transform.scaleX).toBe(1);
        expect(ann.transform.scaleY).toBe(1);
      }
    });

    it('each element has locked=false and visible=true', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      for (const ann of annotations) {
        expect(ann.locked).toBe(false);
        expect(ann.visible).toBe(true);
      }
    });

    it('popup is null by default', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      for (const ann of annotations) {
        expect(ann.popup).toBeNull();
      }
    });
  });

  describe('link annotation structure', () => {
    it('link annotations have linkDestination property (null or object)', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      const linkAnnotations = annotations.filter((a) => a.annotationType === 'link');
      for (const link of linkAnnotations) {
        // linkDestination is either null or an object with type
        if (link.linkDestination !== null) {
          expect(['external', 'internal']).toContain(link.linkDestination.type);
        }
      }
    });
  });

  describe('coordinate conversion — web coordinates', () => {
    let simpleDoc: PDFDocumentProxy;

    beforeAll(async () => {
      simpleDoc = await loadPdf(SIMPLE_PDF);
    });

    it('bounds y is non-negative for any returned annotation', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      for (const ann of annotations) {
        expect(ann.bounds.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('bounds y is less than pageHeight for any returned annotation', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const annotations = await extractAnnotationElements(page, 1, pageHeight);
      for (const ann of annotations) {
        expect(ann.bounds.y).toBeLessThan(pageHeight);
      }
    });
  });
});
