import { rgb } from 'pdf-lib';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { ImageElement, Bounds } from '@giga-pdf/types';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';

function getPage(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  return handle._pdfDoc.getPage(pageNumber - 1);
}

function detectImageFormat(imageData: Uint8Array): 'png' | 'jpeg' | 'webp' | 'gif' | 'avif' | null {
  if (imageData.length < 12) return null;

  const isPng =
    imageData[0] === 0x89 &&
    imageData[1] === 0x50 &&
    imageData[2] === 0x4e &&
    imageData[3] === 0x47;
  if (isPng) return 'png';

  const isJpeg =
    imageData[0] === 0xff &&
    imageData[1] === 0xd8 &&
    imageData[2] === 0xff;
  if (isJpeg) return 'jpeg';

  // RIFF....WEBP
  const isWebp =
    imageData[0] === 0x52 && imageData[1] === 0x49 && imageData[2] === 0x46 && imageData[3] === 0x46 &&
    imageData[8] === 0x57 && imageData[9] === 0x45 && imageData[10] === 0x42 && imageData[11] === 0x50;
  if (isWebp) return 'webp';

  // GIF8(7|9)a
  const isGif =
    imageData[0] === 0x47 && imageData[1] === 0x49 && imageData[2] === 0x46 && imageData[3] === 0x38;
  if (isGif) return 'gif';

  // ftyp...avif/avis (skip 4 size bytes, then 'ftyp', then brand)
  const isAvif =
    imageData[4] === 0x66 && imageData[5] === 0x74 && imageData[6] === 0x79 && imageData[7] === 0x70 &&
    imageData[8] === 0x61 && imageData[9] === 0x76 && imageData[10] === 0x69 && imageData[11] === 0x66;
  if (isAvif) return 'avif';

  return null;
}

export async function addImage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: ImageElement,
  imageData: Uint8Array,
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

  const format = detectImageFormat(imageData);

  // pdf-lib only supports PNG and JPEG natively. Falling through to embedJpg
  // with non-JPEG bytes would throw a misleading error deep inside pdf-lib.
  // Surface a clear error so the caller can warn the user and we don't crash
  // the whole apply-elements batch with an opaque 500.
  if (format !== 'png' && format !== 'jpeg') {
    const headerHex = Array.from(imageData.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    throw new Error(
      `addImage: unsupported image format (detected=${format ?? 'unknown'}, header=${headerHex}). ` +
      `pdf-lib supports only PNG and JPEG; convert ${format ?? 'the source'} to PNG before embedding.`,
    );
  }

  const embeddedImage =
    format === 'png'
      ? await handle._pdfDoc.embedPng(imageData)
      : await handle._pdfDoc.embedJpg(imageData);

  page.drawImage(embeddedImage, {
    x: pdfRect.x,
    y: pdfRect.y,
    width: pdfRect.width,
    height: pdfRect.height,
    opacity: element.style.opacity,
  });

  markDirty(handle._pdfDoc);
}

export async function updateImage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  oldBounds: Bounds,
  element: ImageElement,
  imageData?: Uint8Array,
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

  if (!imageData) {
    markDirty(handle._pdfDoc);
    return;
  }

  return addImage(handle, pageNumber, element, imageData);
}
