import { describe, it, expect } from 'vitest';
import type { ShapeElement } from '@giga-pdf/types';
import { extractDrawingElements } from '../../src/parse/drawing-extractor';
import { loadFixture, SIMPLE_PDF, MULTI_PAGE_PDF } from '../helpers';

// The native engine reads vector paths straight from the PDF bytes (no pdfjs);
// geometry comes back in web coordinates (top-left origin) Y-flipped per page.
async function shapes(name: string, pageNumber = 1): Promise<ShapeElement[]> {
  return extractDrawingElements(loadFixture(name), pageNumber);
}

const VALID_TYPES = ['rectangle', 'ellipse', 'circle', 'line', 'arrow', 'polygon', 'path'];
const HEX = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('extractDrawingElements (native engine)', () => {
  describe('simple.pdf — vector shapes from fixture (rect + line + ellipse)', () => {
    it('finds at least one painted shape', async () => {
      // simple.pdf is drawn with drawRectangle / drawLine / drawEllipse.
      expect((await shapes(SIMPLE_PDF)).length).toBeGreaterThan(0);
    });

    it('every shape is well-formed', async () => {
      // US-Letter fixtures are 792 pt tall.
      for (const shape of await shapes(SIMPLE_PDF)) {
        expect(shape.type).toBe('shape');
        expect(shape.elementId).toMatch(UUID);
        expect(VALID_TYPES).toContain(shape.shapeType);

        expect(typeof shape.bounds.x).toBe('number');
        expect(typeof shape.bounds.y).toBe('number');
        expect(shape.bounds.width).toBeGreaterThan(0);
        expect(shape.bounds.height).toBeGreaterThan(0);
        expect(shape.bounds.y).toBeGreaterThanOrEqual(0);
        expect(shape.bounds.y).toBeLessThan(792);

        expect(typeof shape.style.strokeWidth).toBe('number');
        expect(typeof shape.style.fillOpacity).toBe('number');
        expect(typeof shape.style.strokeOpacity).toBe('number');
        expect(Array.isArray(shape.style.strokeDashArray)).toBe(true);
        if (shape.style.fillColor !== null) expect(shape.style.fillColor).toMatch(HEX);
        if (shape.style.strokeColor !== null) expect(shape.style.strokeColor).toMatch(HEX);

        expect(Array.isArray(shape.geometry.points)).toBe(true);
        expect(shape.geometry.points.length).toBeGreaterThanOrEqual(2);
        for (const p of shape.geometry.points) {
          expect(typeof p.x).toBe('number');
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(792);
        }
        // pathData is the SVG path in web coords, always anchored with a move.
        expect(typeof shape.geometry.pathData).toBe('string');
        expect(shape.geometry.pathData.startsWith('M ')).toBe(true);

        expect(shape.transform.rotation).toBe(0);
        expect(shape.transform.scaleX).toBe(1);
        expect(shape.locked).toBe(false);
        expect(shape.visible).toBe(true);
      }
    });

    it('shape elementIds are unique', async () => {
      const ids = (await shapes(SIMPLE_PDF)).map((s) => s.elementId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('a filled shape reports a fill colour + fill opacity', async () => {
      const filled = (await shapes(SIMPLE_PDF)).filter((s) => s.style.fillColor !== null);
      for (const s of filled) {
        expect(s.style.fillColor).toMatch(HEX);
        expect(s.style.fillOpacity).toBeGreaterThan(0);
      }
    });
  });

  describe('multi-page.pdf — drawings per page', () => {
    it('returns an array for each page (text-only pages may be empty)', async () => {
      for (let pageNum = 1; pageNum <= 5; pageNum++) {
        expect(Array.isArray(await shapes(MULTI_PAGE_PDF, pageNum))).toBe(true);
      }
    });
  });
});
