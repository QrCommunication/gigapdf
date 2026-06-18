import { createHash } from 'node:crypto';
import type { FormFieldElement, FieldType } from '@giga-pdf/types';
import type { FieldInfo, FieldKind } from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';

// ---------------------------------------------------------------------------
// Form field extractor — backed by the native engine (no pdfjs).
//
// AcroForm is document-level, so `extractFormFieldsByPage` reads every field
// once via `fields()` and groups them by the widget's page; the parser slices
// the right page out. `extractFormFieldElements` is a per-page convenience
// (used by tests). The live form read/fill path is `getFormFields`, also on the
// engine; this only builds the editor scene-graph elements.
// ---------------------------------------------------------------------------

// `/Ff` field flag bits the engine doesn't surface as named booleans.
const FLAG_PASSWORD = 1 << 13;
const FLAG_COMB = 1 << 24;

function stableUUID(fieldName: string, pageNumber: number): string {
  const hash = createHash('sha256').update(`${fieldName}:${pageNumber}`).digest('hex');
  const c16 = hash[16] ?? '0';
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16), // version 4
    ((parseInt(c16, 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), // variant
    hash.slice(20, 32),
  ].join('-');
}

function mapKind(kind: FieldKind): FieldType {
  switch (kind) {
    case 'signature':
      return 'signature';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'pushbutton':
      return 'button';
    case 'combo':
      return 'dropdown';
    case 'list':
      return 'listbox';
    case 'text':
    default:
      return 'text';
  }
}

function toElement(field: FieldInfo): FormFieldElement {
  const pageNumber = field.page ?? 1;
  // The engine already Y-flips `/Rect` to a top-left `[x, y, width, height]`.
  const [x, y, width, height] = field.bounds ?? [0, 0, 0, 0];
  return {
    elementId: stableUUID(field.name, pageNumber),
    type: 'form_field',
    bounds: { x, y, width, height },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    fieldType: mapKind(field.kind),
    fieldName: field.name,
    value: field.value,
    defaultValue: field.value,
    options: field.options.length > 0 ? field.options : null,
    properties: {
      required: field.required,
      readOnly: field.readOnly,
      maxLength: field.maxLen ?? null,
      multiline: field.multiline,
      password: (field.flags & FLAG_PASSWORD) !== 0,
      comb: (field.flags & FLAG_COMB) !== 0,
    },
    style: {
      fontFamily: 'Helvetica',
      fontSize: 12,
      textColor: '#000000',
      backgroundColor: null,
      borderColor: null,
      borderWidth: 1,
    },
    format: { type: 'none', pattern: null },
  };
}

/**
 * Extract every AcroForm field with a widget, grouped by its 1-based page.
 * Fields without a widget (`/Rect` + `/P`) are skipped — they aren't page
 * elements. Reads the whole form once (efficient for the multi-page parse).
 */
export async function extractFormFieldsByPage(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<Map<number, FormFieldElement[]>> {
  const byPage = new Map<number, FormFieldElement[]>();
  try {
    const giga = await getEngine();
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = giga.open(bytes);
    try {
      for (const field of doc.fields()) {
        if (field.page === undefined || !field.bounds || !field.name) continue;
        const element = toElement(field);
        const list = byPage.get(field.page) ?? [];
        list.push(element);
        byPage.set(field.page, list);
      }
    } finally {
      doc.close();
    }
  } catch {
    // leave the map empty on failure
  }
  return byPage;
}

/** Form fields on a single page (convenience wrapper over the grouped map). */
export async function extractFormFieldElements(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  pageNumber: number,
): Promise<FormFieldElement[]> {
  return (await extractFormFieldsByPage(pdfBytes)).get(pageNumber) ?? [];
}
