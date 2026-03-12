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

export function flattenAnnotations(
  handle: PDFDocumentHandle,
  _pageNumber?: number | null,
): void {
  // pdf-lib does not support flattening annotations natively.
  // Annotations drawn via this module are already in the content stream (not annotation objects),
  // so they are effectively already "flattened".
  markDirty(handle._pdfDoc);
}
