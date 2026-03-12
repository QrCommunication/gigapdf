import { rgb, type Color } from 'pdf-lib';

/**
 * Convert hex color string (#RRGGBB or #RGB) to pdf-lib rgb color.
 */
export function hexToRgb(hex: string): Color {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;

  const r = parseInt(full.substring(0, 2), 16) / 255;
  const g = parseInt(full.substring(2, 4), 16) / 255;
  const b = parseInt(full.substring(4, 6), 16) / 255;

  return rgb(r, g, b);
}

/**
 * Convert RGB components (0-1 range) to hex string.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Normalize a color from various formats to pdf-lib Color.
 * Accepts: hex string, [r,g,b] array (0-255), or Uint8ClampedArray.
 */
export function normalizeColor(
  input: string | number[] | Uint8ClampedArray | null,
): Color | undefined {
  if (!input) return undefined;

  if (typeof input === 'string') {
    return hexToRgb(input);
  }

  if (Array.isArray(input) || input instanceof Uint8ClampedArray) {
    return rgb(input[0]! / 255, input[1]! / 255, input[2]! / 255);
  }

  return undefined;
}
