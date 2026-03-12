import { rgb, degrees } from 'pdf-lib';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { TextElement, Bounds } from '@giga-pdf/types';
import { hexToRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import { normalizeFontName } from '../utils/font-map';
import { PDFPageOutOfRangeError } from '../errors';

function getPage(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  return handle._pdfDoc.getPage(pageNumber - 1);
}

export async function addText(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: TextElement,
): Promise<void> {
  const page = getPage(handle, pageNumber);
  const pageH = page.getHeight();
  const pdfRect = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    pageH,
  );

  const font = await handle._pdfDoc.embedFont(normalizeFontName(element.style.fontFamily));
  const color = hexToRgb(element.style.color);

  page.drawText(element.content, {
    x: pdfRect.x,
    y: pdfRect.y + pdfRect.height - element.style.fontSize,
    size: element.style.fontSize,
    font,
    color,
    opacity: element.style.opacity,
    rotate: degrees(element.transform.rotation),
    maxWidth: pdfRect.width,
    lineHeight: element.style.fontSize * element.style.lineHeight,
  });

  markDirty(handle._pdfDoc);
}

export async function updateText(
  handle: PDFDocumentHandle,
  pageNumber: number,
  oldBounds: Bounds,
  element: TextElement,
): Promise<void> {
  const page = getPage(handle, pageNumber);
  const pageH = page.getHeight();
  const oldPdf = webToPdf(oldBounds.x, oldBounds.y, oldBounds.width, oldBounds.height, pageH);

  page.drawRectangle({
    x: oldPdf.x,
    y: oldPdf.y,
    width: oldPdf.width,
    height: oldPdf.height,
    color: rgb(1, 1, 1),
    opacity: 1,
  });

  return addText(handle, pageNumber, element);
}
