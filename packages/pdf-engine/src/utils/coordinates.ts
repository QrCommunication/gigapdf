import type { Bounds } from '@giga-pdf/types';

/**
 * Convert web coordinates (top-left origin, Y down) to PDF coordinates (bottom-left origin, Y up).
 */
export function webToPdf(
  x: number,
  y: number,
  width: number,
  height: number,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x,
    y: pageHeight - y - height,
    width,
    height,
  };
}

/**
 * Convert PDF coordinates (bottom-left origin, Y up) to web coordinates (top-left origin, Y down).
 */
export function pdfToWeb(
  x: number,
  y: number,
  width: number,
  height: number,
  pageHeight: number,
): Bounds {
  return {
    x,
    y: pageHeight - y - height,
    width,
    height,
  };
}

/**
 * Scale a rectangle by a given factor.
 */
export function scaleRect(
  bounds: Bounds,
  scale: number,
): Bounds {
  return {
    x: bounds.x * scale,
    y: bounds.y * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
  };
}
