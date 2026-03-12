import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFButton,
  PDFSignature,
} from 'pdf-lib';
import type { Bounds } from '@giga-pdf/types';
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

export async function getFormFields(buffer: Buffer): Promise<FormFieldInfo[]> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (err) {
    throw new PDFParseError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const form = pdfDoc.getForm();
  const fields = form.getFields();
  const pages = pdfDoc.getPages();
  const results: FormFieldInfo[] = [];

  for (const field of fields) {
    const widgets = field.acroField.getWidgets();
    if (widgets.length === 0) continue;

    const widget = widgets[0]!;
    const rect = widget.getRectangle();

    let pageNumber = 1;
    let pageHeight = 792;

    const pageRef = widget.P();
    if (pageRef) {
      for (let i = 0; i < pages.length; i++) {
        if (pages[i]!.ref === pageRef) {
          pageNumber = i + 1;
          pageHeight = pages[i]!.getHeight();
          break;
        }
      }
    }

    const bounds: Bounds = {
      x: rect.x,
      y: pageHeight - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
    };

    const readOnly = field.isReadOnly();

    if (field instanceof PDFTextField) {
      const maxLengthRaw = field.getMaxLength();
      results.push({
        fieldName: field.getName(),
        fieldType: 'text',
        value: field.getText() ?? '',
        defaultValue: '',
        pageNumber,
        bounds,
        options: null,
        properties: {
          required: false,
          readOnly,
          maxLength: maxLengthRaw !== undefined ? maxLengthRaw : null,
          multiline: field.isMultiline(),
        },
      });
    } else if (field instanceof PDFCheckBox) {
      results.push({
        fieldName: field.getName(),
        fieldType: 'checkbox',
        value: field.isChecked(),
        defaultValue: false,
        pageNumber,
        bounds,
        options: null,
        properties: {
          required: false,
          readOnly,
          maxLength: null,
          multiline: false,
        },
      });
    } else if (field instanceof PDFRadioGroup) {
      results.push({
        fieldName: field.getName(),
        fieldType: 'radio',
        value: field.getSelected() ?? '',
        defaultValue: '',
        pageNumber,
        bounds,
        options: field.getOptions(),
        properties: {
          required: false,
          readOnly,
          maxLength: null,
          multiline: false,
        },
      });
    } else if (field instanceof PDFDropdown) {
      results.push({
        fieldName: field.getName(),
        fieldType: 'dropdown',
        value: field.getSelected(),
        defaultValue: [],
        pageNumber,
        bounds,
        options: field.getOptions(),
        properties: {
          required: false,
          readOnly,
          maxLength: null,
          multiline: false,
        },
      });
    } else if (field instanceof PDFOptionList) {
      results.push({
        fieldName: field.getName(),
        fieldType: 'listbox',
        value: field.getSelected(),
        defaultValue: [],
        pageNumber,
        bounds,
        options: field.getOptions(),
        properties: {
          required: false,
          readOnly,
          maxLength: null,
          multiline: false,
        },
      });
    } else if (field instanceof PDFButton) {
      results.push({
        fieldName: field.getName(),
        fieldType: 'button',
        value: '',
        defaultValue: '',
        pageNumber,
        bounds,
        options: null,
        properties: {
          required: false,
          readOnly,
          maxLength: null,
          multiline: false,
        },
      });
    } else if (field instanceof PDFSignature) {
      results.push({
        fieldName: field.getName(),
        fieldType: 'signature',
        value: '',
        defaultValue: '',
        pageNumber,
        bounds,
        options: null,
        properties: {
          required: false,
          readOnly,
          maxLength: null,
          multiline: false,
        },
      });
    }
  }

  return results;
}
