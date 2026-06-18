/**
 * Watermark stamping on every page (or a selected subset), via the
 * zero-dependency WASM engine. `engine` draws rotated standard-Helvetica text
 * with opacity (`addWatermark`) — no font embedding, no third-party libraries — and the
 * output is then optimised through `optimizeAndSave` like every other flow.
 *
 * Position presets cover the 90% case (centre diagonal, corners, horizontal
 * banner). A fully-custom position (x, y, rotation) is also available.
 */

import { getEngine } from '../wasm';
import { optimizeAndSave } from './optimize-save';
import { engineLogger } from '../utils/logger';

export type WatermarkPosition =
  | 'center-diagonal'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'header'
  | 'footer'
  | 'custom';

export interface WatermarkOptions {
  text: string;
  /** Pages to stamp (1-based). Defaults to all pages. */
  pages?: number[];
  position?: WatermarkPosition;
  /** Font size in PDF user-space (default 60 for center, 14 for header/footer). */
  fontSize?: number;
  /** Colour [r, g, b] in [0, 1]. Defaults to mid-gray. */
  color?: [number, number, number];
  /** Opacity 0-1. Defaults to 0.25 (subtle). */
  opacity?: number;
  /** Custom position (only used when position === 'custom'). */
  custom?: { x: number; y: number; rotation: number };
}

export interface WatermarkResult {
  bytes: Uint8Array;
  pagesStamped: number;
  outputBytes: number;
}

const DEFAULT_COLOR: [number, number, number] = [0.5, 0.5, 0.5];

/** Pack an [r, g, b] triple in [0, 1] into a `0xRRGGBB` integer. */
function packRgb([r, g, b]: [number, number, number]): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

export async function addWatermark(
  pdfBytes: Uint8Array,
  options: WatermarkOptions,
): Promise<WatermarkResult> {
  const {
    text,
    pages,
    position = 'center-diagonal',
    color = DEFAULT_COLOR,
    opacity = 0.25,
    custom,
  } = options;

  if (!text.trim()) {
    throw new Error('addWatermark: text is required');
  }

  const giga = await getEngine();
  const data = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const doc = giga.open(data);

  try {
    const rgb = packRgb(color);
    const totalPages = doc.pageCount();
    const targetPages = pages
      ? pages.filter((p) => p >= 1 && p <= totalPages)
      : Array.from({ length: totalPages }, (_, i) => i + 1);

    let stamped = 0;

    for (const pageNumber of targetPages) {
      const { width: w, height: h } = doc.pageInfo(pageNumber);

      let fontSize = options.fontSize;
      if (fontSize === undefined) {
        fontSize =
          position === 'header' || position === 'footer'
            ? 14
            : Math.max(40, Math.min(120, Math.sqrt(w * h) / 8));
      }

      // Standard-Helvetica metrics (AFM) for centring/right-alignment.
      const textWidth = giga.helveticaWidth(fontSize, text);
      const textHeight = fontSize;

      let x: number;
      let y: number;
      let rotation: number;

      switch (position) {
        case 'top-left':
          x = 36;
          y = h - textHeight - 36;
          rotation = 0;
          break;
        case 'top-right':
          x = w - textWidth - 36;
          y = h - textHeight - 36;
          rotation = 0;
          break;
        case 'bottom-left':
          x = 36;
          y = 36;
          rotation = 0;
          break;
        case 'bottom-right':
          x = w - textWidth - 36;
          y = 36;
          rotation = 0;
          break;
        case 'header':
          x = (w - textWidth) / 2;
          y = h - textHeight - 24;
          rotation = 0;
          break;
        case 'footer':
          x = (w - textWidth) / 2;
          y = 24;
          rotation = 0;
          break;
        case 'custom':
          if (!custom) {
            throw new Error('addWatermark: custom position requires {x, y, rotation}');
          }
          x = custom.x;
          y = custom.y;
          rotation = custom.rotation;
          break;
        case 'center-diagonal':
        default: {
          // Centre the bounding box and rotate 45° so the text spans the diagonal.
          rotation = 45;
          const angle = (rotation * Math.PI) / 180;
          x = w / 2 - (Math.cos(angle) * textWidth) / 2;
          y = h / 2 - (Math.sin(angle) * textWidth) / 2;
        }
      }

      doc.addWatermark(pageNumber, x, y, fontSize, text, rgb, opacity, rotation);
      stamped++;
    }

    const stampedBytes = doc.save();
    const optimised = await optimizeAndSave(stampedBytes);

    engineLogger.info('watermark: applied', {
      pagesStamped: stamped,
      position,
      optimisedBytes: optimised.bytes.byteLength,
    });

    return {
      bytes: optimised.bytes,
      pagesStamped: stamped,
      outputBytes: optimised.bytes.byteLength,
    };
  } finally {
    doc.close();
  }
}
