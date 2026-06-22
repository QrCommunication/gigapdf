/**
 * Bundled OFL fonts for the apply-elements bake fallback.
 *
 * pdf-lib's StandardFonts (the 14 PDF base fonts) cannot be embedded with
 * Unicode characters and have very poor metric matches with the typography
 * usually found in invoices and forms (Calibri, OCRB, Gotham, …). When
 * fontkit cannot embed the original font (e.g. binary Type1 program) we
 * pull in a metric-compatible TTF from this directory instead, so the
 * baked text keeps the right WIDTH and the mask actually covers the
 * original glyph.
 *
 * Bundled families (all OFL or LGPL with font exception):
 *   - LiberationSans   ← metric-compat Helvetica / Arial
 *   - LiberationSerif  ← metric-compat Times New Roman
 *   - LiberationMono   ← metric-compat Courier New
 *   - CourierPrime     ← OFL Courier-style for OCR / monospace fallback
 *
 * Source: https://github.com/liberationfonts/liberation-fonts (LGPL-2.1
 * with font exception, ships in every Linux distro) and Courier Prime
 * from Google Fonts (OFL).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-safe __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fonts live under packages/pdf-engine/fonts/. The path is relative to the
// COMPILED location so it survives bundling. fileURLToPath handles both
// dev (TS source) and production (transpiled .js).
const FONTS_DIR = resolve(__dirname, '..', '..', 'fonts');

export type BundledFontStyle = 'regular' | 'bold' | 'italic' | 'bold-italic';
export type BundledFontFamily = 'sans' | 'serif' | 'mono' | 'ocr';

const FILE_MAP: Record<BundledFontFamily, Record<BundledFontStyle, string>> = {
  sans: {
    regular: 'LiberationSans-Regular.ttf',
    bold: 'LiberationSans-Bold.ttf',
    italic: 'LiberationSans-Italic.ttf',
    'bold-italic': 'LiberationSans-BoldItalic.ttf',
  },
  serif: {
    regular: 'LiberationSerif-Regular.ttf',
    bold: 'LiberationSerif-Bold.ttf',
    italic: 'LiberationSerif-Italic.ttf',
    'bold-italic': 'LiberationSerif-BoldItalic.ttf',
  },
  mono: {
    regular: 'LiberationMono-Regular.ttf',
    bold: 'LiberationMono-Bold.ttf',
    italic: 'LiberationMono-Italic.ttf',
    'bold-italic': 'LiberationMono-BoldItalic.ttf',
  },
  ocr: {
    regular: 'CourierPrime-Regular.ttf',
    bold: 'CourierPrime-Bold.ttf',
    italic: 'CourierPrime-Italic.ttf',
    'bold-italic': 'CourierPrime-BoldItalic.ttf',
  },
};

// In-memory cache so we don't re-read the same TTF on every apply-elements
// call. Process-lifetime cache is fine: the bytes are immutable and the
// font files are bundled with the deployment.
const fontByteCache = new Map<string, Uint8Array>();

/** Load a bundled TTF as raw bytes ready for pdf-lib's embedFont(). */
export function loadBundledFontBytes(
  family: BundledFontFamily,
  style: BundledFontStyle,
): Uint8Array {
  const filename = FILE_MAP[family][style];
  if (fontByteCache.has(filename)) {
    return fontByteCache.get(filename)!;
  }
  const filePath = resolve(FONTS_DIR, filename);
  const bytes = readFileSync(filePath);
  const arr = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  fontByteCache.set(filename, arr);
  return arr;
}

/**
 * Pick a bundled font family from the source font name.
 *
 * Priority:
 *   - OCR* / Pitch* (OCRB-like)         → 'ocr' (CourierPrime)
 *   - Courier* / Mono* / Typewriter*    → 'mono' (LiberationMono)
 *   - Times / Garamond / Serif / Roman  → 'serif' (LiberationSerif)
 *   - everything else                   → 'sans' (LiberationSans)
 */
export function pickBundledFamily(fontName: string | null | undefined): BundledFontFamily {
  const name = (fontName ?? '').toLowerCase();
  if (/ocr|pitch/.test(name)) return 'ocr';
  if (/courier|mono|typewriter|consolas|menlo/.test(name)) return 'mono';
  if (/times|garamond|serif|roman|iliad|georgia|caslon|palatino|book/.test(name)) {
    return 'serif';
  }
  return 'sans';
}

export function pickBundledStyle(
  weight: string | undefined,
  style: string | undefined,
  fontName?: string | null,
): BundledFontStyle {
  const name = (fontName ?? '').toLowerCase();
  const isBold = weight === 'bold' || /\bbold\b|heavy|black|extrabold/.test(name);
  const isItalic = style === 'italic' || /italic|oblique/.test(name);
  if (isBold && isItalic) return 'bold-italic';
  if (isBold) return 'bold';
  if (isItalic) return 'italic';
  return 'regular';
}

/**
 * Map a font name + weight/style to its base-14 PostScript name, or `null` if the
 * font is not one of the five base-14 standard families.
 *
 * When non-null, the caller should reference the standard font (the engine emits a
 * nude `/Type1` dict with **no** `FontFile`) instead of embedding a substitute —
 * Adobe and the engine's own rasteriser both draw the base-14 set natively, so a
 * base-14 family renders identically at ~1 KB instead of ~57 KB per added font.
 *
 * Only the standard families qualify (Helvetica/Arial, Times, Courier, Symbol,
 * ZapfDingbats). Arbitrary fonts return `null` and keep the bundled Liberation
 * embed, which has better metrics than Standard-14 for a non-exact substitution.
 * OCR/Pitch Courier variants are excluded (they map to the specialised bundled
 * CourierPrime, not base-14 Courier).
 */
export function base14NameFor(
  fontName: string | null | undefined,
  weight: string | undefined,
  style: string | undefined,
): string | null {
  const name = (fontName ?? '').toLowerCase();
  const isBold = weight === 'bold' || /\bbold\b|heavy|black|extrabold/.test(name);
  const isItalic = style === 'italic' || /italic|oblique/.test(name);

  // Symbol / ZapfDingbats have no style variants.
  if (/zapf|dingbat/.test(name)) return 'ZapfDingbats';
  if (/\bsymbol\b/.test(name)) return 'Symbol';

  // Helvetica / Arial → Helvetica family (sans).
  if (/helvetica|arial/.test(name)) {
    if (isBold && isItalic) return 'Helvetica-BoldOblique';
    if (isBold) return 'Helvetica-Bold';
    if (isItalic) return 'Helvetica-Oblique';
    return 'Helvetica';
  }
  // Times / Times New Roman → Times family (serif).
  if (/times/.test(name)) {
    if (isBold && isItalic) return 'Times-BoldItalic';
    if (isBold) return 'Times-Bold';
    if (isItalic) return 'Times-Italic';
    return 'Times-Roman';
  }
  // Courier → Courier family (mono). Exclude OCR/Pitch (specialised bundled).
  if (/courier/.test(name) && !/ocr|pitch/.test(name)) {
    if (isBold && isItalic) return 'Courier-BoldOblique';
    if (isBold) return 'Courier-Bold';
    if (isItalic) return 'Courier-Oblique';
    return 'Courier';
  }
  return null;
}
