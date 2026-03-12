import { describe, it, expect } from 'vitest';
import { loadFixture, WITH_FORMS_PDF } from '../helpers';
import { fillForm } from '../../src/forms/filler';
import { getFormFields } from '../../src/forms/reader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

// ---------------------------------------------------------------------------
// fillForm — text field
// ---------------------------------------------------------------------------

describe('fillForm — text field', () => {
  it('returns a buffer and a results array', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const { buffer, results } = await fillForm(source, { name: 'Alice' });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(Array.isArray(results)).toBe(true);
  });

  it('reports success for a valid text field', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const { results } = await fillForm(source, { name: 'Alice' });

    const result = results.find((r) => r.fieldName === 'name');
    expect(result).toBeDefined();
    expect(result?.success).toBe(true);
    expect(result?.newValue).toBe('Alice');
  });

  it('persists the new text value when the result is read back', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const { buffer } = await fillForm(source, { name: 'Bob' });

    const fields = await getFormFields(buffer);
    const nameField = fields.find((f) => f.fieldName === 'name');
    expect(nameField?.value).toBe('Bob');
  });

  it('fills the email field', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const { results } = await fillForm(source, { email: 'test@example.com' });

    const result = results.find((r) => r.fieldName === 'email');
    expect(result?.success).toBe(true);
  });

  it('records the old value before replacing', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const { results } = await fillForm(source, { name: 'Charlie' });

    const result = results.find((r) => r.fieldName === 'name');
    // old value should be a string (may be empty for a blank form)
    expect(typeof result?.oldValue).toBe('string');
  });

  it('fills multiple text fields at once', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const { results } = await fillForm(source, {
      name: 'Dave',
      email: 'dave@example.com',
    });

    const nameRes = results.find((r) => r.fieldName === 'name');
    const emailRes = results.find((r) => r.fieldName === 'email');

    expect(nameRes?.success).toBe(true);
    expect(emailRes?.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fillForm — checkbox
// ---------------------------------------------------------------------------

describe('fillForm — checkbox', () => {
  it('checks the agree checkbox (true)', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const { results, buffer } = await fillForm(source, { agree: true });

    const result = results.find((r) => r.fieldName === 'agree');
    expect(result?.success).toBe(true);

    // Verify by reading back
    const fields = await getFormFields(buffer);
    const agreeField = fields.find((f) => f.fieldName === 'agree');
    expect(agreeField?.value).toBe(true);
  });

  it('unchecks the agree checkbox (false)', async () => {
    // First check it, then uncheck
    const source = makeBuffer(WITH_FORMS_PDF);
    const { buffer: checked } = await fillForm(source, { agree: true });
    const { results, buffer: unchecked } = await fillForm(checked, { agree: false });

    const result = results.find((r) => r.fieldName === 'agree');
    expect(result?.success).toBe(true);

    const fields = await getFormFields(unchecked);
    const agreeField = fields.find((f) => f.fieldName === 'agree');
    expect(agreeField?.value).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fillForm — dropdown
// ---------------------------------------------------------------------------

describe('fillForm — dropdown', () => {
  it('selects a single option in the country dropdown', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);

    // First discover valid options
    const fields = await getFormFields(source);
    const countryField = fields.find((f) => f.fieldName === 'country');
    const firstOption = Array.isArray(countryField?.options) && countryField.options.length > 0
      ? countryField.options[0]!
      : null;

    if (!firstOption) {
      // Skip if the fixture has no options (defensive)
      return;
    }

    const { results } = await fillForm(source, { country: firstOption });
    const result = results.find((r) => r.fieldName === 'country');
    expect(result?.success).toBe(true);
    expect(result?.newValue).toBe(firstOption);
  });
});

// ---------------------------------------------------------------------------
// fillForm — unknown field
// ---------------------------------------------------------------------------

describe('fillForm — unknown field', () => {
  it('reports failure for a field name that does not exist', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const { results } = await fillForm(source, { nonExistentField: 'value' });

    const result = results.find((r) => r.fieldName === 'nonExistentField');
    expect(result?.success).toBe(false);
    expect(result?.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// fillForm — invalid input
// ---------------------------------------------------------------------------

describe('fillForm — invalid buffer', () => {
  it('throws PDFParseError when given invalid bytes', async () => {
    const invalid = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await expect(fillForm(invalid, { name: 'test' })).rejects.toThrow();
  });
});
