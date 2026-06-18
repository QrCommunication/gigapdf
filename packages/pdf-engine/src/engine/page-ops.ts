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
  const doc = handle._doc;
  const pageCount = doc.pageCount();

  // Clamp to valid insertion range [1, pageCount + 1].
  const clampedPosition = Math.max(1, Math.min(position, pageCount + 1));

  // The engine inserts a blank page AFTER the 1-based `after` page (0 = front),
  // so inserting AT `clampedPosition` means after `clampedPosition - 1`.
  doc.addPage(width ?? DEFAULT_PAGE_WIDTH, height ?? DEFAULT_PAGE_HEIGHT, clampedPosition - 1);

  markDirty(doc);
  return clampedPosition;
}

export function deletePage(handle: PDFDocumentHandle, pageNumber: number): void {
  const doc = handle._doc;
  validatePageNumber(pageNumber, doc.pageCount());
  doc.deletePage(pageNumber);
  markDirty(doc);
}

export async function movePage(
  handle: PDFDocumentHandle,
  fromPage: number,
  toPage: number,
): Promise<void> {
  const doc = handle._doc;
  const pageCount = doc.pageCount();

  validatePageNumber(fromPage, pageCount);
  validatePageNumber(toPage, pageCount);

  if (fromPage === toPage) return;

  doc.movePage(fromPage, toPage);
  markDirty(doc);
}

export type RotateMode = 'set' | 'delta';

export function rotatePage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  angle: number,
  mode: RotateMode = 'delta',
): void {
  const doc = handle._doc;
  validatePageNumber(pageNumber, doc.pageCount());

  // mode 'delta' (default) = add `angle` to the page's current rotation —
  // matches the intuitive "rotate 90° clockwise" button. mode 'set' = absolute.
  // The engine normalises the result to a 0/90/180/270 multiple.
  const current = doc.pageInfo(pageNumber).rotation;
  const target = mode === 'delta' ? current + angle : angle;

  doc.rotatePage(pageNumber, target);
  markDirty(doc);
}

export async function copyPage(
  sourceHandle: PDFDocumentHandle,
  sourcePageNumber: number,
  targetHandle?: PDFDocumentHandle,
  targetPosition?: number,
): Promise<number> {
  const source = sourceHandle._doc;
  validatePageNumber(sourcePageNumber, source.pageCount());

  const sameDoc = !targetHandle || targetHandle === sourceHandle;

  if (sameDoc) {
    // `copyPage` inserts the duplicate right after the source.
    source.copyPage(sourcePageNumber);
    const insertedAt = sourcePageNumber + 1;
    const pageCount = source.pageCount();
    const target =
      targetPosition !== undefined
        ? Math.max(1, Math.min(targetPosition, pageCount))
        : pageCount;
    if (target !== insertedAt) {
      source.movePage(insertedAt, target);
    }
    markDirty(source);
    return target;
  }

  // Cross-document copy: extract the single page as a standalone PDF and append
  // it to the target, then reposition.
  const target = targetHandle!._doc;
  const onePage = source.extractPages([sourcePageNumber]);
  target.appendPages(onePage);
  const appendedAt = target.pageCount();
  const pageCount = target.pageCount();
  const insertAt =
    targetPosition !== undefined
      ? Math.max(1, Math.min(targetPosition, pageCount))
      : pageCount;
  if (insertAt !== appendedAt) {
    target.movePage(appendedAt, insertAt);
  }
  markDirty(target);
  return insertAt;
}

export function resizePage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  width: number,
  height: number,
  _scaleContent?: boolean,
): void {
  const doc = handle._doc;
  validatePageNumber(pageNumber, doc.pageCount());
  doc.resizePage(pageNumber, width, height);
  markDirty(doc);
}
