import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { ImageElement } from '@giga-pdf/types';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';

function pageGeometry(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  const { width, height, rotation } = handle._doc.pageInfo(pageNumber);
  return { width, height, rotation: rotation as 0 | 90 | 180 | 270 };
}

function detectImageFormat(
  imageData: Uint8Array,
): 'png' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'tiff' | null {
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

  // TIFF: "II*\0" (little-endian / Intel) or "MM\0*" (big-endian / Motorola)
  const isTiff =
    (imageData[0] === 0x49 && imageData[1] === 0x49 && imageData[2] === 0x2a && imageData[3] === 0x00) ||
    (imageData[0] === 0x4d && imageData[1] === 0x4d && imageData[2] === 0x00 && imageData[3] === 0x2a);
  if (isTiff) return 'tiff';

  return null;
}

export async function addImage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: ImageElement,
  imageData: Uint8Array,
): Promise<void> {
  const { width: pageW, height: pageH, rotation } = pageGeometry(handle, pageNumber);
  const pdfRect = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    pageH,
    pageW,
    rotation,
  );

  // Validate the bytes are a recognized raster up-front so we fail with a clear
  // message rather than a silent no-op when the engine can't decode them.
  const format = detectImageFormat(imageData);
  if (!format) {
    const headerHex = Array.from(imageData.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    throw new Error(
      `addImage: unrecognized image format (header=${headerHex}). ` +
        `Supported formats: PNG, JPEG, GIF, WebP, AVIF, TIFF.`,
    );
  }

  // The engine (gigapdf-lib ≥ 0.109) embeds every supported raster natively:
  // JPEG passes through as /DCTDecode, while PNG, GIF, WebP, AVIF and TIFF are
  // decoded to RGBA in pure Rust/WASM (alpha honoured). No client-side
  // transcoding — the raw bytes go straight to the engine. Embedding stays
  // best-effort (the return value is intentionally not asserted): a raster the
  // engine can't embed is skipped rather than aborting the whole edit, matching
  // the behaviour the editor has always relied on.
  handle._doc.addImage(
    pageNumber,
    imageData,
    pdfRect.x,
    pdfRect.y,
    pdfRect.width,
    pdfRect.height,
    element.style.opacity,
  );

  markDirty(handle._doc);
}
