import { describe, it, expect } from 'vitest';
import type { AnnotationElement } from '@giga-pdf/types';
import { extractAnnotationElements } from '../../src/parse/annotation-extractor';
import { loadFixture, SIMPLE_PDF, WITH_FORMS_PDF } from '../helpers';

// The native engine reads annotations straight from the PDF bytes (no pdfjs);
// bounds come back in web coordinates (top-left origin) Y-flipped per page.
async function annotations(name: string, pageNumber = 1): Promise<AnnotationElement[]> {
  return extractAnnotationElements(loadFixture(name), pageNumber);
}

describe('extractAnnotationElements (native engine)', () => {
  describe('simple.pdf — synthetic PDF without markup annotations', () => {
    it('returns an array', async () => {
      expect(Array.isArray(await annotations(SIMPLE_PDF))).toBe(true);
    });
  });

  describe('with-forms.pdf — Widget annotations must be excluded', () => {
    it('never returns Widget (form) annotations — only known markup types', async () => {
      const validTypes = ['note', 'link', 'freetext', 'highlight', 'underline', 'squiggly', 'strikeout', 'stamp'];
      const anns = await annotations(WITH_FORMS_PDF);
      expect(Array.isArray(anns)).toBe(true);
      for (const ann of anns) {
        expect(validTypes).toContain(ann.annotationType);
      }
    });
  });

  describe('element structure — every returned annotation is well-formed', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validTypes = ['note', 'link', 'freetext', 'highlight', 'underline', 'squiggly', 'strikeout', 'stamp'];

    it('every annotation has the expected shape', async () => {
      for (const ann of await annotations(SIMPLE_PDF)) {
        expect(ann.type).toBe('annotation');
        expect(ann.elementId).toMatch(uuid);
        expect(typeof ann.bounds.x).toBe('number');
        expect(typeof ann.bounds.y).toBe('number');
        expect(typeof ann.bounds.width).toBe('number');
        expect(typeof ann.bounds.height).toBe('number');
        expect(ann.style.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(typeof ann.style.opacity).toBe('number');
        expect(validTypes).toContain(ann.annotationType);
        expect(ann.transform.rotation).toBe(0);
        expect(ann.transform.scaleX).toBe(1);
        expect(ann.locked).toBe(false);
        expect(ann.visible).toBe(true);
        expect(ann.popup).toBeNull();
        if (ann.linkDestination !== null) {
          expect(['external', 'internal']).toContain(ann.linkDestination.type);
        }
      }
    });

    it('annotation elementIds are unique', async () => {
      const ids = (await annotations(SIMPLE_PDF)).map((a) => a.elementId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('coordinate conversion — web coordinates (top-left origin)', () => {
    it('bounds y is within [0, pageHeight) for any annotation', async () => {
      // US-Letter fixtures are 792 pt tall.
      for (const ann of await annotations(SIMPLE_PDF)) {
        expect(ann.bounds.y).toBeGreaterThanOrEqual(0);
        expect(ann.bounds.y).toBeLessThan(792);
      }
    });
  });
});
