/**
 * Flatten **Form XObjects** so invoice/template text (which the engine stores
 * inside reusable form XObjects) becomes ordinary page content with real,
 * editable run indices.
 *
 * This is distinct from {@link flattenForm} in `./flattener`, which flattens
 * **AcroForm** interactive fields (and drops `/AcroForm`). Here we inline the
 * `/Fm… Do` form-XObject invocations on every page via the engine's
 * `flattenFormXObjects(page)`. Visually the page renders identically; only the
 * internal structure changes — afterwards a re-parse gives each former
 * form-XObject text run a valid index, so the editor's in-place edit path
 * (replaceText / moveElement / removeElement) fires instead of the redact+add
 * overlay.
 *
 * No-op guarantee: if the document contains no form XObjects (the engine
 * inlines 0), the original `inputBytes` are returned **unchanged** and never
 * re-serialised — so form-less PDFs stay byte-identical with zero behavioural
 * change.
 */

import { openDocument, saveDocument, closeDocument } from '../engine/document-handle';

export interface FlattenFormsResult {
  /**
   * The flattened PDF bytes when at least one form XObject was inlined,
   * otherwise the original `inputBytes` (same reference, unchanged).
   */
  bytes: Uint8Array;
  /** Total number of form XObjects inlined across all pages. */
  count: number;
}

/**
 * Inline every form XObject across all pages of `inputBytes`.
 *
 * @param inputBytes The source PDF.
 * @returns `{ bytes, count }`. When `count > 0`, `bytes` is the re-serialised
 *   flattened document. When `count === 0`, `bytes` is the original
 *   `inputBytes` untouched (no save), so the operation is a true no-op.
 */
export async function flattenForms(
  inputBytes: Uint8Array | Buffer,
): Promise<FlattenFormsResult> {
  // `openDocument` accepts a Buffer; normalise so a plain Uint8Array works too.
  const buffer = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);

  const handle = await openDocument(buffer);
  try {
    const pageCount = handle.pageCount;
    let count = 0;
    for (let page = 1; page <= pageCount; page++) {
      // Each `Do` invocation is de-shared and inlined; the return is how many
      // were inlined on that page. Reach the underlying engine doc the same way
      // the rest of the engine code does (handle._doc).
      count += handle._doc.flattenFormXObjects(page);
    }

    // No forms present → return the input unchanged, do NOT re-serialise.
    // This keeps form-less PDFs byte-identical to the source.
    if (count === 0) {
      return { bytes: inputBytes, count: 0 };
    }

    const saved = await saveDocument(handle);
    return { bytes: new Uint8Array(saved.buffer, saved.byteOffset, saved.byteLength), count };
  } finally {
    closeDocument(handle);
  }
}
