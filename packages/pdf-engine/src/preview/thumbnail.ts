import sharp from 'sharp';
import {
  renderPage as mupdfRenderPage,
  renderPages as mupdfRenderPages,
} from '../render/mupdf-render';
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
 * 2 ≈ 144 DPI — enough detail that the sharp downscale stays crisp for typical
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

  const pipeline = sharp(Buffer.from(pngBytes)).resize(maxW, maxH, {
    fit: 'inside',
    withoutEnlargement: true,
  });

  if (format === 'jpeg') {
    return pipeline
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg(quality ? { quality } : {})
      .toBuffer();
  }
  if (format === 'webp') {
    return pipeline.webp(quality ? { quality } : {}).toBuffer();
  }
  return pipeline.png().toBuffer();
}

/**
 * Render a single page as a thumbnail.
 *
 * Rasterises via MuPDF (native — handles images/fonts/rotation/transparency
 * where pdfjs + node-canvas threw "Image or Canvas expected"), then downscales
 * to the thumbnail box with sharp.
 */
export async function renderThumbnail(
  buffer: Buffer,
  pageNumber: number,
  options?: ThumbnailOptions,
): Promise<Buffer> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const rendered = await mupdfRenderPage(data, pageNumber, {
    scale: THUMBNAIL_RENDER_SCALE,
    format: 'png',
  });
  return toThumbnail(rendered.bytes, options);
}

/**
 * Render thumbnails for every page. Opens the document once via MuPDF (batch),
 * then downscales each page in parallel with sharp.
 */
export async function renderAllThumbnails(
  buffer: Buffer,
  options?: ThumbnailOptions,
): Promise<Map<number, Buffer>> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const rendered = await mupdfRenderPages(data, {
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
