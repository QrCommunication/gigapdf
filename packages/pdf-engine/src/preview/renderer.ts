import { getEngine } from '../wasm';
import { PDFParseError, PDFPageOutOfRangeError } from '../errors';
import {
  MAX_PREVIEW_DPI,
  DEFAULT_PREVIEW_DPI,
  DEFAULT_JPEG_QUALITY,
  POINTS_PER_INCH,
} from '../constants';
import { renderPage as engineRenderPage } from '../render/engine-render';

export type PreviewFormat = 'png' | 'jpeg' | 'webp';

export interface RenderOptions {
  dpi?: number;
  scale?: number;
  format?: PreviewFormat;
  quality?: number;
  alpha?: boolean;
}

export async function renderPage(
  buffer: Buffer,
  pageNumber: number,
  options?: RenderOptions,
): Promise<Buffer> {
  // Rasterise via the WASM engine (native, in-process). The engine renders
  // images, fonts, rotation and transparency natively (see
  // render/engine-render.ts) — no pdfjs / node-canvas.
  const scale =
    options?.scale ??
    Math.min(options?.dpi ?? DEFAULT_PREVIEW_DPI, MAX_PREVIEW_DPI) / POINTS_PER_INCH;
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const rendered = await engineRenderPage(data, pageNumber, {
    scale,
    format: options?.format ?? 'png',
    quality: options?.quality ?? DEFAULT_JPEG_QUALITY,
  });
  return Buffer.from(rendered.bytes);
}

/**
 * Extract a single embedded image (by 0-based index on the page) and return it
 * re-encoded in the requested format. Backed by the native engine: the image's
 * embeddable bytes come from `imageElements`, decoded to RGBA only when the
 * output format differs from the source encoding (otherwise passed through).
 */
export async function extractImage(
  buffer: Buffer,
  pageNumber: number,
  imageIndex: number,
  outputFormat?: PreviewFormat | null,
): Promise<{ data: Buffer; mimeType: string }> {
  const giga = await getEngine();
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let doc: ReturnType<typeof giga.open>;
  try {
    doc = giga.open(bytes);
  } catch (err) {
    throw new PDFParseError(
      `Failed to load PDF document: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const pageCount = doc.pageCount();
    if (pageNumber < 1 || pageNumber > pageCount) {
      throw new PDFPageOutOfRangeError(pageNumber, pageCount);
    }

    const info = doc.imageElements(pageNumber)[imageIndex];
    if (!info || info.data.length === 0) {
      throw new PDFParseError(
        `Image at index ${imageIndex} not found on page ${pageNumber}`,
      );
    }

    const format = outputFormat ?? 'png';

    // Passthrough when the requested format already matches the embedded
    // encoding — no decode/re-encode round-trip.
    if (format === 'png' && info.format === 'png') {
      return { data: Buffer.from(info.data), mimeType: 'image/png' };
    }
    if (format === 'jpeg' && info.format === 'jpeg') {
      return { data: Buffer.from(info.data), mimeType: 'image/jpeg' };
    }

    // Otherwise decode the embedded bytes to RGBA and re-encode.
    const decoded =
      info.format === 'jpeg'
        ? giga.decodeJpeg(info.data)
        : info.format === 'png'
          ? giga.decodePng(info.data)
          : null;
    if (!decoded) {
      throw new PDFParseError(
        `Cannot decode image at index ${imageIndex} (format "${info.format}")`,
      );
    }
    const { rgba, width, height } = decoded;

    if (format === 'jpeg') {
      // encodeJpeg composites alpha onto white internally (matches flatten).
      return {
        data: Buffer.from(giga.encodeJpeg(rgba, width, height, DEFAULT_JPEG_QUALITY)),
        mimeType: 'image/jpeg',
      };
    }
    if (format === 'webp') {
      // Lossless VP8L; flatten onto white first to drop transparency.
      return {
        data: Buffer.from(giga.encodeWebp(flattenOnWhite(rgba), width, height)),
        mimeType: 'image/webp',
      };
    }
    return { data: Buffer.from(giga.rgbaToPng(rgba, width, height)), mimeType: 'image/png' };
  } finally {
    doc.close();
  }
}

/** Composite an RGBA buffer onto an opaque white background (for formats that
 * shouldn't carry transparency). */
function flattenOnWhite(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = (rgba[i + 3] ?? 255) / 255;
    out[i] = Math.round((rgba[i] ?? 0) * a + 255 * (1 - a));
    out[i + 1] = Math.round((rgba[i + 1] ?? 0) * a + 255 * (1 - a));
    out[i + 2] = Math.round((rgba[i + 2] ?? 0) * a + 255 * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}
