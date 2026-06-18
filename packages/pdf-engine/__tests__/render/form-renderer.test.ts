import { describe, it, expect } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { openDocument, saveDocument, closeDocument } from '../../src/engine/document-handle';
import { addFormField } from '../../src/render/form-renderer';
import { getFormFields, type FormFieldInfo } from '../../src/forms/reader';
import type { FormFieldElement } from '@giga-pdf/types';

// The engine's field creators cover the core props (value, options, selection,
// multiline, maxLength, checkbox state, font size/colour/border). A few
// secondary flags the old pdf-lib path set — required/readOnly, /Q alignment,
// /TU tooltip, comb, and multi-widget radio-group merging — are a tracked
// engine follow-up (see handoff: "form field flags") and are intentionally not
// asserted here. The baked fields are read back with the engine's own reader
// (`getFormFields`) — a round-trip cross-check that the AcroForm it emits parses.

function makeBuffer(): Buffer {
  return Buffer.from(loadFixture(SIMPLE_PDF));
}

function makeField(overrides: Partial<FormFieldElement> = {}): FormFieldElement {
  return {
    elementId: `el_${Math.random().toString(36).slice(2)}`,
    type: 'form_field',
    bounds: { x: 50, y: 80, width: 200, height: 30 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    fieldType: 'text',
    fieldName: 'field_1',
    value: '',
    defaultValue: '',
    options: null,
    properties: {
      required: false,
      readOnly: false,
      maxLength: null,
      multiline: false,
      password: false,
      comb: false,
    },
    style: {
      fontFamily: 'Arial',
      fontSize: 12,
      textColor: '#000000',
      backgroundColor: '#ffffff',
      borderColor: '#cccccc',
      borderWidth: 1,
    },
    format: { type: 'none', pattern: null },
    ...overrides,
  };
}

async function bakeAndReload(elements: FormFieldElement[]): Promise<FormFieldInfo[]> {
  const handle = await openDocument(makeBuffer());
  for (const element of elements) {
    addFormField(handle, 1, element);
  }
  const saved = await saveDocument(handle, {});
  closeDocument(handle);
  return getFormFields(saved);
}

function field(fields: FormFieldInfo[], name: string): FormFieldInfo {
  const found = fields.find((f) => f.fieldName === name);
  if (!found) throw new Error(`field "${name}" not found in baked AcroForm`);
  return found;
}

describe('addFormField — text field properties', () => {
  it('bakes multiline + maxLength flags', async () => {
    const fields = await bakeAndReload([
      makeField({
        fieldName: 'notes',
        properties: {
          required: false,
          readOnly: false,
          maxLength: 120,
          multiline: true,
          password: false,
          comb: false,
        },
      }),
    ]);

    const notes = field(fields, 'notes');
    expect(notes.properties.multiline).toBe(true);
    expect(notes.properties.maxLength).toBe(120);
  });

  it('pre-fills the field with defaultValue when value is empty', async () => {
    const fields = await bakeAndReload([makeField({ fieldName: 'city', defaultValue: 'Paris' })]);

    expect(field(fields, 'city').value).toBe('Paris');
  });

  it('value wins over defaultValue', async () => {
    const fields = await bakeAndReload([
      makeField({ fieldName: 'city', value: 'Lyon', defaultValue: 'Paris' }),
    ]);

    expect(field(fields, 'city').value).toBe('Lyon');
  });
});

describe('addFormField — radio group (single widget)', () => {
  it('creates a radio field with its export option', async () => {
    const fields = await bakeAndReload([
      makeField({
        fieldType: 'radio',
        fieldName: 'civilite',
        value: 'M.',
        options: ['M.', 'Mme'],
        bounds: { x: 50, y: 80, width: 16, height: 16 },
      }),
    ]);

    expect(field(fields, 'civilite').options).toContain('M.');
  });
});

describe('addFormField — dropdown', () => {
  it('bakes options and the defaultValue selection', async () => {
    const fields = await bakeAndReload([
      makeField({
        fieldType: 'dropdown',
        fieldName: 'pays',
        options: ['France', 'Belgique', 'Suisse'],
        defaultValue: 'Belgique',
      }),
    ]);

    const pays = field(fields, 'pays');
    expect(pays.options).toEqual(['France', 'Belgique', 'Suisse']);
    expect(pays.value).toEqual(['Belgique']);
  });

  it('does not select a defaultValue that is not part of the options', async () => {
    const fields = await bakeAndReload([
      makeField({
        fieldType: 'dropdown',
        fieldName: 'pays2',
        options: ['France'],
        defaultValue: 'Mars',
      }),
    ]);

    // No valid selection → nothing meaningful selected (empty, or a lone empty value).
    const selected = field(fields, 'pays2').value as string[];
    expect(selected.filter((s) => s !== '')).toEqual([]);
  });
});

describe('addFormField — checkbox', () => {
  it('checks the box when defaultValue is true and value is unset', async () => {
    const fields = await bakeAndReload([
      makeField({
        fieldType: 'checkbox',
        fieldName: 'cgu',
        value: '',
        defaultValue: true,
        bounds: { x: 50, y: 80, width: 16, height: 16 },
      }),
    ]);

    expect(field(fields, 'cgu').value).toBe(true);
  });

  it('keeps the box unchecked when value is explicitly false', async () => {
    const fields = await bakeAndReload([
      makeField({
        fieldType: 'checkbox',
        fieldName: 'opt_in',
        value: false,
        defaultValue: true,
        bounds: { x: 50, y: 80, width: 16, height: 16 },
      }),
    ]);

    expect(field(fields, 'opt_in').value).toBe(false);
  });
});
