import { describe, it, expect } from 'vitest';
import {
  normalizeFontName,
  resolveStandardFont,
  isStandardFont,
  mapPdfFontToStandard,
} from '../../src/utils/font-map';
import { StandardFonts } from 'pdf-lib';

// ─── normalizeFontName ────────────────────────────────────────────────────────
// normalizeFontName est désormais une fonction de normalisation de chaîne pure :
// elle retourne le nom en minuscules sans espaces de bord.
// La résolution vers StandardFonts est assurée par resolveStandardFont().

describe('normalizeFontName', () => {
  it('lowercases and trims a simple name', () => {
    expect(normalizeFontName('Helvetica')).toBe('helvetica');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeFontName('  helvetica  ')).toBe('helvetica');
  });

  it('lowercases mixed-case names', () => {
    expect(normalizeFontName('Times New Roman')).toBe('times new roman');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeFontName('')).toBe('');
  });

  it('lowercases unknown font names without fallback', () => {
    expect(normalizeFontName('ComicSans')).toBe('comicsans');
  });
});

// ─── resolveStandardFont ──────────────────────────────────────────────────────
// resolveStandardFont résout un nom de police vers une pdf-lib StandardFont.
// Retourne null pour les polices custom (pas de fallback silencieux).

describe('resolveStandardFont', () => {
  describe('Helvetica family', () => {
    it('resolves "helvetica" to Helvetica', () => {
      expect(resolveStandardFont('helvetica')).toBe(StandardFonts.Helvetica);
    });

    it('resolves "Helvetica" (mixed case) to Helvetica', () => {
      expect(resolveStandardFont('Helvetica')).toBe(StandardFonts.Helvetica);
    });

    it('resolves "arial" to Helvetica', () => {
      expect(resolveStandardFont('arial')).toBe(StandardFonts.Helvetica);
    });

    it('resolves "Arial" (mixed case) to Helvetica', () => {
      expect(resolveStandardFont('Arial')).toBe(StandardFonts.Helvetica);
    });

    it('resolves "sans-serif" to Helvetica', () => {
      expect(resolveStandardFont('sans-serif')).toBe(StandardFonts.Helvetica);
    });

    it('resolves "helv" shorthand to Helvetica', () => {
      expect(resolveStandardFont('helv')).toBe(StandardFonts.Helvetica);
    });

    it('resolves "helvetica-bold" to HelveticaBold', () => {
      expect(resolveStandardFont('helvetica-bold')).toBe(StandardFonts.HelveticaBold);
    });

    it('resolves "hebo" shorthand to HelveticaBold', () => {
      expect(resolveStandardFont('hebo')).toBe(StandardFonts.HelveticaBold);
    });

    it('resolves "helvetica-oblique" to HelveticaOblique', () => {
      expect(resolveStandardFont('helvetica-oblique')).toBe(StandardFonts.HelveticaOblique);
    });

    it('resolves "heit" shorthand to HelveticaOblique', () => {
      expect(resolveStandardFont('heit')).toBe(StandardFonts.HelveticaOblique);
    });

    it('resolves "helvetica-boldoblique" to HelveticaBoldOblique', () => {
      expect(resolveStandardFont('helvetica-boldoblique')).toBe(StandardFonts.HelveticaBoldOblique);
    });

    it('resolves "hebi" shorthand to HelveticaBoldOblique', () => {
      expect(resolveStandardFont('hebi')).toBe(StandardFonts.HelveticaBoldOblique);
    });
  });

  describe('Times Roman family', () => {
    it('resolves "times" to TimesRoman', () => {
      expect(resolveStandardFont('times')).toBe(StandardFonts.TimesRoman);
    });

    it('resolves "Times" (mixed case) to TimesRoman', () => {
      expect(resolveStandardFont('Times')).toBe(StandardFonts.TimesRoman);
    });

    it('resolves "times new roman" to TimesRoman', () => {
      expect(resolveStandardFont('times new roman')).toBe(StandardFonts.TimesRoman);
    });

    it('resolves "times-roman" to TimesRoman', () => {
      expect(resolveStandardFont('times-roman')).toBe(StandardFonts.TimesRoman);
    });

    it('resolves "serif" to TimesRoman', () => {
      expect(resolveStandardFont('serif')).toBe(StandardFonts.TimesRoman);
    });

    it('resolves "tiro" shorthand to TimesRoman', () => {
      expect(resolveStandardFont('tiro')).toBe(StandardFonts.TimesRoman);
    });

    it('resolves "times-bold" to TimesRomanBold', () => {
      expect(resolveStandardFont('times-bold')).toBe(StandardFonts.TimesRomanBold);
    });

    it('resolves "tibo" shorthand to TimesRomanBold', () => {
      expect(resolveStandardFont('tibo')).toBe(StandardFonts.TimesRomanBold);
    });

    it('resolves "times-italic" to TimesRomanItalic', () => {
      expect(resolveStandardFont('times-italic')).toBe(StandardFonts.TimesRomanItalic);
    });

    it('resolves "tiit" shorthand to TimesRomanItalic', () => {
      expect(resolveStandardFont('tiit')).toBe(StandardFonts.TimesRomanItalic);
    });

    it('resolves "times-bolditalic" to TimesRomanBoldItalic', () => {
      expect(resolveStandardFont('times-bolditalic')).toBe(StandardFonts.TimesRomanBoldItalic);
    });

    it('resolves "tibi" shorthand to TimesRomanBoldItalic', () => {
      expect(resolveStandardFont('tibi')).toBe(StandardFonts.TimesRomanBoldItalic);
    });
  });

  describe('Courier family', () => {
    it('resolves "courier" to Courier', () => {
      expect(resolveStandardFont('courier')).toBe(StandardFonts.Courier);
    });

    it('resolves "Courier" (mixed case) to Courier', () => {
      expect(resolveStandardFont('Courier')).toBe(StandardFonts.Courier);
    });

    it('resolves "courier new" to Courier', () => {
      expect(resolveStandardFont('courier new')).toBe(StandardFonts.Courier);
    });

    it('resolves "monospace" to Courier', () => {
      expect(resolveStandardFont('monospace')).toBe(StandardFonts.Courier);
    });

    it('resolves "cour" shorthand to Courier', () => {
      expect(resolveStandardFont('cour')).toBe(StandardFonts.Courier);
    });

    it('resolves "courier-bold" to CourierBold', () => {
      expect(resolveStandardFont('courier-bold')).toBe(StandardFonts.CourierBold);
    });

    it('resolves "cobo" shorthand to CourierBold', () => {
      expect(resolveStandardFont('cobo')).toBe(StandardFonts.CourierBold);
    });

    it('resolves "courier-oblique" to CourierOblique', () => {
      expect(resolveStandardFont('courier-oblique')).toBe(StandardFonts.CourierOblique);
    });

    it('resolves "coit" shorthand to CourierOblique', () => {
      expect(resolveStandardFont('coit')).toBe(StandardFonts.CourierOblique);
    });

    it('resolves "courier-boldoblique" to CourierBoldOblique', () => {
      expect(resolveStandardFont('courier-boldoblique')).toBe(StandardFonts.CourierBoldOblique);
    });

    it('resolves "cobi" shorthand to CourierBoldOblique', () => {
      expect(resolveStandardFont('cobi')).toBe(StandardFonts.CourierBoldOblique);
    });
  });

  describe('Symbol and dingbats', () => {
    it('resolves "symbol" to Symbol', () => {
      expect(resolveStandardFont('symbol')).toBe(StandardFonts.Symbol);
    });

    it('resolves "zapfdingbats" to ZapfDingbats', () => {
      expect(resolveStandardFont('zapfdingbats')).toBe(StandardFonts.ZapfDingbats);
    });
  });

  describe('Custom fonts — null retourné (pas de fallback silencieux)', () => {
    it('returns null for a completely unknown font name', () => {
      expect(resolveStandardFont('unknownfont')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(resolveStandardFont('')).toBeNull();
    });

    it('returns null for "Comic Sans"', () => {
      expect(resolveStandardFont('Comic Sans')).toBeNull();
    });

    it('trims surrounding whitespace before lookup', () => {
      expect(resolveStandardFont('  helvetica  ')).toBe(StandardFonts.Helvetica);
    });

    it('returns null for a custom font name like "Calibri"', () => {
      expect(resolveStandardFont('Calibri')).toBeNull();
    });

    it('returns null for a custom font name like "Roboto"', () => {
      expect(resolveStandardFont('Roboto')).toBeNull();
    });
  });
});

// ─── isStandardFont ───────────────────────────────────────────────────────────

describe('isStandardFont', () => {
  it('returns true for "helvetica"', () => {
    expect(isStandardFont('helvetica')).toBe(true);
  });

  it('returns true for "Helvetica" (case-insensitive)', () => {
    expect(isStandardFont('Helvetica')).toBe(true);
  });

  it('returns true for "courier"', () => {
    expect(isStandardFont('courier')).toBe(true);
  });

  it('returns true for "times"', () => {
    expect(isStandardFont('times')).toBe(true);
  });

  it('returns true for "symbol"', () => {
    expect(isStandardFont('symbol')).toBe(true);
  });

  it('returns false for "Calibri"', () => {
    expect(isStandardFont('Calibri')).toBe(false);
  });

  it('returns false for an unknown font', () => {
    expect(isStandardFont('MyCustomFont')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isStandardFont('')).toBe(false);
  });
});

// ─── mapPdfFontToStandard ─────────────────────────────────────────────────────

describe('mapPdfFontToStandard', () => {
  describe('Helvetica / Arial family detection', () => {
    it('maps "ArialMT-Bold" to Helvetica bold normal', () => {
      const result = mapPdfFontToStandard('ArialMT-Bold');
      expect(result).toEqual({ fontFamily: 'Helvetica', fontWeight: 'bold', fontStyle: 'normal' });
    });

    it('maps "ArialMT" to Helvetica normal normal', () => {
      const result = mapPdfFontToStandard('ArialMT');
      expect(result).toEqual({ fontFamily: 'Helvetica', fontWeight: 'normal', fontStyle: 'normal' });
    });

    it('maps "Helvetica" to Helvetica normal normal', () => {
      const result = mapPdfFontToStandard('Helvetica');
      expect(result).toEqual({ fontFamily: 'Helvetica', fontWeight: 'normal', fontStyle: 'normal' });
    });

    it('maps "Helvetica-Bold" to Helvetica bold normal', () => {
      const result = mapPdfFontToStandard('Helvetica-Bold');
      expect(result).toEqual({ fontFamily: 'Helvetica', fontWeight: 'bold', fontStyle: 'normal' });
    });

    it('maps "Helvetica-Oblique" to Helvetica normal italic', () => {
      const result = mapPdfFontToStandard('Helvetica-Oblique');
      expect(result).toEqual({ fontFamily: 'Helvetica', fontWeight: 'normal', fontStyle: 'italic' });
    });

    it('maps "Helvetica-BoldOblique" to Helvetica bold italic', () => {
      const result = mapPdfFontToStandard('Helvetica-BoldOblique');
      expect(result).toEqual({ fontFamily: 'Helvetica', fontWeight: 'bold', fontStyle: 'italic' });
    });

    it('detects "SansCondensed" as Helvetica via "sans" keyword', () => {
      const result = mapPdfFontToStandard('SansCondensed');
      expect(result.fontFamily).toBe('Helvetica');
    });
  });

  describe('Times New Roman family detection', () => {
    it('maps "TimesNewRomanPS-ItalicMT" to Times New Roman normal italic', () => {
      const result = mapPdfFontToStandard('TimesNewRomanPS-ItalicMT');
      expect(result).toEqual({
        fontFamily: 'Times New Roman',
        fontWeight: 'normal',
        fontStyle: 'italic',
      });
    });

    it('maps "TimesNewRomanPS-BoldMT" to Times New Roman bold normal', () => {
      const result = mapPdfFontToStandard('TimesNewRomanPS-BoldMT');
      expect(result).toEqual({
        fontFamily: 'Times New Roman',
        fontWeight: 'bold',
        fontStyle: 'normal',
      });
    });

    it('maps "TimesNewRomanPS-BoldItalicMT" to Times New Roman bold italic', () => {
      const result = mapPdfFontToStandard('TimesNewRomanPS-BoldItalicMT');
      expect(result).toEqual({
        fontFamily: 'Times New Roman',
        fontWeight: 'bold',
        fontStyle: 'italic',
      });
    });

    it('maps "Times-Roman" to Times New Roman normal normal', () => {
      const result = mapPdfFontToStandard('Times-Roman');
      expect(result).toEqual({
        fontFamily: 'Times New Roman',
        fontWeight: 'normal',
        fontStyle: 'normal',
      });
    });

    it('detects font name containing "tiro" as Times New Roman', () => {
      const result = mapPdfFontToStandard('TiroDevanagari');
      expect(result.fontFamily).toBe('Times New Roman');
    });
  });

  describe('Courier / monospace family detection', () => {
    it('maps "Courier" to Courier New normal normal', () => {
      const result = mapPdfFontToStandard('Courier');
      expect(result).toEqual({
        fontFamily: 'Courier New',
        fontWeight: 'normal',
        fontStyle: 'normal',
      });
    });

    it('maps "Courier-Bold" to Courier New bold normal', () => {
      const result = mapPdfFontToStandard('Courier-Bold');
      expect(result).toEqual({
        fontFamily: 'Courier New',
        fontWeight: 'bold',
        fontStyle: 'normal',
      });
    });

    it('maps "CourierNewPSMT" to Courier New normal normal', () => {
      const result = mapPdfFontToStandard('CourierNewPSMT');
      expect(result).toEqual({
        fontFamily: 'Courier New',
        fontWeight: 'normal',
        fontStyle: 'normal',
      });
    });

    it('maps "CourierNew-BoldOblique" to Courier New bold italic', () => {
      const result = mapPdfFontToStandard('CourierNew-BoldOblique');
      expect(result).toEqual({
        fontFamily: 'Courier New',
        fontWeight: 'bold',
        fontStyle: 'italic',
      });
    });

    it('detects font name containing "mono" as Courier New', () => {
      const result = mapPdfFontToStandard('AnonymousPro-MonoRegular');
      expect(result.fontFamily).toBe('Courier New');
    });
  });

  describe('Bold and italic detection (weight / style flags)', () => {
    it('detects "heavy" in name as bold weight', () => {
      const result = mapPdfFontToStandard('GothamHeavy');
      expect(result.fontWeight).toBe('bold');
    });

    it('detects "black" in name as bold weight', () => {
      const result = mapPdfFontToStandard('FuturaBlack');
      expect(result.fontWeight).toBe('bold');
    });

    it('detects "italic" in name as italic style', () => {
      const result = mapPdfFontToStandard('SomeFont-Italic');
      expect(result.fontStyle).toBe('italic');
    });

    it('detects "oblique" in name as italic style', () => {
      const result = mapPdfFontToStandard('SomeFont-Oblique');
      expect(result.fontStyle).toBe('italic');
    });

    it('returns normal weight and style for a plain unknown font', () => {
      const result = mapPdfFontToStandard('SomePlainFont');
      expect(result.fontWeight).toBe('normal');
      expect(result.fontStyle).toBe('normal');
    });
  });

  describe('Unknown font fallback', () => {
    it('falls back to Helvetica normal normal for a completely unknown font name', () => {
      const result = mapPdfFontToStandard('CompletelyUnknownFont');
      expect(result).toEqual({
        fontFamily: 'Helvetica',
        fontWeight: 'normal',
        fontStyle: 'normal',
      });
    });

    it('falls back to Helvetica for an empty string', () => {
      const result = mapPdfFontToStandard('');
      expect(result).toEqual({
        fontFamily: 'Helvetica',
        fontWeight: 'normal',
        fontStyle: 'normal',
      });
    });
  });
});
