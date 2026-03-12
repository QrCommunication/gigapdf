import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type { FormFieldElement, FieldType } from '@giga-pdf/types';
import { pdfToWeb } from '../utils';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; }

const FLAG_RADIO = 1 << 15;
const FLAG_PUSHBUTTON = 1 << 16;

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

    const multilineFlag = 1 << 12;
    const passwordFlag = 1 << 13;
    const combFlag = 1 << 24;
    const isMultiline = !!(fieldFlags & multilineFlag);
    const isPassword = !!(fieldFlags & passwordFlag);
    const isComb = !!(fieldFlags & combFlag);

    elements.push({
      elementId: randomUUID(),
      type: 'form_field',
      bounds,
      transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      layerId: null,
      locked: false,
      visible: true,
      fieldType: resolvedType,
      fieldName: annotation.fieldName as string ?? '',
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
