import { describe, it, expect, beforeAll } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { pdfjsLib } from './setup';
import { extractImageElements } from '../../src/parse/image-extractor';
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

describe('extractImageElements', () => {
  describe('simple.pdf — vector-only content (no raster images)', () => {
    let simpleDoc: PDFDocumentProxy;

    beforeAll(async () => {
      simpleDoc = await loadPdf(SIMPLE_PDF);
    });

    it('returns an array (expected to be empty for vector-only content)', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      expect(Array.isArray(images)).toBe(true);
      // simple.pdf uses drawRectangle/drawLine/drawEllipse — no raster images
      expect(images).toHaveLength(0);
    });

    it('returns empty array when called without baseUrl and documentId', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      expect(images).toHaveLength(0);
    });

    it('returns empty array when called with baseUrl and documentId', async () => {
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight, 'https://api.example.com', 'doc-123');
      expect(images).toHaveLength(0);
    });
  });

  describe('multi-page.pdf — vector-only content (no raster images)', () => {
    let multiDoc: PDFDocumentProxy;

    beforeAll(async () => {
      multiDoc = await loadPdf(MULTI_PAGE_PDF);
    });

    it('returns an empty array for page 1 of multi-page.pdf', async () => {
      const { page, pageHeight } = await getPage(multiDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      expect(images).toHaveLength(0);
    });

    it('returns an empty array for page 5 of multi-page.pdf', async () => {
      const { page, pageHeight } = await getPage(multiDoc, 5);
      const images = await extractImageElements(page, 5, pageHeight);
      expect(images).toHaveLength(0);
    });
  });

  describe('element structure — conformance checks on any found images', () => {
    // These tests validate structural correctness for any images that DO appear.
    // For the fixture PDFs they will run vacuously (0 images), but the structure
    // assertions guard against regressions when raster-image fixtures are added.

    it('each element has type "image"', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      for (const img of images) {
        expect(img.type).toBe('image');
      }
    });

    it('each element has a UUID elementId', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (const img of images) {
        expect(img.elementId).toMatch(uuidPattern);
      }
    });

    it('each element has unique elementIds', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      const ids = images.map((i) => i.elementId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('each element has bounds with positive width and height', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      for (const img of images) {
        expect(typeof img.bounds.x).toBe('number');
        expect(typeof img.bounds.y).toBe('number');
        expect(img.bounds.width).toBeGreaterThan(0);
        expect(img.bounds.height).toBeGreaterThan(0);
      }
    });

    it('each element has source with type "embedded"', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      for (const img of images) {
        expect(img.source).toBeDefined();
        expect(img.source.type).toBe('embedded');
        expect(img.source.originalDimensions).toBeDefined();
        expect(img.source.originalDimensions.width).toBeGreaterThan(0);
        expect(img.source.originalDimensions.height).toBeGreaterThan(0);
      }
    });

    it('each element has style with opacity=1 and blendMode="normal"', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      for (const img of images) {
        expect(img.style.opacity).toBe(1);
        expect(img.style.blendMode).toBe('normal');
      }
    });

    it('crop is null by default', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      for (const img of images) {
        expect(img.crop).toBeNull();
      }
    });

    it('each element has transform with rotation=0', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      for (const img of images) {
        expect(img.transform.rotation).toBe(0);
        expect(img.transform.scaleX).toBe(1);
        expect(img.transform.scaleY).toBe(1);
      }
    });

    it('each element has locked=false and visible=true', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      for (const img of images) {
        expect(img.locked).toBe(false);
        expect(img.visible).toBe(true);
      }
    });
  });

  describe('dataUrl generation — with and without baseUrl', () => {
    it('generates empty dataUrl string when no baseUrl is provided', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      // Even with no images, we verify the function accepts optional params
      const images = await extractImageElements(page, 1, pageHeight, null, undefined);
      for (const img of images) {
        expect(img.source.dataUrl).toBe('');
      }
    });

    it('generates API URL dataUrl when baseUrl and documentId are provided', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight, 'https://api.example.com', 'doc-abc');
      for (const img of images) {
        expect(img.source.dataUrl).toContain('https://api.example.com');
        expect(img.source.dataUrl).toContain('doc-abc');
      }
    });
  });

  describe('coordinate conversion — web coordinates', () => {
    it('bounds y is non-negative for any extracted image', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      for (const img of images) {
        expect(img.bounds.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('bounds y is less than pageHeight for any extracted image', async () => {
      const simpleDoc = await loadPdf(SIMPLE_PDF);
      const { page, pageHeight } = await getPage(simpleDoc, 1);
      const images = await extractImageElements(page, 1, pageHeight);
      for (const img of images) {
        expect(img.bounds.y).toBeLessThan(pageHeight);
      }
    });
  });
});
