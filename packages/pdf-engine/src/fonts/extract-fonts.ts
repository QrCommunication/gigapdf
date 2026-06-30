/**
 * Embedded-font extraction for the editor's overlay text layer.
 *
 * The editor renders editable text on top of a text-free page raster using the
 * document's OWN fonts (via the browser FontFace API). This module is the single
 * source of truth for serving those fonts — backed entirely by the gigapdf
 * engine (`embeddedFonts` + `extractWebFont`), with ZERO external font tooling
 * (no pikepdf, no fontTools).
 *
 * Why `extractWebFont` and not a PDF-font reparser: a PDF selects a CFF/Type1
 * glyph by NAME (via the font's charset), never by code, and routinely ships a
 * bare CFF or a `cmap`-less TrueType subset that a browser's `FontFace`/OTS
 * rejects. The engine repairs those into a real, loadable sfnt with a correct
 * Unicode `cmap` built from the PDF's own `code → Unicode` decode mapping —
 * **keeping the original glyphs** (no substitute), so every run renders the right
 * letters (a naive "code == gid" cmap synthesis mapped `M → U` — the CERFA
 * garbling this replaces).
 *
 * One entry PER embedded subset (no de-duplication): a PDF embeds many disjoint
 * subsets of the SAME family (`XXXXXX+TimesNewRoman` ×30+), each carrying only
 * the glyphs of the runs it painted. The editor loads them all and picks, per
 * run, the subset that actually covers the run's code points — so each subset
 * must be served with its own glyphs under its own (full, prefix-included)
 * `/BaseFont` name.
 */

import { openDocument, closeDocument } from '../engine';

/** Metadata for one embedded font subset, consumed by the editor. */
export interface ExtractedFontMeta {
  /** Stable id derived from the full `/BaseFont` (cache + fetch key). */
  fontId: string;
  /** The `/BaseFont` name (subset prefix kept) — unique per embedded subset. */
  originalName: string;
  /** PostScript-ish name (subset prefix stripped). */
  postscriptName: string | null;
  /** Display family (variant suffixes stripped). */
  fontFamily: string | null;
  /** PDF font subtype label (TrueType / Type1 / …) from the embedded program. */
  subtype: string;
  /** Always true here — `extractWebFont` yields a browser-loadable sfnt. */
  isEmbedded: boolean;
  /** True when the `/BaseFont` carries an `ABCDEF+` subset prefix. */
  isSubset: boolean;
  /** Browser binary format the binary endpoint serves. */
  format: 'ttf' | 'otf' | 'cff' | null;
  /** Unknown without extracting; the editor does not rely on it. */
  sizeBytes: number | null;
}

/** Binary payload for one font, base64-encoded for JSON transport. */
export interface ExtractedFontBinary {
  fontId: string;
  dataBase64: string;
  format: 'ttf' | 'otf' | 'cff';
  mimeType: string;
  originalName: string;
}

const SUBSET_PREFIX = /^[A-Z]{6}\+/;

function isSubsetName(name: string): boolean {
  return SUBSET_PREFIX.test(name);
}

/** Best-effort display family: drop the subset prefix and variant suffixes. */
function fontFamilyOf(name: string): string {
  let f = name.replace(SUBSET_PREFIX, '');
  f = f.split(',')[0] ?? f; // "TimesNewRoman,Bold" → "TimesNewRoman"
  f = f.replace(/PS(-?(?:Bold|Italic|BoldItalic))?MT$/i, ''); // "TimesNewRomanPS-BoldMT" → "TimesNewRoman"
  f = f.replace(/-(?:Bold|Italic|BoldItalic|Roman|Regular)$/i, ''); // "Times-Bold" → "Times"
  f = f.replace(/MT$/i, '');
  return f.trim() || name.replace(SUBSET_PREFIX, '');
}

/** PDF subtype label + browser format from the engine's embedded-program kind. */
function describeFormat(format: 'truetype' | 'cff' | 'type1'): {
  subtype: string;
  browser: 'ttf' | 'otf';
} {
  if (format === 'truetype') return { subtype: 'TrueType', browser: 'ttf' };
  // CFF (Type1C) and Type1 are wrapped to OpenType (`OTTO`) by extractWebFont.
  return { subtype: 'Type1', browser: 'otf' };
}

/**
 * Deterministic 16-hex-char id (FNV-1a 64-bit). Dependency-free — the id only
 * needs to be stable and collision-resistant across the font names of a single
 * document, not cryptographic. Keyed on the FULL `/BaseFont` (prefix included),
 * so it is unique per embedded subset.
 */
function hashFontId(name: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < name.length; i++) {
    h = (h ^ BigInt(name.charCodeAt(i))) & mask;
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * List the document's embedded font subsets (one entry each, by full
 * `/BaseFont`) with the metadata the editor needs. Cheap — reads
 * `embeddedFonts()` only, no per-font extraction.
 */
export async function listDocumentFonts(bytes: Buffer): Promise<ExtractedFontMeta[]> {
  const handle = await openDocument(bytes);
  try {
    const embedded = handle._doc.embeddedFonts();
    const out: ExtractedFontMeta[] = [];
    const seen = new Set<string>();
    for (const ef of embedded) {
      if (seen.has(ef.baseFont)) continue; // identical /BaseFont ⇒ same subset
      seen.add(ef.baseFont);
      const { subtype, browser } = describeFormat(ef.format);
      out.push({
        fontId: hashFontId(ef.baseFont),
        originalName: ef.baseFont,
        postscriptName: ef.baseFont.replace(SUBSET_PREFIX, ''),
        fontFamily: fontFamilyOf(ef.baseFont),
        subtype,
        isEmbedded: true,
        isSubset: isSubsetName(ef.baseFont),
        format: browser,
        sizeBytes: null,
      });
    }
    return out;
  } finally {
    closeDocument(handle);
  }
}

/**
 * Return the browser-loadable binary for one font id, or null when the id is
 * unknown or the face cannot be made FontFace-loadable.
 */
export async function getDocumentFont(
  bytes: Buffer,
  fontId: string,
): Promise<ExtractedFontBinary | null> {
  const handle = await openDocument(bytes);
  try {
    const embedded = handle._doc.embeddedFonts();
    const seen = new Set<string>();
    for (const ef of embedded) {
      if (seen.has(ef.baseFont)) continue;
      seen.add(ef.baseFont);
      if (hashFontId(ef.baseFont) !== fontId) continue;

      const web = handle._doc.extractWebFont(ef.baseFont);
      if (!web) return null;
      // truetype → ttf, otf (wrapped CFF / OpenType) → otf; bare cff/type1 are
      // not FontFace-loadable.
      const format: 'ttf' | 'otf' | null =
        web.format === 'truetype' ? 'ttf' : web.format === 'otf' ? 'otf' : null;
      if (!format) return null;
      return {
        fontId,
        dataBase64: Buffer.from(web.bytes).toString('base64'),
        format,
        mimeType: format === 'ttf' ? 'font/ttf' : 'font/otf',
        originalName: ef.baseFont,
      };
    }
    return null;
  } finally {
    closeDocument(handle);
  }
}
