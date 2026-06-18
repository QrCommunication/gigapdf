/**
 * Form-field renderer — creates AcroForm fields via the zero-dependency engine.
 * No pdf-lib.
 *
 * Fidelity note: the engine's field creators cover the core props (value,
 * maxLen, multiline, password, options, selected, font size/colour/border).
 * A few secondary flags the old pdf-lib path set — `/Q` alignment, comb,
 * `/TU` tooltip, required/readOnly — are not yet exposed by the engine and are
 * dropped here; multi-widget radio groups created one widget at a time degrade
 * to one single-button group per call.
 */

import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { FieldStyle } from '@qrcommunication/gigapdf-lib';
import type { FormFieldElement } from '@giga-pdf/types';
import { hexToPackedRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';

function pageHeightOf(handle: PDFDocumentHandle, pageNumber: number): number {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  return handle._doc.pageInfo(pageNumber).height;
}

function buildStyle(element: FormFieldElement, fontSize: number | null): FieldStyle {
  const style: FieldStyle = {};
  if (fontSize !== null) style.fontSize = fontSize;
  if (element.style?.textColor) style.color = hexToPackedRgb(element.style.textColor);
  style.border = element.style?.borderColor ? hexToPackedRgb(element.style.borderColor) : null;
  style.background = element.style?.backgroundColor
    ? hexToPackedRgb(element.style.backgroundColor)
    : null;
  if (typeof element.style?.borderWidth === 'number') style.borderWidth = element.style.borderWidth;
  return style;
}

export function addFormField(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: FormFieldElement,
): void {
  const pageH = pageHeightOf(handle, pageNumber);
  const doc = handle._doc;
  const pdf = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    pageH,
  );
  const rect: [number, number, number, number] = [pdf.x, pdf.y, pdf.x + pdf.width, pdf.y + pdf.height];

  const fontSize =
    typeof element.style?.fontSize === 'number' && element.style.fontSize > 0
      ? element.style.fontSize
      : null;
  const style = buildStyle(element, fontSize);

  switch (element.fieldType) {
    case 'text': {
      const value =
        typeof element.value === 'string' && element.value !== ''
          ? element.value
          : typeof element.defaultValue === 'string'
            ? element.defaultValue
            : '';
      const opts: { maxLen?: number; multiline?: boolean; password?: boolean; style?: FieldStyle } =
        { style };
      if (element.properties.multiline) opts.multiline = true;
      if (element.properties.password) opts.password = true;
      if (typeof element.properties.maxLength === 'number' && element.properties.maxLength > 0) {
        opts.maxLen = element.properties.maxLength;
      }
      doc.addTextField(pageNumber, element.fieldName, rect, value, opts);
      break;
    }

    case 'checkbox': {
      const checked =
        element.value === true || (element.value !== false && element.defaultValue === true);
      doc.addCheckbox(pageNumber, element.fieldName, rect, checked, { style });
      break;
    }

    case 'radio': {
      const optionValue =
        typeof element.value === 'string' && element.value !== '' ? element.value : 'option_1';
      const opts: { selected?: string; style?: FieldStyle } = { style };
      if (typeof element.defaultValue === 'string' && element.defaultValue === optionValue) {
        opts.selected = optionValue;
      }
      doc.addRadioGroup(pageNumber, element.fieldName, [{ export: optionValue, rect }], opts);
      break;
    }

    case 'dropdown': {
      const options = element.options ?? [];
      const selected =
        typeof element.value === 'string' && element.value !== ''
          ? element.value
          : typeof element.defaultValue === 'string'
            ? element.defaultValue
            : '';
      const opts: { selected?: string; editable?: boolean; style?: FieldStyle } = { style };
      if (selected !== '' && options.includes(selected)) opts.selected = selected;
      doc.addComboBox(pageNumber, element.fieldName, rect, options, opts);
      break;
    }

    case 'listbox': {
      const options = element.options ?? [];
      const selected =
        typeof element.value === 'string' && element.value !== ''
          ? element.value
          : typeof element.defaultValue === 'string'
            ? element.defaultValue
            : '';
      const opts: { selected?: string; multi?: boolean; style?: FieldStyle } = { style };
      if (selected !== '' && options.includes(selected)) opts.selected = selected;
      doc.addListBox(pageNumber, element.fieldName, rect, options, opts);
      break;
    }

    case 'button':
    case 'signature':
    default:
      break;
  }

  markDirty(doc);
}

export function updateFormFieldValue(
  handle: PDFDocumentHandle,
  fieldName: string,
  value: string | boolean | string[],
): boolean {
  const doc = handle._doc;

  // Discover the field's kind from the current snapshot to dispatch correctly.
  const field = doc.fields().find((f) => f.name === fieldName);
  if (!field) return false;

  let ok = false;
  switch (field.kind) {
    case 'text':
      ok = doc.setTextField(fieldName, String(value));
      break;
    case 'checkbox':
      ok = doc.setCheckbox(fieldName, Boolean(value));
      break;
    case 'radio':
      ok = doc.setRadio(fieldName, String(value));
      break;
    case 'combo':
    case 'list':
      ok = doc.setChoice(fieldName, Array.isArray(value) ? value.map(String) : [String(value)]);
      break;
    default:
      return false;
  }

  if (ok) markDirty(doc);
  return ok;
}
