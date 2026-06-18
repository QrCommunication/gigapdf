import { getEngine } from '../wasm';
import {
  renderPage as engineRenderPage,
  renderPages as engineRenderPages,
} from '../render/engine-render';
import { DEFAULT_THUMBNAIL_WIDTH, DEFAULT_THUMBNAIL_HEIGHT } from '../constants';
import type { PreviewFormat } from './renderer';

export interface ThumbnailOptions {
  maxWidth?: number;
  maxHeight?: number;
  format?: PreviewFormat;
  quality?: number;
}

/**
 * Source rasterisation scale before downscaling to the thumbnail box.
 * 2 ≈ 144 DPI — enough detail that the downscale stays crisp for typical
 * thumbnail sizes without rendering the full page at high DPI.
 */
const THUMBNAIL_RENDER_SCALE = 2;

/** Downscale a rasterised page (PNG bytes) into the requested thumbnail box. */
async function toThumbnail(
  pngBytes: Uint8Array,
  options?: ThumbnailOptions,
): Promise<Buffer> {
  const maxW = options?.maxWidth ?? DEFAULT_THUMBNAIL_WIDTH;
  const maxH = options?.maxHeight ?? DEFAULT_THUMBNAIL_HEIGHT;
  const format = options?.format ?? 'png';
  const quality = options?.quality;

  const giga = await getEngine();
  const img = giga.decodePng(pngBytes);
  if (!img) return Buffer.from(pngBytes);

  // Fit inside the box, never enlarging (`withoutEnlargement`).
  const factor = Math.min(maxW / img.width, maxH / img.height, 1);
  const dw = Math.max(1, Math.round(img.width * factor));
  const dh = Math.max(1, Math.round(img.height * factor));
  const [ow, oh, rgba] =
    factor < 1
      ? [dw, dh, giga.resizeRgba(img.rgba, img.width, img.height, dw, dh)]
      : [img.width, img.height, img.rgba];

  // Page rasters are opaque, so JPEG/WebP need no explicit flatten.
  if (format === 'jpeg') {
    return Buffer.from(giga.encodeJpeg(rgba, ow, oh, quality ?? 80));
  }
  if (format === 'webp') {
    return Buffer.from(giga.encodeWebp(rgba, ow, oh));
  }
  return Buffer.from(giga.rgbaToPng(rgba, ow, oh));
}

/**
 * Render a single page as a thumbnail.
 *
 * Rasterises via the native engine (images, fonts, rotation and transparency
 * handled natively), then downscales to the thumbnail box with the engine's
 * own RGBA resize.
 */
export async function renderThumbnail(
  buffer: Buffer,
  pageNumber: number,
  options?: ThumbnailOptions,
): Promise<Buffer> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const rendered = await engineRenderPage(data, pageNumber, {
    scale: THUMBNAIL_RENDER_SCALE,
    format: 'png',
  });
  return toThumbnail(rendered.bytes, options);
}

/**
 * Render thumbnails for every page. Opens the document once via the native
 * engine (batch), then downscales each page in parallel (engine RGBA resize).
 */
export async function renderAllThumbnails(
  buffer: Buffer,
  options?: ThumbnailOptions,
): Promise<Map<number, Buffer>> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const rendered = await engineRenderPages(data, {
    scale: THUMBNAIL_RENDER_SCALE,
    format: 'png',
  });

  const results = new Map<number, Buffer>();
  await Promise.all(
    rendered.map(async (page) => {
      results.set(page.pageNumber, await toThumbnail(page.bytes, options));
    }),
  );
  return results;
}
