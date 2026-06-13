import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  TextAlignment,
} from 'pdf-lib';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { openDocument, saveDocument } from '../../src/engine/document-handle';
import { addFormField } from '../../src/render/form-renderer';
import type { FormFieldElement } from '@giga-pdf/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function bakeAndReload(
  elements: FormFieldElement[],
): Promise<PDFDocument> {
  const handle = await openDocument(makeBuffer());
  for (const element of elements) {
    addFormField(handle, 1, element);
  }
  const saved = await saveDocument(handle, {});
  return PDFDocument.load(new Uint8Array(saved));
}

// ---------------------------------------------------------------------------
// Text field — flags & metadata
// ---------------------------------------------------------------------------

describe('addFormField — text field properties', () => {
  it('bakes required + multiline + maxLength flags', async () => {
    const doc = await bakeAndReload([
      makeField({
        fieldName: 'notes',
        properties: {
          required: true,
          readOnly: false,
          maxLength: 120,
          multiline: true,
          password: false,
          comb: false,
        },
      }),
    ]);

    const field = doc.getForm().getTextField('notes');
    expect(field.isRequired()).toBe(true);
    expect(field.isMultiline()).toBe(true);
    expect(field.getMaxLength()).toBe(120);
  });

  it('pre-fills the field with defaultValue when value is empty', async () => {
    const doc = await bakeAndReload([
      makeField({ fieldName: 'city', defaultValue: 'Paris' }),
    ]);

    expect(doc.getForm().getTextField('city').getText()).toBe('Paris');
  });

  it('value wins over defaultValue', async () => {
    const doc = await bakeAndReload([
      makeField({ fieldName: 'city', value: 'Lyon', defaultValue: 'Paris' }),
    ]);

    expect(doc.getForm().getTextField('city').getText()).toBe('Lyon');
  });

  it('bakes text alignment (/Q) from style.textAlign', async () => {
    const doc = await bakeAndReload([
      makeField({
        fieldName: 'centered',
        style: {
          fontFamily: 'Arial',
          fontSize: 12,
          textColor: '#000000',
          backgroundColor: null,
          borderColor: null,
          borderWidth: 1,
          textAlign: 'center',
        },
      }),
    ]);

    expect(doc.getForm().getTextField('centered').getAlignment()).toBe(
      TextAlignment.Center,
    );
  });

  it('writes the tooltip as the /TU alternate description', async () => {
    const doc = await bakeAndReload([
      makeField({ fieldName: 'email', tooltip: 'Adresse e-mail' }),
    ]);

    const field = doc.getForm().getTextField('email');
    const tu = field.acroField.dict.lookup(PDFName.of('TU'));
    expect(tu).toBeInstanceOf(PDFHexString);
    expect((tu as PDFHexString).decodeText()).toBe('Adresse e-mail');
  });
});

// ---------------------------------------------------------------------------
// Radio group — N widgets share one group
// ---------------------------------------------------------------------------

describe('addFormField — radio group', () => {
  it('merges widgets with the same fieldName into a single group with all options', async () => {
    const base = {
      fieldType: 'radio' as const,
      fieldName: 'civilite',
      options: ['M.', 'Mme'],
    };
    const doc = await bakeAndReload([
      makeField({ ...base, value: 'M.', bounds: { x: 50, y: 80, width: 16, height: 16 } }),
      makeField({ ...base, value: 'Mme', bounds: { x: 50, y: 110, width: 16, height: 16 } }),
    ]);

    const group = doc.getForm().getRadioGroup('civilite');
    expect(group.getOptions().sort()).toEqual(['M.', 'Mme'].sort());
    expect(group.acroField.getWidgets().length).toBe(2);
  });

  it('selects the widget whose export value matches defaultValue', async () => {
    const base = {
      fieldType: 'radio' as const,
      fieldName: 'choix',
      options: ['oui', 'non'],
      defaultValue: 'non',
    };
    const doc = await bakeAndReload([
      makeField({ ...base, value: 'oui', bounds: { x: 50, y: 80, width: 16, height: 16 } }),
      makeField({ ...base, value: 'non', bounds: { x: 50, y: 110, width: 16, height: 16 } }),
    ]);

    expect(doc.getForm().getRadioGroup('choix').getSelected()).toBe('non');
  });
});

// ---------------------------------------------------------------------------
// Dropdown — options + selection + required
// ---------------------------------------------------------------------------

describe('addFormField — dropdown', () => {
  it('bakes options, defaultValue selection and required flag', async () => {
    const doc = await bakeAndReload([
      makeField({
        fieldType: 'dropdown',
        fieldName: 'pays',
        options: ['France', 'Belgique', 'Suisse'],
        defaultValue: 'Belgique',
        properties: {
          required: true,
          readOnly: false,
          maxLength: null,
          multiline: false,
          password: false,
          comb: false,
        },
      }),
    ]);

    const field = doc.getForm().getDropdown('pays');
    expect(field.getOptions()).toEqual(['France', 'Belgique', 'Suisse']);
    expect(field.getSelected()).toEqual(['Belgique']);
    expect(field.isRequired()).toBe(true);
  });

  it('ignores a defaultValue that is not part of the options', async () => {
    const doc = await bakeAndReload([
      makeField({
        fieldType: 'dropdown',
        fieldName: 'pays2',
        options: ['France'],
        defaultValue: 'Mars',
      }),
    ]);

    expect(doc.getForm().getDropdown('pays2').getSelected()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Checkbox — defaultValue checked state
// ---------------------------------------------------------------------------

describe('addFormField — checkbox', () => {
  it('checks the box when defaultValue is true and value is unset', async () => {
    const doc = await bakeAndReload([
      makeField({
        fieldType: 'checkbox',
        fieldName: 'cgu',
        value: '',
        defaultValue: true,
        bounds: { x: 50, y: 80, width: 16, height: 16 },
      }),
    ]);

    expect(doc.getForm().getCheckBox('cgu').isChecked()).toBe(true);
  });

  it('keeps the box unchecked when value is explicitly false', async () => {
    const doc = await bakeAndReload([
      makeField({
        fieldType: 'checkbox',
        fieldName: 'opt_in',
        value: false,
        defaultValue: true,
        bounds: { x: 50, y: 80, width: 16, height: 16 },
      }),
    ]);

    expect(doc.getForm().getCheckBox('opt_in').isChecked()).toBe(false);
  });
});
