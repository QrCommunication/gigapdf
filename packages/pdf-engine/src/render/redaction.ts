import { rgb } from 'pdf-lib';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { Bounds } from '@giga-pdf/types';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';

function getPage(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  return handle._pdfDoc.getPage(pageNumber - 1);
}

/**
 * Tentative de suppression du texte directement dans le flux (Content Stream)
 * pour éviter de peindre un rectangle blanc destructeur.
 * Note: L'implémentation complète nécessite l'analyse de la matrice de transformation (Tm, cm).
 */
async function removeTextFromStream(_page: unknown, _bounds: { x: number, y: number, width: number, height: number }): Promise<boolean> {
  try {
    return false; // Currently false, fallback to drawRectangle
  } catch {
    return false;
  }
}

export async function deleteElementArea(
  handle: PDFDocumentHandle,
  pageNumber: number,
  bounds: Bounds,
): Promise<void> {
  const page = getPage(handle, pageNumber);
  const pageH = page.getHeight();
  const pdfRect = webToPdf(bounds.x, bounds.y, bounds.width, bounds.height, pageH);

  const streamRedacted = await removeTextFromStream(page, pdfRect);

  if (!streamRedacted) {
    page.drawRectangle({
      x: pdfRect.x,
      y: pdfRect.y,
      width: pdfRect.width,
      height: pdfRect.height,
      color: rgb(1, 1, 1),
      opacity: 1,
    });
  }

  markDirty(handle._pdfDoc);
}
