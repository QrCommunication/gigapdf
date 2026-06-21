/**
 * Colour helpers for the zero-dependency engine. Drawing APIs take a packed
 * `0xRRGGBB` integer (not a pdf-lib `Color`), so `hexToPackedRgb` is the bridge
 * from the editor's hex strings. No pdf-lib.
 */

function clamp255(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

/**
 * Convert a hex colour (`#RRGGBB` or `#RGB`) to a packed `0xRRGGBB` integer for
 * the engine's drawing APIs. Malformed channels clamp to 0 (rather than crashing
 * a whole batch the way pdf-lib's `rgb()` did on out-of-range values).
 */
export function hexToPackedRgb(hex: string): number {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;

  const r = clamp255(parseInt(full.substring(0, 2), 16));
  const g = clamp255(parseInt(full.substring(2, 4), 16));
  const b = clamp255(parseInt(full.substring(4, 6), 16));

  return ((r << 16) | (g << 8) | b) >>> 0;
}

/**
 * Convert RGB components (0-1 range) to a hex string. Used by the parse-side
 * extractors that surface colours back to the editor.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp255(n * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert a hex colour (`#RRGGBB` or `#RGB`) to an `[r, g, b]` triple with each
 * channel in `0..1`, the form the engine's `setPathStyle` expects. Malformed
 * channels clamp to 0 (same forgiving policy as {@link hexToPackedRgb}).
 */
export function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;

  const r = clamp255(parseInt(full.substring(0, 2), 16));
  const g = clamp255(parseInt(full.substring(2, 4), 16));
  const b = clamp255(parseInt(full.substring(4, 6), 16));

  return [r / 255, g / 255, b / 255];
}
