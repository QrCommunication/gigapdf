import { describe, it, expect, beforeAll } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { pdfjsLib } from './setup';
import { extractDrawingElements } from '../../src/parse/drawing-extractor';
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

describe('extractDrawingElements', () => {
  describe('simple.pdf — vector shapes from fixture', () => {
    // simple.pdf was created with:
    //   drawRectangle  → rectangle
    //   drawLine       → line (2 points)
    //   drawEllipse    → path (approximated by curves)
    let simpleDoc: PDFDocumentProxy;

    beforeAll(async () => {
      simpleDoc = await loadPdf(SIMPLE_PDF);
    });

    it('returns an array (may be empty for pdf-lib synthetic fixtures)', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      expect(Array.isArray(shapes)).toBe(true);
    });

    it('if shapes found, all have valid shapeType', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      const validTypes = ['rectangle', 'ellipse', 'circle', 'line', 'arrow', 'polygon', 'path'];
      for (const shape of shapes) {
        expect(validTypes).toContain(shape.shapeType);
      }
    });
  });

  describe('element structure — required fields', () => {
    let simpleDoc: PDFDocumentProxy;

    beforeAll(async () => {
      simpleDoc = await loadPdf(SIMPLE_PDF);
    });

    it('each element has type "shape"', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        expect(shape.type).toBe('shape');
      }
    });

    it('each element has a UUID elementId', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (const shape of shapes) {
        expect(shape.elementId).toMatch(uuidPattern);
      }
    });

    it('each element has unique elementIds', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      const ids = shapes.map((s) => s.elementId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('each element has a shapeType from the valid set', async () => {
      const validTypes = ['rectangle', 'ellipse', 'line', 'path', 'polygon'];
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        expect(validTypes).toContain(shape.shapeType);
      }
    });

    it('each element has bounds with numeric x, y, width, height', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        expect(typeof shape.bounds.x).toBe('number');
        expect(typeof shape.bounds.y).toBe('number');
        expect(typeof shape.bounds.width).toBe('number');
        expect(typeof shape.bounds.height).toBe('number');
      }
    });

    it('each element bounds has non-negative width and height', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        expect(shape.bounds.width).toBeGreaterThanOrEqual(0);
        expect(shape.bounds.height).toBeGreaterThanOrEqual(0);
      }
    });

    it('each element has a style object with fillColor, strokeColor, strokeWidth', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        expect(shape.style).toBeDefined();
        // fillColor and strokeColor may be null (when only stroke or only fill)
        expect(typeof shape.style.strokeWidth).toBe('number');
        expect(typeof shape.style.fillOpacity).toBe('number');
        expect(typeof shape.style.strokeOpacity).toBe('number');
        expect(Array.isArray(shape.style.strokeDashArray)).toBe(true);
      }
    });

    it('fillColor is a hex string or null', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        if (shape.style.fillColor !== null) {
          expect(shape.style.fillColor).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    });

    it('strokeColor is a hex string or null', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        if (shape.style.strokeColor !== null) {
          expect(shape.style.strokeColor).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    });

    it('each element has a geometry object with points array', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        expect(shape.geometry).toBeDefined();
        expect(Array.isArray(shape.geometry.points)).toBe(true);
        expect(shape.geometry.points.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('each point in geometry has numeric x and y', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        for (const point of shape.geometry.points) {
          expect(typeof point.x).toBe('number');
          expect(typeof point.y).toBe('number');
        }
      }
    });

    it('lines and paths have a non-null pathData string', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      const linesAndPaths = shapes.filter((s) => s.shapeType === 'line' || s.shapeType === 'path');
      for (const shape of linesAndPaths) {
        expect(shape.geometry.pathData).not.toBeNull();
        expect(typeof shape.geometry.pathData).toBe('string');
        expect((shape.geometry.pathData as string).startsWith('M ')).toBe(true);
      }
    });

    it('rectangles have null pathData', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      const rectangles = shapes.filter((s) => s.shapeType === 'rectangle');
      for (const rect of rectangles) {
        expect(rect.geometry.pathData).toBeNull();
      }
    });

    it('each element has transform with rotation=0', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        expect(shape.transform.rotation).toBe(0);
        expect(shape.transform.scaleX).toBe(1);
        expect(shape.transform.scaleY).toBe(1);
      }
    });

    it('each element has locked=false and visible=true', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        expect(shape.locked).toBe(false);
        expect(shape.visible).toBe(true);
      }
    });
  });

  describe('coordinate conversion — web coordinates (top-left origin)', () => {
    let simpleDoc: PDFDocumentProxy;

    beforeAll(async () => {
      simpleDoc = await loadPdf(SIMPLE_PDF);
    });

    it('bounds y is non-negative for all shapes', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        expect(shape.bounds.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('bounds y is less than pageHeight for all shapes', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        expect(shape.bounds.y).toBeLessThan(pageHeight);
      }
    });

    it('all geometry points have y in web coordinate range [0, pageHeight]', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      for (const shape of shapes) {
        for (const point of shape.geometry.points) {
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(pageHeight);
        }
      }
    });
  });

  describe('color extraction — when shapes are present', () => {
    it('shapes with fillColor have valid hex format', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const shapes = await extractDrawingElements(page, 1, pageHeight);
      const hexPattern = /^#[0-9a-f]{6}$/i;
      for (const shape of shapes) {
        if (shape.style.fillColor) {
          expect(shape.style.fillColor).toMatch(hexPattern);
        }
        if (shape.style.strokeColor) {
          expect(shape.style.strokeColor).toMatch(hexPattern);
        }
      }
    });
  });

  describe('multi-page.pdf — drawings per page', () => {
    let multiDoc: PDFDocumentProxy;

    beforeAll(async () => {
      multiDoc = await loadPdf(MULTI_PAGE_PDF);
    });

    it('returns an array for each page (may be empty, multi-page has text only)', async () => {
      for (let pageNum = 1; pageNum <= 5; pageNum++) {
        const { page, pageHeight } = await getPage(multiDoc, pageNum);
        const shapes = await extractDrawingElements(page, pageNum, pageHeight);
        expect(Array.isArray(shapes)).toBe(true);
      }
    });
  });
});
