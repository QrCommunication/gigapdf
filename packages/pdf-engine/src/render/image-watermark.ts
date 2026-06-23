/**
 * Image watermark stamping across pages, via the zero-dependency WASM engine.
 *
 * Mirrors the text {@link addWatermark} flow but stamps a raster image instead
 * of Helvetica text. The engine (`engine.addImageWatermark`) decodes the image
 * once — PNG, JPEG, WebP, GIF or AVIF — embeds it a single time and references
 * it on every target page, then the result is optimised through
 * `optimizeAndSave` like every other flow.
 *
 * Anchors cover the 90% case (centre + four corners); `tile` repeats the image
 * across the whole page (using `offsetX`/`offsetY` as the gaps). No font
 * embedding, no third-party libraries.
 */

import { getEngine } from '../wasm';
import { optimizeAndSave } from './optimize-save';
import { engineLogger } from '../utils/logger';

export type ImageWatermarkAnchor =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface ImageWatermarkOptions {
  /** Pages to stamp (1-based). Defaults to all pages (omit or pass `[]`). */
  pages?: number[];
  /** Image placement. Defaults to `'center'`. */
  anchor?: ImageWatermarkAnchor;
  /** Horizontal nudge in points (gap between tiles in `tile` mode). */
  offsetX?: number;
  /** Vertical nudge in points (gap between tiles in `tile` mode). */
  offsetY?: number;
  /** Target width in points. Defaults to the source pixel width. */
  width?: number;
  /** Target height in points. Keeps the source aspect ratio when omitted. */
  height?: number;
  /** Rotation about the image centre, in degrees. Defaults to 0. */
  rotationDeg?: number;
  /** Overall alpha 0–1. Defaults to 0.25 (subtle). */
  opacity?: number;
  /** Repeat the image across the whole page. Defaults to false. */
  tile?: boolean;
}

export interface ImageWatermarkResult {
  bytes: Uint8Array;
  outputBytes: number;
}

const DEFAULT_OPACITY = 0.25;

/**
 * Stamp a raster image watermark across a PDF.
 *
 * @param pdfBytes   The source PDF.
 * @param imageBytes The watermark image (PNG/JPEG/WebP/GIF/AVIF).
 * @param options    Placement, sizing, rotation, opacity and tiling.
 * @throws when the image cannot be decoded by the engine.
 */
export async function addImageWatermark(
  pdfBytes: Uint8Array,
  imageBytes: Uint8Array,
  options: ImageWatermarkOptions = {},
): Promise<ImageWatermarkResult> {
  const image = imageBytes instanceof Uint8Array ? imageBytes : new Uint8Array(imageBytes);
  if (image.byteLength === 0) {
    throw new Error('addImageWatermark: image is required');
  }

  const giga = await getEngine();
  const data = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const doc = giga.open(data);

  try {
    const ok = doc.addImageWatermark(image, {
      pages: options.pages,
      anchor: options.anchor ?? 'center',
      offsetX: options.offsetX,
      offsetY: options.offsetY,
      width: options.width,
      height: options.height,
      rotationDeg: options.rotationDeg,
      opacity: options.opacity ?? DEFAULT_OPACITY,
      tile: options.tile,
    });

    if (!ok) {
      throw new Error('addImageWatermark: the image could not be decoded.');
    }

    const stampedBytes = doc.save();
    const optimised = await optimizeAndSave(stampedBytes);

    engineLogger.info('imageWatermark: applied', {
      anchor: options.anchor ?? 'center',
      tile: options.tile ?? false,
      optimisedBytes: optimised.bytes.byteLength,
    });

    return {
      bytes: optimised.bytes,
      outputBytes: optimised.bytes.byteLength,
    };
  } finally {
    doc.close();
  }
}
