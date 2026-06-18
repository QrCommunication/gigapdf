import { describe, it, expect } from 'vitest';
import type { TextElement } from '@giga-pdf/types';
import { extractTextElements } from '../../src/parse/text-extractor';
import { loadFixture, SIMPLE_PDF, MULTI_PAGE_PDF } from '../helpers';

// The native engine reads text runs straight from the PDF bytes (no pdfjs);
// bounds come back in web coordinates (top-left origin) Y-flipped per page.
async function text(name: string, pageNumber = 1): Promise<TextElement[]> {
  return extractTextElements(loadFixture(name), pageNumber);
}

const joined = (els: TextElement[]) => els.map((e) => e.content).join(' ');

describe('extractTextElements (native engine)', () => {
  describe('simple.pdf page 1 — content extraction', () => {
    it('returns at least two text elements', async () => {
      expect((await text(SIMPLE_PDF)).length).toBeGreaterThanOrEqual(2);
    });

    it('finds the "Hello GigaPDF Test" string', async () => {
      expect(joined(await text(SIMPLE_PDF))).toContain('Hello GigaPDF Test');
    });

    it('finds the "Second line of text" string', async () => {
      expect(joined(await text(SIMPLE_PDF))).toContain('Second line of text');
    });

    it('does not include blank-only strings', async () => {
      for (const el of await text(SIMPLE_PDF)) {
        expect(el.content.trim()).not.toBe('');
      }
    });
  });

  describe('element structure — required fields', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it('every text element is well-formed', async () => {
      // US-Letter fixtures are 792 pt tall.
      for (const el of await text(SIMPLE_PDF)) {
        expect(el.type).toBe('text');
        expect(el.elementId).toMatch(uuid);
        expect(typeof el.bounds.x).toBe('number');
        expect(el.bounds.y).toBeGreaterThanOrEqual(0);
        expect(el.bounds.y).toBeLessThan(792);
        expect(typeof el.bounds.width).toBe('number');
        expect(typeof el.bounds.height).toBe('number');
        expect(el.style.fontFamily.length).toBeGreaterThan(0);
        expect(el.style.fontSize).toBeGreaterThan(0);
        expect(el.style.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(el.transform.rotation).toBe(0);
        expect(el.transform.scaleX).toBe(1);
        expect(el.locked).toBe(false);
        expect(el.visible).toBe(true);
        expect(el.style.textAlign).toBe('left');
        expect(el.style.writingMode).toBe('horizontal-tb');
        expect(el.style.underline).toBe(false);
        expect(el.style.strikethrough).toBe(false);
        expect(el.ocrConfidence).toBeNull();
        expect(el.linkUrl).toBeNull();
        expect(el.linkPage).toBeNull();
      }
    });

    it('element elementIds are unique', async () => {
      const ids = (await text(SIMPLE_PDF)).map((e) => e.elementId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('at least one element uses the default black colour', async () => {
      expect((await text(SIMPLE_PDF)).some((e) => e.style.color === '#000000')).toBe(true);
    });
  });

  describe('coordinate + size relationships', () => {
    it('the heading sits above the body line (smaller web y) and is larger', async () => {
      const els = await text(SIMPLE_PDF);
      const heading = els.find((e) => e.content.includes('Hello'));
      const body = els.find((e) => e.content.includes('Second line'));
      expect(heading).toBeDefined();
      expect(body).toBeDefined();
      // Web coords (top-left origin): the first line has a smaller y.
      expect(heading!.bounds.y).toBeLessThan(body!.bounds.y);
      // Fixture uses size 24 for the heading, 14 for the body.
      expect(heading!.style.fontSize).toBeGreaterThan(body!.style.fontSize);
    });
  });

  describe('multi-page.pdf — per-page extraction', () => {
    it('extracts "Page 1" text from page 1', async () => {
      expect(joined(await text(MULTI_PAGE_PDF, 1))).toContain('Page 1');
    });

    it('extracts "Page 3" text from page 3', async () => {
      expect(joined(await text(MULTI_PAGE_PDF, 3))).toContain('Page 3');
    });

    it('page 1 does not contain "Page 2" text', async () => {
      expect(joined(await text(MULTI_PAGE_PDF, 1))).not.toContain('Page 2');
    });
  });
});
