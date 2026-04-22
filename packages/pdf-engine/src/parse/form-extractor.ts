import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { createHash } from 'node:crypto';
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFButton,
  PDFSignature,
  PDFName,
  PDFString,
  PDFHexString,
} from 'pdf-lib';
import type { FormFieldElement, FieldType } from '@giga-pdf/types';
import { pdfToWeb } from '../utils';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; }

// ---------------------------------------------------------------------------
// Ff flag constants (PDF spec Table 228 / 232)
// ---------------------------------------------------------------------------
const FLAG_RADIO       = 1 << 15;
const FLAG_PUSHBUTTON  = 1 << 16;
const FLAG_MULTILINE   = 1 << 12;
const FLAG_PASSWORD    = 1 << 13;
const FLAG_COMB        = 1 << 24;

// ---------------------------------------------------------------------------
// Public types for the enriched AcroForm extractor
// ---------------------------------------------------------------------------

/**
 * Extended form field type that distinguishes textarea (multiline Tx)
 * from plain text, and maps to all PDF widget sub-types.
 */
export type FormFieldType =
  | 'text'        // /Tx single-line
  | 'textarea'    // /Tx with Ff bit 13 (multiline)
  | 'checkbox'    // /Btn with no radio/pushbutton flags
  | 'radio'       // /Btn with radio flag (bit 16)
  | 'select'      // /Ch combo (Ff bit 18)
  | 'listbox'     // /Ch list (no combo flag)
  | 'button'      // /Btn pushbutton (Ff bit 17)
  | 'signature';  // /Sig

export interface FormField {
  /** Stable UUID derived from fieldName + pageNumber */
  elementId: string;
  /** 1-based page number */
  pageNumber: number;
  /** Full hierarchical name (/T, parent.child notation) */
  fieldName: string;
  fieldType: FormFieldType;
  /** Bounds in web coordinates (top-left origin, Y downward, in PDF points) */
  bounds: { x: number; y: number; width: number; height: number };
  /** Current value — type depends on fieldType */
  value: string | string[] | boolean | null;
  /** Options for radio groups, dropdowns and listboxes */
  options?: { label: string; value: string }[];
  required?: boolean;
  readonly?: boolean;
  multiline?: boolean;
  maxLength?: number;
  /** /TU — alternate field name (tooltip shown in readers) */
  alternateText?: string;
  /** /TM — mapping name for export */
  mappingName?: string;
  /** Default value as stored in the PDF */
  defaultValue?: string | string[] | boolean | null;
  /** Appearance hints derived from the /DA (Default Appearance) stream */
  appearance?: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    alignment?: 'left' | 'center' | 'right';
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a stable UUID-formatted string from fieldName + pageNumber so that
 * re-parsing the same PDF yields the same IDs.
 */
function stableUUID(fieldName: string, pageNumber: number): string {
  const hash = createHash('sha256')
    .update(`${fieldName}:${pageNumber}`)
    .digest('hex');
  // Format as UUID v4 shape (8-4-4-4-12)
  const c16 = hash[16] ?? '0';
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),                                         // version 4
    ((parseInt(c16, 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), // variant
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Parse a PDF Default Appearance (/DA) string and extract
 * font name, font size, and color.
 *
 * Example DA values:
 *   "/Helvetica 12 Tf 0 g"
 *   "/Arial,Bold 10 Tf 0.1 0.2 0.3 rg"
 */
function parseDefaultAppearance(da: string | undefined): FormField['appearance'] {
  if (!da) return undefined;

  const appearance: FormField['appearance'] = {};

  // Font & size: /FontName size Tf
  const tfMatch = da.match(/\/([^\s]+)\s+([\d.]+)\s+Tf/);
  if (tfMatch) {
    appearance.fontFamily = tfMatch[1] ?? undefined;
    const size = parseFloat(tfMatch[2] ?? '0');
    if (!isNaN(size) && size > 0) appearance.fontSize = size;
  }

  // Color: RGB "r g b rg"
  const rgbMatch = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
  if (rgbMatch) {
    const r = Math.round(parseFloat(rgbMatch[1] ?? '0') * 255);
    const g = Math.round(parseFloat(rgbMatch[2] ?? '0') * 255);
    const b = Math.round(parseFloat(rgbMatch[3] ?? '0') * 255);
    appearance.color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  } else {
    // Grayscale "g G"
    const grayMatch = da.match(/([\d.]+)\s+g(?:\s|$)/);
    if (grayMatch) {
      const v = Math.round(parseFloat(grayMatch[1] ?? '0') * 255);
      appearance.color = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
    }
  }

  return Object.keys(appearance).length > 0 ? appearance : undefined;
}

/**
 * Safely read a string-like PDF object from a dictionary key.
 */
function dictString(
  dict: ReturnType<typeof PDFDocument.prototype.context.lookup> extends infer T ? T : never,
  key: string,
): string | undefined {
  try {
    // dict is a PDFDict — access via the low-level dict property on acroField
    const raw = (dict as unknown as { get: (k: ReturnType<typeof PDFName.of>) => unknown }).get(PDFName.of(key));
    if (raw instanceof PDFString) return raw.asString();
    if (raw instanceof PDFHexString) return raw.decodeText();
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Map a pdf-lib alignment value (0=left, 1=center, 2=right) to a CSS string.
 */
function mapAlignment(value: number | undefined): 'left' | 'center' | 'right' | undefined {
  if (value === 1) return 'center';
  if (value === 2) return 'right';
  if (value === 0) return 'left';
  return undefined;
}

// ---------------------------------------------------------------------------
// Main enriched extractor (pdf-lib based)
// ---------------------------------------------------------------------------

/**
 * Extract all AcroForm fields from a PDF with rich metadata.
 *
 * Uses pdf-lib for reliable AcroForm parsing (more stable than pdfjs for forms).
 * Returns an empty array if the PDF has no AcroForm or on any parsing failure.
 *
 * @param pdfBytes - Raw PDF bytes
 * @param pageNumber - Optional 1-based page filter; omit to return all pages
 */
export async function extractFormFields(
  pdfBytes: ArrayBuffer | Uint8Array,
  pageNumber?: number,
): Promise<FormField[]> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch {
    return [];
  }

  let form: ReturnType<PDFDocument['getForm']>;
  try {
    form = pdfDoc.getForm();
  } catch {
    // PDF has no AcroForm
    return [];
  }

  // Build a map from page PDFRef object-number → 1-based page number + height
  const pages = pdfDoc.getPages();
  const pageInfoByRefObjNum = new Map<number, { pageNumber: number; height: number }>();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!page) continue;
    // page.ref is a PDFRef — use its objectNumber as key
    const refObjNum = (page.ref as unknown as { objectNumber: number }).objectNumber;
    pageInfoByRefObjNum.set(refObjNum, { pageNumber: i + 1, height: page.getHeight() });
  }

  // Fallback page height (used when widget has no /P reference)
  const firstPage = pages[0];
  const fallbackHeight = firstPage !== undefined ? firstPage.getHeight() : 792;
  const fallbackPage = 1;

  let fields: ReturnType<typeof form.getFields>;
  try {
    fields = form.getFields();
  } catch {
    return [];
  }

  const results: FormField[] = [];

  for (const field of fields) {
    try {
      const name = field.getName();

      // Determine enriched field type
      let fieldType: FormFieldType;
      if (field instanceof PDFTextField) {
        fieldType = field.isMultiline() ? 'textarea' : 'text';
      } else if (field instanceof PDFCheckBox) {
        fieldType = 'checkbox';
      } else if (field instanceof PDFRadioGroup) {
        fieldType = 'radio';
      } else if (field instanceof PDFDropdown) {
        fieldType = 'select';
      } else if (field instanceof PDFOptionList) {
        fieldType = 'listbox';
      } else if (field instanceof PDFButton) {
        fieldType = 'button';
      } else if (field instanceof PDFSignature) {
        fieldType = 'signature';
      } else {
        // Unknown sub-type — skip
        continue;
      }

      // Extract value
      let value: FormField['value'] = null;
      let defaultValue: FormField['value'] = null;
      if (field instanceof PDFTextField) {
        const text = field.getText() ?? null;
        value = text;
        defaultValue = text; // pdf-lib does not expose a separate DV for text
      } else if (field instanceof PDFCheckBox) {
        const checked = field.isChecked();
        value = checked;
        defaultValue = checked;
      } else if (field instanceof PDFRadioGroup) {
        const sel = field.getSelected();
        value = sel ?? null;
        defaultValue = sel ?? null;
      } else if (field instanceof PDFDropdown) {
        const sel = field.getSelected();
        value = sel.length === 1 ? (sel[0] ?? null) : sel.length > 1 ? sel : null;
        defaultValue = value;
      } else if (field instanceof PDFOptionList) {
        const sel = field.getSelected();
        value = sel.length > 0 ? sel : null;
        defaultValue = value;
      }

      // Options (radio, dropdown, listbox)
      let options: FormField['options'];
      if (field instanceof PDFRadioGroup) {
        const rawOpts = field.getOptions();
        options = rawOpts.map((o) => ({ label: o, value: o }));
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        const rawOpts = field.getOptions();
        options = rawOpts.map((o) => ({ label: o, value: o }));
      }

      // Low-level acroField dict access for TU (alternate text) and TM (mapping name)
      // pdf-lib exposes .acroField on the high-level field class
      const acroField = (field as unknown as { acroField: { dict: unknown; getDefaultAppearance: () => string | undefined } }).acroField;
      const alternateName = acroField?.dict ? dictString(acroField.dict as Parameters<typeof dictString>[0], 'TU') : undefined;
      const mappingName = acroField?.dict ? dictString(acroField.dict as Parameters<typeof dictString>[0], 'TM') : undefined;
      const daString = acroField?.getDefaultAppearance?.();

      // Widget annotations — first widget drives bounds and page
      const widgets = acroField?.dict
        ? (() => {
            try {
              return (acroField as unknown as { getWidgets: () => Array<{ getRectangle: () => { x: number; y: number; width: number; height: number }; P: () => { objectNumber: number } | undefined }> }).getWidgets();
            } catch {
              return [];
            }
          })()
        : [];

      // Process each widget individually (radio groups have one widget per option)
      const widgetsToProcess = widgets.length > 0 ? widgets : [null];

      for (let widgetIdx = 0; widgetIdx < widgetsToProcess.length; widgetIdx++) {
        const widget = widgetsToProcess[widgetIdx];

        // Resolve page info
        let resolvedPageNumber = fallbackPage;
        let pageHeight = fallbackHeight;
        if (widget) {
          try {
            const pageRef = widget.P();
            if (pageRef) {
              const info = pageInfoByRefObjNum.get(pageRef.objectNumber);
              if (info) {
                resolvedPageNumber = info.pageNumber;
                pageHeight = info.height;
              }
            }
          } catch {
            // Keep fallback
          }
        }

        // Apply page filter
        if (pageNumber !== undefined && resolvedPageNumber !== pageNumber) {
          continue;
        }

        // Bounds
        let bounds: FormField['bounds'] = { x: 0, y: 0, width: 0, height: 0 };
        if (widget) {
          try {
            const rect = widget.getRectangle();
            const webBounds = pdfToWeb(rect.x, rect.y, rect.width, rect.height, pageHeight);
            bounds = webBounds;
          } catch {
            // Keep zero bounds
          }
        }

        // Appearance alignment (PDFTextField only)
        let alignmentValue: 'left' | 'center' | 'right' | undefined;
        if (field instanceof PDFTextField) {
          alignmentValue = mapAlignment(field.getAlignment());
        }
        const baseAppearance = parseDefaultAppearance(daString);
        const appearance: FormField['appearance'] = baseAppearance
          ? { ...baseAppearance, ...(alignmentValue ? { alignment: alignmentValue } : {}) }
          : alignmentValue
          ? { alignment: alignmentValue }
          : undefined;

        // For radio groups: widget index corresponds to option, use per-option name for uniqueness
        const optionSuffix = field instanceof PDFRadioGroup && widgetIdx > 0 ? `:widget${widgetIdx}` : '';
        const uniqueId = stableUUID(`${name}${optionSuffix}`, resolvedPageNumber);

        const formField: FormField = {
          elementId: uniqueId,
          pageNumber: resolvedPageNumber,
          fieldName: name,
          fieldType,
          bounds,
          value,
          ...(options ? { options } : {}),
          required: field.isRequired(),
          readonly: field.isReadOnly(),
          ...(field instanceof PDFTextField && field.isMultiline() ? { multiline: true } : {}),
          ...(field instanceof PDFTextField && field.getMaxLength() !== undefined
            ? { maxLength: field.getMaxLength() }
            : {}),
          ...(alternateName ? { alternateText: alternateName } : {}),
          ...(mappingName ? { mappingName } : {}),
          defaultValue,
          ...(appearance ? { appearance } : {}),
        };

        results.push(formField);
      }
    } catch {
      // Skip malformed fields gracefully
      continue;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Legacy extractor — kept for backward-compatibility with parser.ts
// (pdfjs-dist based, returns FormFieldElement matching @giga-pdf/types)
// ---------------------------------------------------------------------------

function resolveFieldType(
  fieldType: string,
  fieldFlags: number,
): FieldType {
  if (fieldType === 'Tx') return 'text';
  if (fieldType === 'Sig') return 'signature';
  if (fieldType === 'Ch') {
    const isCombo = !!(fieldFlags & (1 << 17));
    return isCombo ? 'dropdown' : 'listbox';
  }
  if (fieldType === 'Btn') {
    const isRadio = !!(fieldFlags & FLAG_RADIO);
    const isPushButton = !!(fieldFlags & FLAG_PUSHBUTTON);
    if (isPushButton) return 'button';
    if (isRadio) return 'radio';
    return 'checkbox';
  }
  return 'text';
}

export async function extractFormFieldElements(
  page: PDFPageProxy,
  _pageNumber: number,
  pageHeight: number,
): Promise<FormFieldElement[]> {
  const annotations = await page.getAnnotations();
  const elements: FormFieldElement[] = [];

  for (const annotation of annotations) {
    if (annotation.subtype !== 'Widget') continue;

    const [x1, y1, x2, y2] = annotation.rect as number[];
    const width = Math.abs((x2 ?? 0) - (x1 ?? 0));
    const height = Math.abs((y2 ?? 0) - (y1 ?? 0));
    const bounds = pdfToWeb(x1 ?? 0, y1 ?? 0, width, height, pageHeight);

    const fieldType = annotation.fieldType as string ?? 'Tx';
    const fieldFlags = annotation.fieldFlags as number ?? 0;
    const resolvedType = resolveFieldType(fieldType, fieldFlags);

    const rawValue = annotation.fieldValue as string | boolean | string[] | undefined;
    const value: string | boolean | string[] =
      rawValue !== undefined ? rawValue : '';

    const rawOptions = annotation.options as Array<{ displayValue: string; exportValue: string }> | undefined;
    const options: string[] | null = rawOptions
      ? rawOptions.map((o) => o.displayValue ?? o.exportValue)
      : null;

    const isMultiline = !!(fieldFlags & FLAG_MULTILINE);
    const isPassword = !!(fieldFlags & FLAG_PASSWORD);
    const isComb = !!(fieldFlags & FLAG_COMB);

    // Stable UUID via hash (consistent with enriched extractor style)
    const fieldName = annotation.fieldName as string ?? '';
    const elementId = stableUUID(fieldName, _pageNumber);

    elements.push({
      elementId,
      type: 'form_field',
      bounds,
      transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      layerId: null,
      locked: false,
      visible: true,
      fieldType: resolvedType,
      fieldName,
      value,
      defaultValue: value,
      options,
      properties: {
        required: !!(annotation.required as boolean | undefined),
        readOnly: !!(annotation.readOnly as boolean | undefined),
        maxLength: annotation.maxLen as number | null ?? null,
        multiline: isMultiline,
        password: isPassword,
        comb: isComb,
      },
      style: {
        fontFamily: 'Helvetica',
        fontSize: 12,
        textColor: '#000000',
        backgroundColor: null,
        borderColor: null,
        borderWidth: 1,
      },
      format: {
        type: 'none',
        pattern: null,
      },
    });
  }

  return elements;
}
