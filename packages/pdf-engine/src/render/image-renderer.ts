import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { ImageElement } from '@giga-pdf/types';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';
import { getEngine } from '../wasm';

function pageGeometry(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  const { width, height, rotation } = handle._doc.pageInfo(pageNumber);
  return { width, height, rotation: rotation as 0 | 90 | 180 | 270 };
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

  let format = detectImageFormat(imageData);

  // The engine embeds PNG and JPEG natively (PNG alpha honoured). The modern
  // formats (GIF, WebP — lossless + lossy, AVIF) are decoded by the engine's own
  // zero-dependency decoders and re-encoded to PNG. No third-party image library.
  if (format && format !== 'png' && format !== 'jpeg') {
    const giga = await getEngine();
    const decoded =
      format === 'gif'
        ? giga.decodeGif(imageData)
        : format === 'webp'
          ? giga.decodeWebp(imageData)
          : format === 'avif'
            ? giga.decodeAvif(imageData)
            : null;
    if (!decoded) {
      const headerHex = Array.from(imageData.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      throw new Error(
        `addImage: failed to decode ${format} image (header=${headerHex}). ` +
          `Supported formats: PNG, JPEG, GIF, WebP, AVIF.`,
      );
    }
    imageData = Buffer.from(giga.rgbaToPng(decoded.rgba, decoded.width, decoded.height));
    format = 'png';
  }

  if (format !== 'png' && format !== 'jpeg') {
    const headerHex = Array.from(imageData.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    throw new Error(
      `addImage: unsupported image format (detected=${format ?? 'unknown'}, header=${headerHex}). ` +
      `Only PNG and JPEG are embeddable.`,
    );
  }

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
