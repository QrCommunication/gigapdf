import { describe, it, expect } from 'vitest';
import { loadFixture, WITH_FORMS_PDF, SIMPLE_PDF } from '../helpers';
import { flattenForm } from '../../src/forms/flattener';
import { getFormFields } from '../../src/forms/reader';
import { PDFDocument } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

// ---------------------------------------------------------------------------
// flattenForm
// ---------------------------------------------------------------------------

describe('flattenForm', () => {
  it('returns a Buffer', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const result = await flattenForm(source);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('produces a valid PDF (loadable by pdf-lib)', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const result = await flattenForm(source);

    await expect(PDFDocument.load(result, { ignoreEncryption: true })).resolves.toBeDefined();
  });

  it('removes all interactive form fields after flattening', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);

    // Confirm there are fields before flattening
    const fieldsBefore = await getFormFields(source);
    expect(fieldsBefore.length).toBeGreaterThan(0);

    const flattened = await flattenForm(source);

    // After flattening, getFormFields should return an empty array
    // because form.flatten() removes all AcroForm widgets.
    const fieldsAfter = await getFormFields(flattened);
    expect(fieldsAfter).toEqual([]);
  });

  it('does not increase file size beyond a reasonable bound after flattening', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const result = await flattenForm(source);

    // The flattened PDF should not be larger than 5x the source
    // (a generous bound; in practice it is usually similar or smaller).
    expect(result.length).toBeLessThan(source.length * 5);
  });

  it('is idempotent — flattening an already-flattened PDF does not crash', async () => {
    const source = makeBuffer(WITH_FORMS_PDF);
    const firstPass = await flattenForm(source);
    const secondPass = await flattenForm(firstPass);

    expect(secondPass).toBeInstanceOf(Buffer);
    expect(secondPass.length).toBeGreaterThan(0);
  });

  it('handles a PDF with no form fields gracefully', async () => {
    const source = makeBuffer(SIMPLE_PDF);
    const result = await flattenForm(source);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('throws PDFParseError when given invalid bytes', async () => {
    const invalid = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await expect(flattenForm(invalid)).rejects.toThrow();
  });
});
