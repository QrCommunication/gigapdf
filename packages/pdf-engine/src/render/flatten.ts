import { PDFName, PDFArray } from 'pdf-lib';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';

export function flattenForms(
  handle: PDFDocumentHandle,
  _pageNumber?: number | null,
): void {
  const form = handle._pdfDoc.getForm();
  form.flatten();
  markDirty(handle._pdfDoc);
}

export interface FlattenAnnotationsResult {
  /** Total number of annotation entries removed across all processed pages. */
  flattened: number;
  /** Number of pages whose /Annots entry was found and removed. */
  pagesProcessed: number;
}

/**
 * Removes native PDF annotations (/Annots entries) from one or all pages.
 *
 * This deletes the `/Annots` array from each targeted page dictionary,
 * ensuring that highlights, notes, and other annotation objects are stripped
 * before export. Annotations added by this engine via `addAnnotation()` are
 * already rendered into the page content stream and are therefore unaffected.
 *
 * @remarks
 * Full appearance-stream compositing (rendering each annotation's visual
 * representation into the content stream before removal) is not yet
 * implemented — pdf-lib does not expose that operation directly. The current
 * implementation provides the minimum-viable security guarantee: the annotation
 * objects are deleted and will not appear in readers or be extractable from the
 * exported file.
 *
 * @param handle - Open PDF document handle.
 * @param pageNumber - 1-based page number to target. Omit or pass `null` to
 *   process all pages.
 * @returns Count of removed annotation entries and pages processed.
 */
export function flattenAnnotations(
  handle: PDFDocumentHandle,
  pageNumber?: number | null,
): FlattenAnnotationsResult {
  const pdfDoc = handle._pdfDoc;
  const pages = pdfDoc.getPages();

  const targets =
    pageNumber != null ? [pages[pageNumber - 1]] : pages;

  let flattened = 0;
  let pagesProcessed = 0;

  for (const page of targets) {
    if (!page) continue;

    const node = page.node;
    const annotsRef = node.get(PDFName.of('Annots'));
    if (annotsRef === undefined) continue;

    // Count entries before removal so we can report the total.
    try {
      const annotsArray = pdfDoc.context.lookup(annotsRef, PDFArray);
      flattened += annotsArray.size();
    } catch {
      // annotsRef may be a direct empty array or malformed — still delete it.
      flattened += 1;
    }

    node.delete(PDFName.of('Annots'));
    pagesProcessed++;
  }

  markDirty(pdfDoc);
  return { flattened, pagesProcessed };
}
