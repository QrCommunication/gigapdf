import {
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFName,
  PDFHexString,
  TextAlignment,
  type PDFField,
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

/** Map the element textAlign to pdf-lib's TextAlignment (/Q entry). */
function toTextAlignment(align: 'left' | 'center' | 'right' | undefined): TextAlignment {
  switch (align) {
    case 'center':
      return TextAlignment.Center;
    case 'right':
      return TextAlignment.Right;
    case 'left':
    default:
      return TextAlignment.Left;
  }
}

/**
 * Apply the flags/metadata shared by every AcroForm field type:
 * required, readOnly, and the /TU tooltip (alternate description, also
 * read by screen readers).
 */
function applyCommonFieldProps(field: PDFField, element: FormFieldElement): void {
  if (element.properties.required) field.enableRequired();
  if (element.properties.readOnly) field.enableReadOnly();
  const tooltip = element.tooltip;
  if (tooltip && tooltip.trim().length > 0) {
    field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(tooltip));
  }
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

  const fontSize =
    typeof element.style?.fontSize === 'number' && element.style.fontSize > 0
      ? element.style.fontSize
      : null;

  switch (element.fieldType) {
    case 'text': {
      const field = form.createTextField(element.fieldName);
      // Multiline/password/comb/maxLength must be set BEFORE addToPage so the
      // initial appearance stream is generated with the right flags.
      if (element.properties.multiline) field.enableMultiline();
      if (element.properties.password) field.enablePassword();
      if (
        typeof element.properties.maxLength === 'number' &&
        element.properties.maxLength > 0
      ) {
        field.setMaxLength(element.properties.maxLength);
        if (element.properties.comb) field.enableCombing();
      }
      field.setAlignment(toTextAlignment(element.style?.textAlign));
      // value wins over defaultValue; defaultValue pre-fills an empty field.
      const text =
        typeof element.value === 'string' && element.value !== ''
          ? element.value
          : typeof element.defaultValue === 'string'
            ? element.defaultValue
            : '';
      if (text !== '') field.setText(text);
      field.addToPage(page, fieldDimensions);
      // setFontSize requires the /DA default-appearance entry, which is only
      // created by addToPage — calling it earlier throws MissingDAEntryError.
      if (fontSize !== null) field.setFontSize(fontSize);
      applyCommonFieldProps(field, element);
      break;
    }

    case 'checkbox': {
      const field = form.createCheckBox(element.fieldName);
      field.addToPage(page, fieldDimensions);
      const checked = element.value === true || (element.value !== false && element.defaultValue === true);
      if (checked) field.check();
      applyCommonFieldProps(field, element);
      break;
    }

    case 'radio': {
      // Radio widgets sharing the same fieldName join the SAME group: pdf-lib
      // getRadioGroup throws if absent, so create-or-reuse keeps N widgets of
      // one logical group under a single /Ff radio field.
      let field: PDFRadioGroup;
      try {
        field = form.getRadioGroup(element.fieldName);
      } catch {
        field = form.createRadioGroup(element.fieldName);
      }
      const optionValue =
        typeof element.value === 'string' && element.value !== ''
          ? element.value
          : `option_${field.getOptions().length + 1}`;
      field.addOptionToPage(optionValue, page, fieldDimensions);
      // defaultValue carries the export value of the pre-selected widget.
      if (
        typeof element.defaultValue === 'string' &&
        element.defaultValue !== '' &&
        element.defaultValue === optionValue
      ) {
        field.select(optionValue);
      }
      applyCommonFieldProps(field, element);
      break;
    }

    case 'dropdown': {
      const field = form.createDropdown(element.fieldName);
      if (element.options && element.options.length > 0) {
        field.addOptions(element.options);
      }
      const selected =
        typeof element.value === 'string' && element.value !== ''
          ? element.value
          : typeof element.defaultValue === 'string'
            ? element.defaultValue
            : '';
      if (selected !== '' && (element.options ?? []).includes(selected)) {
        field.select(selected);
      }
      field.addToPage(page, fieldDimensions);
      // /DA only exists after addToPage (cf. text field above).
      if (fontSize !== null) field.setFontSize(fontSize);
      applyCommonFieldProps(field, element);
      break;
    }

    case 'listbox': {
      const field = form.createOptionList(element.fieldName);
      if (element.options && element.options.length > 0) {
        field.addOptions(element.options);
      }
      const selected =
        typeof element.value === 'string' && element.value !== ''
          ? element.value
          : typeof element.defaultValue === 'string'
            ? element.defaultValue
            : '';
      if (selected !== '' && (element.options ?? []).includes(selected)) {
        field.select(selected);
      }
      field.addToPage(page, fieldDimensions);
      // /DA only exists after addToPage (cf. text field above).
      if (fontSize !== null) field.setFontSize(fontSize);
      applyCommonFieldProps(field, element);
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
