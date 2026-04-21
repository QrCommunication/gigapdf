/**
 * Font name normalization and matching utilities for PDF font names.
 *
 * PDF font names often carry:
 *   - A subset prefix:  "ABCDEF+Calibri"
 *   - Style suffixes:   "Calibri,Bold" or "Calibri-Bold"
 *   - PostScript names: "TimesNewRomanPS-BoldMT"
 *
 * The resolver tries to match a PDF font name against a set of LoadedFont
 * entries returned by useEmbeddedFonts, handling all the above variations.
 */

import type { LoadedFont } from '../hooks/use-embedded-fonts';

// ─── Constants ────────────────────────────────────────────────────────────────

const SUBSET_PREFIX_RE = /^[A-Z]{6}\+/;

const STYLE_SUFFIXES_RE =
  /[,\-_\s]+(Bold|Italic|BoldItalic|Oblique|BoldOblique|Regular|Normal|Medium|Light|Thin|Black|Heavy|ExtraBold|SemiBold|Condensed|Expanded|Narrow|Wide)$/i;

const POSTSCRIPT_STYLE_SUFFIX_RE = /[-](Bold|Italic|Regular|Normal|BoldItalic|MT|Ps|PS)$/i;

// ─── Public Utilities ────────────────────────────────────────────────────────

/**
 * Normalize a raw PDF font name to a canonical form suitable for loose matching.
 *
 * Steps:
 *  1. Strip ABCDEF+ subset prefix.
 *  2. Strip trailing style tokens (,Bold | -Bold | -BoldMT etc.).
 *  3. Lowercase and collapse whitespace.
 */
export function normalizePdfFontName(name: string): string {
  if (!name) return '';

  let normalized = name.trim();
  normalized = normalized.replace(SUBSET_PREFIX_RE, '');
  normalized = normalized.replace(STYLE_SUFFIXES_RE, '');
  normalized = normalized.replace(POSTSCRIPT_STYLE_SUFFIX_RE, '');
  normalized = normalized.replace(/\s+/g, ' ').trim().toLowerCase();

  return normalized;
}

/**
 * Extract the subset prefix if present (e.g. "ABCDEF" from "ABCDEF+Calibri").
 * Returns null if the name has no subset prefix.
 */
export function extractSubsetPrefix(name: string): string | null {
  const match = SUBSET_PREFIX_RE.exec(name);
  return match ? match[0].replace('+', '') : null;
}

/**
 * Determine whether a raw PDF font name refers to a subset font.
 */
export function isSubsetFontName(name: string): boolean {
  return SUBSET_PREFIX_RE.test(name.trim());
}

/**
 * Match a raw PDF font name against the list of loaded fonts from useEmbeddedFonts.
 *
 * Matching strategy (in priority order):
 *  1. Exact match on originalName (case-sensitive).
 *  2. Exact match on originalName after stripping subset prefix from both.
 *  3. Normalized loose match (strip subset + style tokens, lowercase).
 *  4. Match against fontFamily (already normalized by the backend).
 *
 * Only returns fonts with status === 'loaded'.
 */
export function resolveFontMatch(
  pdfFontName: string,
  loadedFonts: LoadedFont[],
): LoadedFont | null {
  if (!pdfFontName || loadedFonts.length === 0) return null;

  const candidates = loadedFonts.filter((f) => f.status === 'loaded');
  if (candidates.length === 0) return null;

  // Strategy 1: exact originalName match
  const exactMatch = candidates.find((f) => f.metadata.originalName === pdfFontName);
  if (exactMatch) return exactMatch;

  // Strategy 2: exact match after stripping subset prefix
  const pdfNameStripped = pdfFontName.replace(SUBSET_PREFIX_RE, '');
  const strippedExact = candidates.find(
    (f) =>
      f.metadata.originalName.replace(SUBSET_PREFIX_RE, '') === pdfNameStripped ||
      f.metadata.originalName === pdfNameStripped,
  );
  if (strippedExact) return strippedExact;

  // Strategy 3: normalized loose match
  const normalizedPdf = normalizePdfFontName(pdfFontName);
  const looseMatch = candidates.find(
    (f) => normalizePdfFontName(f.metadata.originalName) === normalizedPdf,
  );
  if (looseMatch) return looseMatch;

  // Strategy 4: match against normalized fontFamily
  const familyMatch = candidates.find(
    (f) => f.metadata.fontFamily?.trim().toLowerCase() === normalizedPdf,
  );
  return familyMatch ?? null;
}
