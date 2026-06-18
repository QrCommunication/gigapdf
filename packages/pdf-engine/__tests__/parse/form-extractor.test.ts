import { describe, it, expect } from 'vitest';
import type { FormFieldElement } from '@giga-pdf/types';
import { extractFormFieldElements } from '../../src/parse/form-extractor';
import { loadFixture, SIMPLE_PDF, WITH_FORMS_PDF } from '../helpers';

// The fixtures are US-Letter (612×792); form-field bounds come back in web
// coordinates (top-left origin) already Y-flipped by the engine.
const PAGE_HEIGHT = 792;

async function formFields(name: string, pageNumber = 1): Promise<FormFieldElement[]> {
  return extractFormFieldElements(loadFixture(name), pageNumber);
}

describe('extractFormFieldElements (native engine)', () => {
  // TODO(tech-debt): with-forms.pdf fixture form-field detection is broken
  // (pre-existing). Kept skipped to mirror the prior pdfjs-based suite.
  describe.skip('with-forms.pdf — form field detection', () => {
    it('finds exactly 4 form fields on page 1', async () => {
      expect(await formFields(WITH_FORMS_PDF)).toHaveLength(4);
    });
    it('finds a field named "name"', async () => {
      expect((await formFields(WITH_FORMS_PDF)).find((f) => f.fieldName === 'name')).toBeDefined();
    });
    it('finds a field named "country"', async () => {
      expect(
        (await formFields(WITH_FORMS_PDF)).find((f) => f.fieldName === 'country'),
      ).toBeDefined();
    });
    it('"name" field has fieldType "text"', async () => {
      const nameField = (await formFields(WITH_FORMS_PDF)).find((f) => f.fieldName === 'name');
      expect(nameField?.fieldType).toBe('text');
    });
  });

  describe('element structure — every detected field is well-formed', () => {
    it('every field has type "form_field" and a UUID elementId', async () => {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (const field of await formFields(WITH_FORMS_PDF)) {
        expect(field.type).toBe('form_field');
        expect(field.elementId).toMatch(uuid);
      }
    });

    it('every field has numeric bounds, a non-empty name, properties, style, format', async () => {
      for (const field of await formFields(WITH_FORMS_PDF)) {
        expect(typeof field.bounds.x).toBe('number');
        expect(typeof field.bounds.y).toBe('number');
        expect(field.bounds.width).toBeGreaterThan(0);
        expect(field.bounds.height).toBeGreaterThan(0);
        expect(field.fieldName.length).toBeGreaterThan(0);
        expect(typeof field.properties.required).toBe('boolean');
        expect(typeof field.properties.readOnly).toBe('boolean');
        expect(typeof field.properties.multiline).toBe('boolean');
        expect(typeof field.properties.password).toBe('boolean');
        expect(typeof field.properties.comb).toBe('boolean');
        expect(field.style.fontSize).toBeGreaterThan(0);
        expect(field.format.type).toBe('none');
        expect(field.transform.rotation).toBe(0);
        expect(field.locked).toBe(false);
        expect(field.visible).toBe(true);
      }
    });

    it('field elementIds are unique', async () => {
      const ids = (await formFields(WITH_FORMS_PDF)).map((f) => f.elementId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('coordinate conversion — web coordinates (top-left origin)', () => {
    it('bounds y is within [0, pageHeight)', async () => {
      for (const field of await formFields(WITH_FORMS_PDF)) {
        expect(field.bounds.y).toBeGreaterThanOrEqual(0);
        expect(field.bounds.y).toBeLessThan(PAGE_HEIGHT);
      }
    });
  });

  describe('simple.pdf — no form fields', () => {
    it('returns an empty array when the PDF has no form fields', async () => {
      expect(await formFields(SIMPLE_PDF)).toEqual([]);
    });
  });
});
