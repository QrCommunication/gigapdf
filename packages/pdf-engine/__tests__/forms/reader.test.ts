import { describe, it, expect } from 'vitest';
import { loadFixture, WITH_FORMS_PDF, SIMPLE_PDF } from '../helpers';
import { getFormFields } from '../../src/forms/reader';
import type { FormFieldInfo } from '../../src/forms/reader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

// ---------------------------------------------------------------------------
// with-forms.pdf — form fields present
// ---------------------------------------------------------------------------

describe('getFormFields — with-forms.pdf', () => {
  it('returns an array of FormFieldInfo objects', async () => {
    const fields = await getFormFields(makeBuffer(WITH_FORMS_PDF));
    expect(Array.isArray(fields)).toBe(true);
  });

  it('finds at least one field in the forms fixture', async () => {
    const fields = await getFormFields(makeBuffer(WITH_FORMS_PDF));
    expect(fields.length).toBeGreaterThan(0);
  });

  it('each field has the required shape', async () => {
    const fields = await getFormFields(makeBuffer(WITH_FORMS_PDF));

    for (const field of fields) {
      expect(field).toHaveProperty('fieldName');
      expect(field).toHaveProperty('fieldType');
      expect(field).toHaveProperty('value');
      expect(field).toHaveProperty('defaultValue');
      expect(field).toHaveProperty('pageNumber');
      expect(field).toHaveProperty('bounds');
      expect(field).toHaveProperty('properties');

      expect(typeof field.fieldName).toBe('string');
      expect(field.fieldName.length).toBeGreaterThan(0);
      expect(field.pageNumber).toBeGreaterThanOrEqual(1);

      expect(field.bounds).toMatchObject({
        x: expect.any(Number),
        y: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number),
      });

      expect(field.properties).toMatchObject({
        required: expect.any(Boolean),
        readOnly: expect.any(Boolean),
        multiline: expect.any(Boolean),
      });
    }
  });

  it('finds the "name" text field', async () => {
    const fields = await getFormFields(makeBuffer(WITH_FORMS_PDF));
    const nameField = fields.find((f) => f.fieldName.toLowerCase().includes('name'));
    expect(nameField).toBeDefined();
    expect(nameField?.fieldType).toBe('text');
  });

  it('finds the "email" text field', async () => {
    const fields = await getFormFields(makeBuffer(WITH_FORMS_PDF));
    const emailField = fields.find((f) => f.fieldName.toLowerCase().includes('email'));
    expect(emailField).toBeDefined();
    expect(emailField?.fieldType).toBe('text');
  });

  it('finds the "agree" checkbox field', async () => {
    const fields = await getFormFields(makeBuffer(WITH_FORMS_PDF));
    const agreeField = fields.find((f) => f.fieldName.toLowerCase().includes('agree'));
    expect(agreeField).toBeDefined();
    expect(agreeField?.fieldType).toBe('checkbox');
    // checkbox value is a boolean
    expect(typeof agreeField?.value).toBe('boolean');
  });

  it('finds the "country" dropdown field', async () => {
    const fields = await getFormFields(makeBuffer(WITH_FORMS_PDF));
    const countryField = fields.find((f) => f.fieldName.toLowerCase().includes('country'));
    expect(countryField).toBeDefined();
    expect(countryField?.fieldType).toBe('dropdown');
    // dropdown has options array
    expect(Array.isArray(countryField?.options)).toBe(true);
  });

  it('text field value is a string', async () => {
    const fields = await getFormFields(makeBuffer(WITH_FORMS_PDF));
    const textFields = fields.filter((f): f is FormFieldInfo & { value: string } =>
      f.fieldType === 'text',
    );
    for (const f of textFields) {
      expect(typeof f.value).toBe('string');
    }
  });

  it('returns correct fieldType values from the known set', async () => {
    const validTypes = new Set(['text', 'checkbox', 'radio', 'dropdown', 'listbox', 'signature', 'button']);
    const fields = await getFormFields(makeBuffer(WITH_FORMS_PDF));

    for (const field of fields) {
      expect(validTypes.has(field.fieldType)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// simple.pdf — no form fields
// ---------------------------------------------------------------------------

describe('getFormFields — simple.pdf (no forms)', () => {
  it('returns an empty array', async () => {
    const fields = await getFormFields(makeBuffer(SIMPLE_PDF));
    expect(fields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// error handling
// ---------------------------------------------------------------------------

describe('getFormFields — error handling', () => {
  it('throws PDFParseError when given invalid bytes', async () => {
    const invalid = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await expect(getFormFields(invalid)).rejects.toThrow();
  });
});
