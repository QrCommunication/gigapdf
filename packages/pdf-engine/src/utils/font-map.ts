import { StandardFonts } from 'pdf-lib';

/**
 * Map des familles connues vers pdf-lib StandardFonts.
 * Seules les polices listées ici sont des polices standard PDF.
 * Tout nom absent de cette map = police custom → ne pas faire de fallback silencieux.
 */
const STANDARD_FONT_MAP: Record<string, StandardFonts> = {
  'helvetica': StandardFonts.Helvetica,
  'helv': StandardFonts.Helvetica,
  'arial': StandardFonts.Helvetica,
  'sans-serif': StandardFonts.Helvetica,
  'helvetica-bold': StandardFonts.HelveticaBold,
  'hebo': StandardFonts.HelveticaBold,
  'helvetica-oblique': StandardFonts.HelveticaOblique,
  'heit': StandardFonts.HelveticaOblique,
  'helvetica-boldoblique': StandardFonts.HelveticaBoldOblique,
  'hebi': StandardFonts.HelveticaBoldOblique,
  'times': StandardFonts.TimesRoman,
  'tiro': StandardFonts.TimesRoman,
  'times new roman': StandardFonts.TimesRoman,
  'times-roman': StandardFonts.TimesRoman,
  'serif': StandardFonts.TimesRoman,
  'times-bold': StandardFonts.TimesRomanBold,
  'tibo': StandardFonts.TimesRomanBold,
  'times-italic': StandardFonts.TimesRomanItalic,
  'tiit': StandardFonts.TimesRomanItalic,
  'times-bolditalic': StandardFonts.TimesRomanBoldItalic,
  'tibi': StandardFonts.TimesRomanBoldItalic,
  'courier': StandardFonts.Courier,
  'cour': StandardFonts.Courier,
  'courier new': StandardFonts.Courier,
  'monospace': StandardFonts.Courier,
  'courier-bold': StandardFonts.CourierBold,
  'cobo': StandardFonts.CourierBold,
  'courier-oblique': StandardFonts.CourierOblique,
  'coit': StandardFonts.CourierOblique,
  'courier-boldoblique': StandardFonts.CourierBoldOblique,
  'cobi': StandardFonts.CourierBoldOblique,
  'symbol': StandardFonts.Symbol,
  'zapfdingbats': StandardFonts.ZapfDingbats,
};

/**
 * Normalise un nom de police (casse + trim), sans résolution vers une StandardFont.
 * Utilisé pour la comparaison avant décision de rendu.
 */
export function normalizeFontName(fontName: string): string {
  return fontName.toLowerCase().trim();
}

/**
 * Résout un nom de police vers une pdf-lib StandardFont.
 * Retourne null si la police n'est pas une StandardFont connue — dans ce cas,
 * l'appelant doit embed les bytes de la police custom plutôt que de faire un fallback.
 */
export function resolveStandardFont(fontName: string): StandardFonts | null {
  const key = normalizeFontName(fontName);
  return STANDARD_FONT_MAP[key] ?? null;
}

/**
 * Vérifie si un nom de police correspond à une pdf Standard Font (Type1).
 */
export function isStandardFont(fontName: string): boolean {
  return resolveStandardFont(fontName) !== null;
}

/**
 * Heuristic fallback when the original font cannot be embedded (e.g. Type1
 * binaries that fontkit refuses with "Unknown font format"). Picks the
 * StandardFont closest in metrics so the bake doesn't collapse to Helvetica
 * for a monospaced source like OCRB — the visible LICHALICHA2 doublon comes
 * partially from the width mismatch (Helvetica is narrower, so the new text
 * ends BEFORE the old glyph's right edge and the original stays visible).
 *
 * Order: monospace markers first (OCR/Courier/Mono/Pitch), then serif
 * markers (Times/Garamond/Serif/Roman/Iliad), default sans-serif.
 */
export function pickFallbackStandardFont(
  fontName: string | null | undefined,
  weight?: string,
  style?: string,
): StandardFonts {
  const name = (fontName ?? '').toLowerCase();
  const isBold = weight === 'bold' || /\bbold\b/.test(name);
  const isItalic =
    style === 'italic' || /italic|oblique/.test(name);

  const isMono =
    /ocr|courier|mono|pitch|typewriter|consolas|menlo/.test(name);
  if (isMono) {
    if (isBold && isItalic) return StandardFonts.CourierBoldOblique;
    if (isBold) return StandardFonts.CourierBold;
    if (isItalic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }

  const isSerif =
    /times|garamond|serif|roman|iliad|georgia|caslon|palatino|book/.test(name);
  if (isSerif) {
    if (isBold && isItalic) return StandardFonts.TimesRomanBoldItalic;
    if (isBold) return StandardFonts.TimesRomanBold;
    if (isItalic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }

  if (isBold && isItalic) return StandardFonts.HelveticaBoldOblique;
  if (isBold) return StandardFonts.HelveticaBold;
  if (isItalic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/**
 * Map a PDF internal font name (from pdfjs-dist) to a readable family + weight + style.
 *
 * The family name we return is the CSS `font-family` used as a *fallback*
 * when the embedded font byte stream is not available. The editor's font
 * loader (`useEmbeddedFonts`) registers a unique FontFace per document, and
 * Fabric uses that name first. Only when the embedded font is missing do we
 * fall through to this fallback — so the family must match the *intent* of
 * the source typography (Arial → "Arial", Calibri → "Calibri") rather than
 * collapsing every sans-serif to Helvetica.
 */
export function mapPdfFontToStandard(pdfFontName: string): {
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
} {
  // Detect weight from name suffix or numeric tag. Medium/Semibold treated
  // as not-bold for CSS fontWeight (the actual weight number is more useful
  // but the editor doesn't currently surface it).
  const isBold =
    /\bbold\b/i.test(pdfFontName) ||
    /\bheavy\b/i.test(pdfFontName) ||
    /\bblack\b/i.test(pdfFontName) ||
    /\bextrabold\b/i.test(pdfFontName) ||
    /\bw[6-9]\d{2}\b/i.test(pdfFontName); // W700, W800, W900
  const isItalic = /italic|oblique/i.test(pdfFontName);

  // Strip subset prefix ("AAAAAA+") and trailing weight/style suffixes so we
  // can recognise the family even when pdfjs gave us "AAAAAA+Arial-BoldMT"
  // or "JRIXYS+Gotham-Book". Keep the *first* hyphen separator so suffix
  // detection still has the marker, but drop it from the family name.
  const stripped = pdfFontName
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/[-,]?\s*(MT|PS|Std)\s*$/i, '')
    .replace(/[-,]?\s*(Bold|Heavy|Black|ExtraBold|Italic|Oblique|Regular|Medium|SemiBold|DemiBold|Light|Thin|Book)\s*(Italic|Oblique)?\s*$/i, '')
    .replace(/\s+$/, '');

  // Known family roots, in priority order. The first hit wins so that
  // "Helvetica Neue" maps to Helvetica, not the looser Arial check.
  const familyMap: ReadonlyArray<readonly [RegExp, string]> = [
    [/times/i, 'Times New Roman'],
    [/\btiro\b/i, 'Times New Roman'],
    [/courier/i, 'Courier New'],
    [/\bcour\b/i, 'Courier New'],
    [/\bocrb/i, 'Courier New'],
    [/\bmono/i, 'Courier New'],
    [/calibri/i, 'Calibri'],
    [/cambria/i, 'Cambria'],
    [/georgia/i, 'Georgia'],
    [/verdana/i, 'Verdana'],
    [/tahoma/i, 'Tahoma'],
    [/segoe/i, 'Segoe UI'],
    [/roboto/i, 'Roboto'],
    [/open\s*sans/i, 'Open Sans'],
    [/gotham/i, 'Gotham'],
    [/iliad/i, 'Iliad'],
    [/helvetica/i, 'Helvetica'],
    [/\bhelv\b/i, 'Helvetica'],
    [/arial/i, 'Arial'],
  ];
  let fontFamily = '';
  for (const [pattern, family] of familyMap) {
    if (pattern.test(stripped)) {
      fontFamily = family;
      break;
    }
  }
  if (!fontFamily) {
    if (/serif/i.test(stripped)) fontFamily = 'Times New Roman';
    else if (/sans/i.test(stripped)) fontFamily = 'Arial';
    else if (stripped.length > 0) fontFamily = stripped;
    else fontFamily = 'Helvetica';
  }

  return {
    fontFamily,
    fontWeight: isBold ? 'bold' : 'normal',
    fontStyle: isItalic ? 'italic' : 'normal',
  };
}
