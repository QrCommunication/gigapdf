/**
 * Watermark stamping on every page (or a selected subset).
 *
 * pdf-lib handles the text drawing on each page with a rotation matrix —
 * MuPDF doesn't expose a high-level watermark API. The output is then
 * optimised through `optimizeAndSave` so the resulting PDF is compressed
 * + linearised like all other apply-elements flows.
 *
 * Position presets cover the 90% case (centre diagonal, corners,
 * horizontal banner). A fully-custom position (x, y, rotation) is also
 * available for power users.
 */

import { rgb, degrees, StandardFonts } from 'pdf-lib';
import { openDocument, saveDocument } from '../engine/document-handle';
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

  const buffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  const handle = await openDocument(buffer);
  const pdfDoc = handle._pdfDoc;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const totalPages = pdfDoc.getPageCount();
  const targetPages = pages
    ? pages.filter((p) => p >= 1 && p <= totalPages)
    : Array.from({ length: totalPages }, (_, i) => i + 1);

  let stamped = 0;

  for (const pageNumber of targetPages) {
    const page = pdfDoc.getPage(pageNumber - 1);
    const w = page.getWidth();
    const h = page.getHeight();

    let fontSize = options.fontSize;
    if (fontSize === undefined) {
      fontSize =
        position === 'header' || position === 'footer'
          ? 14
          : Math.max(40, Math.min(120, Math.sqrt(w * h) / 8));
    }

    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = font.heightAtSize(fontSize);

    let x: number, y: number, rotation: number;

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
        // Centre the bounding box and rotate 45° so the text spans the page diagonal.
        rotation = 45;
        const angle = (rotation * Math.PI) / 180;
        x = w / 2 - (Math.cos(angle) * textWidth) / 2;
        y = h / 2 - (Math.sin(angle) * textWidth) / 2;
      }
    }

    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(color[0], color[1], color[2]),
      opacity,
      rotate: degrees(rotation),
    });

    stamped++;
  }

  // Save via pdf-lib then optimise via MuPDF.
  const pdfLibBytes = await saveDocument(handle);
  const optimised = await optimizeAndSave(pdfLibBytes);

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
}
