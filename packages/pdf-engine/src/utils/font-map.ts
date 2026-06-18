/**
 * The 14 standard PDF (Type1 base) fonts, keyed by their canonical PostScript
 * names. Mirrors the value set of pdf-lib's `StandardFonts` enum so existing
 * consumers keep working, without pulling pdf-lib into the bundle.
 */
export const StandardFonts = {
  Helvetica: 'Helvetica',
  HelveticaBold: 'Helvetica-Bold',
  HelveticaOblique: 'Helvetica-Oblique',
  HelveticaBoldOblique: 'Helvetica-BoldOblique',
  TimesRoman: 'Times-Roman',
  TimesRomanBold: 'Times-Bold',
  TimesRomanItalic: 'Times-Italic',
  TimesRomanBoldItalic: 'Times-BoldItalic',
  Courier: 'Courier',
  CourierBold: 'Courier-Bold',
  CourierOblique: 'Courier-Oblique',
  CourierBoldOblique: 'Courier-BoldOblique',
  Symbol: 'Symbol',
  ZapfDingbats: 'ZapfDingbats',
} as const;

/** One of the 14 standard PDF base-font PostScript names. */
export type StandardFont = (typeof StandardFonts)[keyof typeof StandardFonts];

/**
 * Map des familles connues vers une StandardFont (nom PostScript du base-14).
 * Seules les polices listées ici sont des polices standard PDF.
 * Tout nom absent de cette map = police custom → ne pas faire de fallback silencieux.
 */
const STANDARD_FONT_MAP: Record<string, StandardFont> = {
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
 * Résout un nom de police vers une StandardFont (nom PostScript du base-14).
 * Retourne null si la police n'est pas une StandardFont connue — dans ce cas,
 * l'appelant doit embed les bytes de la police custom plutôt que de faire un fallback.
 */
export function resolveStandardFont(fontName: string): StandardFont | null {
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
  // Weight keywords appear either word-bounded ("Arial-Bold") or glued to an
  // adjacent token ("Helvetica-BoldOblique", "TimesNewRomanPS-BoldMT",
  // "GothamHeavy", "FuturaBlack"). The second pattern anchors the keyword to
  // the end of the name (optionally trailed by a style/PostScript suffix) and
  // excludes "SemiBold"/"DemiBold" (medium weights → not bold). The end-anchor
  // also avoids false positives like "Blackbird" (keyword mid-name).
  const isBold =
    /\b(?:bold|heavy|black|extrabold)\b/i.test(pdfFontName) ||
    /(?<!semi)(?<!demi)(?:bold|heavy|black|extrabold)(?:oblique|italic)?(?:mt|ps|std)?$/i.test(
      pdfFontName,
    ) ||
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
