import { rgb, type Color } from 'pdf-lib';

// pdf-lib's rgb() throws if any channel is outside [0, 1]. Hex inputs are
// safe by construction (max 0xff/255 = 1) but parseInt on malformed hex,
// or array inputs already in 0-255 with floating-point quantization, can
// produce 1.0039… which crashes the whole apply-elements batch with a
// misleading "`red` must be at least 0 and at most 1" error.
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

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

  const r = clamp01(parseInt(full.substring(0, 2), 16) / 255);
  const g = clamp01(parseInt(full.substring(2, 4), 16) / 255);
  const b = clamp01(parseInt(full.substring(4, 6), 16) / 255);

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
    return rgb(
      clamp01(input[0]! / 255),
      clamp01(input[1]! / 255),
      clamp01(input[2]! / 255),
    );
  }

  return undefined;
}
