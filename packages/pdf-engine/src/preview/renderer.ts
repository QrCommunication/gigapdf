import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import { PDFParseError, PDFPageOutOfRangeError } from '../errors';
import {
  MAX_PREVIEW_DPI,
  DEFAULT_PREVIEW_DPI,
  DEFAULT_JPEG_QUALITY,
  POINTS_PER_INCH,
} from '../constants';
import { acquireCanvas } from './pool';

pdfjsLib.GlobalWorkerOptions.workerSrc = '';

export type PreviewFormat = 'png' | 'jpeg' | 'webp';

export interface RenderOptions {
  dpi?: number;
  scale?: number;
  format?: PreviewFormat;
  quality?: number;
  alpha?: boolean;
}

async function loadDocument(buffer: Buffer): Promise<PDFDocumentProxy> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
  return loadingTask.promise;
}

export async function renderPage(
  buffer: Buffer,
  pageNumber: number,
  options?: RenderOptions,
): Promise<Buffer> {
  let doc: PDFDocumentProxy | null = null;
  try {
    doc = await loadDocument(buffer);
  } catch {
    throw new PDFParseError('Failed to load PDF document');
  }

  const pageCount = doc.numPages;
  if (pageNumber < 1 || pageNumber > pageCount) {
    await doc.destroy();
    throw new PDFPageOutOfRangeError(pageNumber, pageCount);
  }

  const page = await doc.getPage(pageNumber);

  let scale: number;
  if (options?.scale !== undefined) {
    scale = options.scale;
  } else {
    const clampedDpi = Math.min(options?.dpi ?? DEFAULT_PREVIEW_DPI, MAX_PREVIEW_DPI);
    scale = clampedDpi / POINTS_PER_INCH;
  }

  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);

  const { canvas, ctx, release } = await acquireCanvas(width, height);

  try {
    const renderContext = {
      canvasContext: ctx,
      viewport,
    };
    await page.render(renderContext).promise;

    const rawBuffer = canvas.toBuffer('image/png');
    const format = options?.format ?? 'png';

    if (format === 'png') {
      if (!options?.alpha) {
        return sharp(rawBuffer)
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .png()
          .toBuffer();
      }
      return sharp(rawBuffer).png().toBuffer();
    } else if (format === 'jpeg') {
      return sharp(rawBuffer)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: options?.quality ?? DEFAULT_JPEG_QUALITY })
        .toBuffer();
    } else {
      return sharp(rawBuffer)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .webp({ quality: options?.quality ?? DEFAULT_JPEG_QUALITY })
        .toBuffer();
    }
  } finally {
    release();
    page.cleanup();
    await doc.destroy();
  }
}

export async function extractImage(
  buffer: Buffer,
  pageNumber: number,
  imageIndex: number,
  outputFormat?: PreviewFormat | null,
): Promise<{ data: Buffer; mimeType: string }> {
  let doc: PDFDocumentProxy | null = null;
  try {
    doc = await loadDocument(buffer);
  } catch {
    throw new PDFParseError('Failed to load PDF document');
  }

  const pageCount = doc.numPages;
  if (pageNumber < 1 || pageNumber > pageCount) {
    await doc.destroy();
    throw new PDFPageOutOfRangeError(pageNumber, pageCount);
  }

  try {
    const page = await doc.getPage(pageNumber);
    const ops = await page.getOperatorList();

    let currentIndex = 0;
    let imageName: string | null = null;

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        if (currentIndex === imageIndex) {
          imageName = (ops.argsArray[i] as string[])[0] ?? null;
          break;
        }
        currentIndex++;
      }
    }

    if (!imageName) {
      throw new PDFParseError(
        `Image at index ${imageIndex} not found on page ${pageNumber}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imgData = await (page.objs as any).get(imageName);

    if (!imgData || !imgData.data) {
      throw new PDFParseError(`Failed to retrieve image data for image at index ${imageIndex}`);
    }

    const { data, width, height } = imgData as {
      data: Uint8ClampedArray | Uint8Array;
      width: number;
      height: number;
    };

    const rawBuffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);

    const format = outputFormat ?? 'png';

    if (format === 'jpeg') {
      const outBuffer = await sharp(rawBuffer, {
        raw: { width, height, channels: 4 },
      })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: DEFAULT_JPEG_QUALITY })
        .toBuffer();
      return { data: outBuffer, mimeType: 'image/jpeg' };
    } else if (format === 'webp') {
      const outBuffer = await sharp(rawBuffer, {
        raw: { width, height, channels: 4 },
      })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .webp({ quality: DEFAULT_JPEG_QUALITY })
        .toBuffer();
      return { data: outBuffer, mimeType: 'image/webp' };
    } else {
      const outBuffer = await sharp(rawBuffer, {
        raw: { width, height, channels: 4 },
      })
        .png()
        .toBuffer();
      return { data: outBuffer, mimeType: 'image/png' };
    }
  } finally {
    await doc.destroy();
  }
}
