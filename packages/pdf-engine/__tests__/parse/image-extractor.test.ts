import { describe, it, expect } from 'vitest';
import type { ImageElement } from '@giga-pdf/types';
import { extractImageElements } from '../../src/parse/image-extractor';
import { loadFixture, SIMPLE_PDF, MULTI_PAGE_PDF } from '../helpers';

// The native engine reads images straight from the PDF bytes (no pdfjs); bounds
// come back in web coordinates (top-left origin) already Y-flipped per page.
async function images(
  name: string,
  pageNumber = 1,
  baseUrl?: string | null,
  documentId?: string,
): Promise<ImageElement[]> {
  return extractImageElements(loadFixture(name), pageNumber, baseUrl, documentId);
}

describe('extractImageElements (native engine)', () => {
  describe('simple.pdf — vector-only content (no raster images)', () => {
    it('returns an empty array for vector-only content', async () => {
      expect(await images(SIMPLE_PDF)).toEqual([]);
    });

    it('returns an empty array with baseUrl + documentId too', async () => {
      expect(await images(SIMPLE_PDF, 1, 'https://api.example.com', 'doc-123')).toEqual([]);
    });
  });

  describe('multi-page.pdf — vector-only content (no raster images)', () => {
    it('returns an empty array for page 1', async () => {
      expect(await images(MULTI_PAGE_PDF, 1)).toEqual([]);
    });

    it('returns an empty array for page 5', async () => {
      expect(await images(MULTI_PAGE_PDF, 5)).toEqual([]);
    });
  });

  describe('element structure — conformance checks on any found images', () => {
    // Run vacuously on the vector-only fixtures, but guard the shape so a future
    // raster-image fixture can't regress the contract.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it('every image is a well-formed "image" element', async () => {
      for (const img of await images(SIMPLE_PDF)) {
        expect(img.type).toBe('image');
        expect(img.elementId).toMatch(uuid);
        expect(typeof img.bounds.x).toBe('number');
        expect(typeof img.bounds.y).toBe('number');
        expect(img.bounds.width).toBeGreaterThan(0);
        expect(img.bounds.height).toBeGreaterThan(0);
        expect(img.source.type).toBe('embedded');
        expect(img.source.originalDimensions.width).toBeGreaterThan(0);
        expect(img.source.originalDimensions.height).toBeGreaterThan(0);
        expect(img.style.blendMode).toBe('normal');
        expect(img.style.opacity).toBeGreaterThan(0);
        expect(img.style.opacity).toBeLessThanOrEqual(1);
        expect(img.transform.scaleX).toBe(1);
        expect(img.transform.scaleY).toBe(1);
        expect(img.locked).toBe(false);
        expect(img.visible).toBe(true);
        expect(img.crop).toBeNull();
      }
    });

    it('image elementIds are unique', async () => {
      const ids = (await images(SIMPLE_PDF)).map((i) => i.elementId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('coordinate conversion — web coordinates (top-left origin)', () => {
    it('bounds y is within [0, pageHeight) for any image', async () => {
      // US-Letter fixtures are 792 pt tall.
      for (const img of await images(SIMPLE_PDF)) {
        expect(img.bounds.y).toBeGreaterThanOrEqual(0);
        expect(img.bounds.y).toBeLessThan(792);
      }
    });
  });
});
