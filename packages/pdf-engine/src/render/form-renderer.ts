import {
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
} from 'pdf-lib';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { FormFieldElement } from '@giga-pdf/types';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';

function getPage(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  return handle._pdfDoc.getPage(pageNumber - 1);
}

export function addFormField(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: FormFieldElement,
): void {
  const form = handle._pdfDoc.getForm();
  const page = getPage(handle, pageNumber);
  const pageH = page.getHeight();
  const pdfRect = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    pageH,
  );

  const fieldDimensions = {
    x: pdfRect.x,
    y: pdfRect.y,
    width: pdfRect.width,
    height: pdfRect.height,
  };

  switch (element.fieldType) {
    case 'text': {
      const field = form.createTextField(element.fieldName);
      field.addToPage(page, fieldDimensions);
      if (typeof element.value === 'string') field.setText(element.value);
      if (element.properties.readOnly) field.enableReadOnly();
      if (element.properties.multiline) field.enableMultiline();
      break;
    }

    case 'checkbox': {
      const field = form.createCheckBox(element.fieldName);
      field.addToPage(page, fieldDimensions);
      if (element.value === true) field.check();
      if (element.properties.readOnly) field.enableReadOnly();
      break;
    }

    case 'radio': {
      const field = form.createRadioGroup(element.fieldName);
      const optionValue = typeof element.value === 'string' ? element.value : 'option';
      field.addOptionToPage(optionValue, page, fieldDimensions);
      if (element.properties.readOnly) field.enableReadOnly();
      break;
    }

    case 'dropdown': {
      const field = form.createDropdown(element.fieldName);
      if (element.options) field.addOptions(element.options);
      field.addToPage(page, fieldDimensions);
      if (typeof element.value === 'string') field.select(element.value);
      if (element.properties.readOnly) field.enableReadOnly();
      break;
    }

    case 'listbox': {
      const field = form.createOptionList(element.fieldName);
      if (element.options) field.addOptions(element.options);
      field.addToPage(page, fieldDimensions);
      if (typeof element.value === 'string') field.select(element.value);
      if (element.properties.readOnly) field.enableReadOnly();
      break;
    }

    case 'button':
    case 'signature':
    default:
      break;
  }

  markDirty(handle._pdfDoc);
}

export function updateFormFieldValue(
  handle: PDFDocumentHandle,
  fieldName: string,
  value: string | boolean | string[],
): boolean {
  const form = handle._pdfDoc.getForm();

  try {
    const field = form.getField(fieldName);

    if (field instanceof PDFTextField) {
      field.setText(String(value));
    } else if (field instanceof PDFCheckBox) {
      if (value) {
        field.check();
      } else {
        field.uncheck();
      }
    } else if (field instanceof PDFRadioGroup) {
      field.select(String(value));
    } else if (field instanceof PDFDropdown) {
      field.select(String(value));
    } else if (field instanceof PDFOptionList) {
      field.select(String(value));
    } else {
      return false;
    }

    markDirty(handle._pdfDoc);
    return true;
  } catch {
    return false;
  }
}
