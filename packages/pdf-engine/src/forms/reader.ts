/**
 * AcroForm field reading via the zero-dependency WASM engine. `engine.open(pdf)`
 * then `.fields()` returns every terminal field with its kind, value, flags,
 * widget `page` and top-left `bounds` — no pdf-lib. The shapes below
 * (`FormFieldInfo`, `FillResult`) are the stable contract consumed by the API
 * routes and `filler.ts`, so they are preserved exactly.
 */

import type { Bounds } from '@giga-pdf/types';
import type { FieldInfo, FieldKind } from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';
import { PDFParseError } from '../errors';

export interface FormFieldInfo {
  fieldName: string;
  fieldType: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'listbox' | 'signature' | 'button';
  value: string | boolean | string[];
  defaultValue: string | boolean | string[];
  pageNumber: number;
  bounds: Bounds;
  options: string[] | null;
  properties: {
    required: boolean;
    readOnly: boolean;
    maxLength: number | null;
    multiline: boolean;
  };
}

export interface FillResult {
  fieldName: string;
  success: boolean;
  oldValue: string | boolean | string[];
  newValue: string | boolean | string[];
  error?: string;
}

type AppFieldType = FormFieldInfo['fieldType'];

/** Engine `FieldKind` → the app's `fieldType`. `unknown` fields are skipped. */
const KIND_TO_TYPE: Partial<Record<FieldKind, AppFieldType>> = {
  text: 'text',
  checkbox: 'checkbox',
  radio: 'radio',
  combo: 'dropdown',
  list: 'listbox',
  pushbutton: 'button',
  signature: 'signature',
};

/**
 * The engine reports `value` as a single string (multi-select choices joined by
 * `\n`). Re-shape it to the per-type value the app contract expects.
 */
function libValueToApp(fieldType: AppFieldType, raw: string): string | boolean | string[] {
  switch (fieldType) {
    case 'checkbox':
      // A checkbox's /V is its export state when on, or "Off"/empty when off.
      return raw !== '' && raw.toLowerCase() !== 'off';
    case 'dropdown':
    case 'listbox':
      return raw === '' ? [] : raw.split('\n');
    case 'button':
    case 'signature':
      return '';
    default:
      return raw; // text, radio
  }
}

function defaultValueFor(fieldType: AppFieldType): string | boolean | string[] {
  switch (fieldType) {
    case 'checkbox':
      return false;
    case 'dropdown':
    case 'listbox':
      return [];
    default:
      return '';
  }
}

export async function getFormFields(buffer: Buffer): Promise<FormFieldInfo[]> {
  const giga = await getEngine();
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  let doc;
  try {
    doc = giga.open(data);
  } catch (err) {
    throw new PDFParseError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const results: FormFieldInfo[] = [];

    for (const field of doc.fields() as FieldInfo[]) {
      const fieldType = KIND_TO_TYPE[field.kind];
      if (!fieldType) continue; // skip "unknown"

      const bounds: Bounds = field.bounds
        ? {
            x: field.bounds[0],
            y: field.bounds[1],
            width: field.bounds[2],
            height: field.bounds[3],
          }
        : { x: 0, y: 0, width: 0, height: 0 };

      // Only choice/radio fields expose a selectable option set.
      const options =
        fieldType === 'radio' || fieldType === 'dropdown' || fieldType === 'listbox'
          ? field.options
          : null;

      results.push({
        fieldName: field.name,
        fieldType,
        value: libValueToApp(fieldType, field.value),
        defaultValue: defaultValueFor(fieldType),
        pageNumber: field.page ?? 1,
        bounds,
        options,
        properties: {
          required: field.required,
          readOnly: field.readOnly,
          maxLength: field.maxLen ?? null,
          multiline: field.multiline,
        },
      });
    }

    return results;
  } finally {
    doc.close();
  }
}
