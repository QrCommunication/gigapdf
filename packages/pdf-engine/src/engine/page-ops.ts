import { degrees } from 'pdf-lib';
import type { PDFDocumentHandle } from './document-handle';
import { markDirty } from './document-handle';
import { PDFPageOutOfRangeError } from '../errors';
import { DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT } from '../constants';

function validatePageNumber(pageNumber: number, pageCount: number): void {
  if (pageNumber < 1 || pageNumber > pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, pageCount);
  }
}

export function addPage(
  handle: PDFDocumentHandle,
  position: number,
  width?: number,
  height?: number,
): number {
  const doc = handle._pdfDoc;
  const pageCount = doc.getPageCount();

  // Clamp to valid insertion range [1, pageCount + 1].
  const clampedPosition = Math.max(1, Math.min(position, pageCount + 1));

  doc.insertPage(clampedPosition - 1, [
    width ?? DEFAULT_PAGE_WIDTH,
    height ?? DEFAULT_PAGE_HEIGHT,
  ]);

  markDirty(doc);
  return clampedPosition;
}

export function deletePage(handle: PDFDocumentHandle, pageNumber: number): void {
  const doc = handle._pdfDoc;
  validatePageNumber(pageNumber, doc.getPageCount());
  doc.removePage(pageNumber - 1);
  markDirty(doc);
}

export async function movePage(
  handle: PDFDocumentHandle,
  fromPage: number,
  toPage: number,
): Promise<void> {
  const doc = handle._pdfDoc;
  const pageCount = doc.getPageCount();

  validatePageNumber(fromPage, pageCount);
  validatePageNumber(toPage, pageCount);

  if (fromPage === toPage) return;

  // copyPages duplicates page content into a usable PDFPage reference,
  // allowing us to reorder without losing embedded resources.
  const [copiedPage] = await doc.copyPages(doc, [fromPage - 1]);

  if (toPage > fromPage) {
    // Insert the copy after the original's position, then remove the original.
    doc.insertPage(toPage - 1, copiedPage);
    doc.removePage(fromPage - 1);
  } else {
    // Remove the original first so the target index remains stable.
    doc.removePage(fromPage - 1);
    doc.insertPage(toPage - 1, copiedPage);
  }

  markDirty(doc);
}

export function rotatePage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  angle: number,
): void {
  const doc = handle._pdfDoc;
  validatePageNumber(pageNumber, doc.getPageCount());

  // Normalize to [0, 360) then snap to valid PDF rotation multiples of 90.
  const normalized = ((angle % 360) + 360) % 360;
  const snapped = Math.round(normalized / 90) * 90;
  const finalAngle = snapped === 360 ? 0 : snapped;

  doc.getPage(pageNumber - 1).setRotation(degrees(finalAngle));
  markDirty(doc);
}

export async function copyPage(
  sourceHandle: PDFDocumentHandle,
  sourcePageNumber: number,
  targetHandle?: PDFDocumentHandle,
  targetPosition?: number,
): Promise<number> {
  const source = sourceHandle._pdfDoc;
  const target = targetHandle ?? sourceHandle;
  const targetDoc = target._pdfDoc;

  validatePageNumber(sourcePageNumber, source.getPageCount());

  const [copiedPage] = await targetDoc.copyPages(source, [sourcePageNumber - 1]);

  const targetPageCount = targetDoc.getPageCount();
  const insertAt =
    targetPosition !== undefined
      ? Math.max(1, Math.min(targetPosition, targetPageCount + 1))
      : targetPageCount + 1;

  targetDoc.insertPage(insertAt - 1, copiedPage);

  markDirty(targetDoc);
  if (targetHandle && targetHandle !== sourceHandle) {
    markDirty(source);
  }

  return insertAt;
}

export function resizePage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  width: number,
  height: number,
  scaleContent?: boolean,
): void {
  const doc = handle._pdfDoc;
  validatePageNumber(pageNumber, doc.getPageCount());

  const page = doc.getPage(pageNumber - 1);

  if (scaleContent) {
    const current = page.getSize();
    const scaleX = width / current.width;
    const scaleY = height / current.height;
    page.scaleContent(scaleX, scaleY);
  }

  page.setMediaBox(0, 0, width, height);
  markDirty(doc);
}
