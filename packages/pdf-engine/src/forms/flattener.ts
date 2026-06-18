/**
 * Form flattening via the zero-dependency WASM engine. `doc.flattenForm()`
 * bakes every field widget across all pages into the page content and drops
 * `/AcroForm`, so the result is no longer fillable. No pdf-lib.
 */

import { getEngine } from '../wasm';
import { PDFParseError } from '../errors';

export async function flattenForm(buffer: Buffer): Promise<Buffer> {
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
    doc.flattenForm();
    return Buffer.from(doc.save());
  } finally {
    doc.close();
  }
}
