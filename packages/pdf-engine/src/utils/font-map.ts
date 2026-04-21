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
 * Map a PDF internal font name (from pdfjs-dist) to a readable family + weight + style.
 */
export function mapPdfFontToStandard(pdfFontName: string): {
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
} {
  const lower = pdfFontName.toLowerCase();

  const isBold = lower.includes('bold') || lower.includes('heavy') || lower.includes('black');
  const isItalic = lower.includes('italic') || lower.includes('oblique');

  let fontFamily = 'Helvetica';
  if (lower.includes('times') || lower.includes('tiro') || lower.includes('serif')) {
    fontFamily = 'Times New Roman';
  } else if (lower.includes('courier') || lower.includes('cour') || lower.includes('mono')) {
    fontFamily = 'Courier New';
  } else if (lower.includes('arial') || lower.includes('helv') || lower.includes('sans')) {
    fontFamily = 'Helvetica';
  }

  return {
    fontFamily,
    fontWeight: isBold ? 'bold' : 'normal',
    fontStyle: isItalic ? 'italic' : 'normal',
  };
}
