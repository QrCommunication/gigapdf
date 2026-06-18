import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';

/**
 * Flatten the interactive form: the engine bakes every field widget across all
 * pages into the page content and drops `/AcroForm`, so the result is no longer
 * fillable. The `_pageNumber` argument is accepted for API compatibility but the
 * operation is whole-document.
 */
export function flattenForms(
  handle: PDFDocumentHandle,
  _pageNumber?: number | null,
): void {
  handle._doc.flattenForm();
  markDirty(handle._doc);
}

export interface FlattenAnnotationsResult {
  /** Total number of annotation appearances baked across all processed pages. */
  flattened: number;
  /** Number of pages whose annotations were processed. */
  pagesProcessed: number;
}

/**
 * Flatten PDF annotations into the page content.
 *
 * Unlike the previous pdf-lib implementation (which only deleted the `/Annots`
 * array), the engine **bakes each annotation's appearance stream into the page
 * content** before removing it — so highlights, notes, stamps, etc. remain
 * visible in the exported file while ceasing to be editable annotations.
 *
 * @param handle - Open PDF document handle.
 * @param pageNumber - 1-based page number to target. Omit or pass `null` to
 *   process all pages.
 * @returns Count of baked appearances and pages processed.
 */
export function flattenAnnotations(
  handle: PDFDocumentHandle,
  pageNumber?: number | null,
): FlattenAnnotationsResult {
  const doc = handle._doc;
  const pageCount = doc.pageCount();

  const targets =
    pageNumber != null
      ? [pageNumber]
      : Array.from({ length: pageCount }, (_, i) => i + 1);

  let flattened = 0;
  let pagesProcessed = 0;

  for (const page of targets) {
    if (page < 1 || page > pageCount) continue;
    const baked = doc.flattenAnnotations(page);
    if (baked >= 0) {
      flattened += baked;
      pagesProcessed++;
    }
  }

  markDirty(doc);
  return { flattened, pagesProcessed };
}
