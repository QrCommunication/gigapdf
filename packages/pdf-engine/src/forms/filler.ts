import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
} from 'pdf-lib';
import { PDFParseError } from '../errors';
import type { FillResult } from './reader';

export async function fillForm(
  buffer: Buffer,
  values: Record<string, string | boolean | string[]>,
): Promise<{ buffer: Buffer; results: FillResult[] }> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (err) {
    throw new PDFParseError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const form = pdfDoc.getForm();
  const results: FillResult[] = [];

  for (const [fieldName, newValue] of Object.entries(values)) {
    let oldValue: string | boolean | string[] = '';

    try {
      const field = form.getField(fieldName);

      if (field instanceof PDFTextField) {
        oldValue = field.getText() ?? '';
        field.setText(String(newValue));
      } else if (field instanceof PDFCheckBox) {
        oldValue = field.isChecked();
        if (newValue) {
          field.check();
        } else {
          field.uncheck();
        }
      } else if (field instanceof PDFRadioGroup) {
        oldValue = field.getSelected() ?? '';
        field.select(String(newValue));
      } else if (field instanceof PDFDropdown) {
        oldValue = field.getSelected();
        if (Array.isArray(newValue)) {
          for (const option of newValue) {
            field.select(option, false);
          }
        } else {
          field.select(String(newValue));
        }
      } else if (field instanceof PDFOptionList) {
        oldValue = field.getSelected();
        if (Array.isArray(newValue)) {
          for (const option of newValue) {
            field.select(option, false);
          }
        } else {
          field.select(String(newValue));
        }
      } else {
        results.push({
          fieldName,
          success: false,
          oldValue,
          newValue,
          error: `Field type not supported for filling`,
        });
        continue;
      }

      results.push({
        fieldName,
        success: true,
        oldValue,
        newValue,
      });
    } catch (err) {
      results.push({
        fieldName,
        success: false,
        oldValue,
        newValue,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const bytes = await pdfDoc.save({ useObjectStreams: true });
  return { buffer: Buffer.from(bytes), results };
}
