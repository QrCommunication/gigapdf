/**
 * AcroForm filling via the zero-dependency WASM engine. We take a typed
 * snapshot of the fields first (via {@link getFormFields}) so we know each
 * field's kind and previous value, then dispatch every requested value to the
 * matching engine setter (`setTextField` / `setCheckbox` / `setRadio` /
 * `setChoice`). No pdf-lib.
 */

import { getEngine } from '../wasm';
import { PDFParseError } from '../errors';
import { getFormFields, type FillResult, type FormFieldInfo } from './reader';

export async function fillForm(
  buffer: Buffer,
  values: Record<string, string | boolean | string[]>,
): Promise<{ buffer: Buffer; results: FillResult[] }> {
  // Typed snapshot: field kind + current value, for dispatch and `oldValue`.
  const snapshot = new Map<string, FormFieldInfo>();
  for (const field of await getFormFields(buffer)) {
    snapshot.set(field.fieldName, field);
  }

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
    const results: FillResult[] = [];

    for (const [fieldName, newValue] of Object.entries(values)) {
      const info = snapshot.get(fieldName);
      const oldValue = info?.value ?? '';

      if (!info) {
        results.push({
          fieldName,
          success: false,
          oldValue,
          newValue,
          error: 'Field not found',
        });
        continue;
      }

      let ok = false;
      switch (info.fieldType) {
        case 'text':
          ok = doc.setTextField(fieldName, String(newValue));
          break;
        case 'checkbox':
          ok = doc.setCheckbox(fieldName, Boolean(newValue));
          break;
        case 'radio':
          ok = doc.setRadio(fieldName, String(newValue));
          break;
        case 'dropdown':
        case 'listbox': {
          const choices = Array.isArray(newValue)
            ? newValue.map(String)
            : [String(newValue)];
          ok = doc.setChoice(fieldName, choices);
          break;
        }
        default:
          results.push({
            fieldName,
            success: false,
            oldValue,
            newValue,
            error: 'Field type not supported for filling',
          });
          continue;
      }

      results.push({
        fieldName,
        success: ok,
        oldValue,
        newValue,
        ...(ok ? {} : { error: 'Engine rejected the value' }),
      });
    }

    return { buffer: Buffer.from(doc.save()), results };
  } finally {
    doc.close();
  }
}
