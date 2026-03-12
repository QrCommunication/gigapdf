import { describe, it, expect } from 'vitest';
import { normalizeFontName, mapPdfFontToStandard } from '../../src/utils/font-map';
import { StandardFonts } from 'pdf-lib';

describe('normalizeFontName', () => {
  describe('Helvetica family', () => {
    it('maps "helvetica" to Helvetica', () => {
      expect(normalizeFontName('helvetica')).toBe(StandardFonts.Helvetica);
    });

    it('maps "Helvetica" (mixed case) to Helvetica', () => {
      expect(normalizeFontName('Helvetica')).toBe(StandardFonts.Helvetica);
    });

    it('maps "arial" to Helvetica', () => {
      expect(normalizeFontName('arial')).toBe(StandardFonts.Helvetica);
    });

    it('maps "Arial" (mixed case) to Helvetica', () => {
      expect(normalizeFontName('Arial')).toBe(StandardFonts.Helvetica);
    });

    it('maps "sans-serif" to Helvetica', () => {
      expect(normalizeFontName('sans-serif')).toBe(StandardFonts.Helvetica);
    });

    it('maps "helv" shorthand to Helvetica', () => {
      expect(normalizeFontName('helv')).toBe(StandardFonts.Helvetica);
    });

    it('maps "helvetica-bold" to HelveticaBold', () => {
      expect(normalizeFontName('helvetica-bold')).toBe(StandardFonts.HelveticaBold);
    });

    it('maps "hebo" shorthand to HelveticaBold', () => {
      expect(normalizeFontName('hebo')).toBe(StandardFonts.HelveticaBold);
    });

    it('maps "helvetica-oblique" to HelveticaOblique', () => {
      expect(normalizeFontName('helvetica-oblique')).toBe(StandardFonts.HelveticaOblique);
    });

    it('maps "heit" shorthand to HelveticaOblique', () => {
      expect(normalizeFontName('heit')).toBe(StandardFonts.HelveticaOblique);
    });

    it('maps "helvetica-boldoblique" to HelveticaBoldOblique', () => {
      expect(normalizeFontName('helvetica-boldoblique')).toBe(StandardFonts.HelveticaBoldOblique);
    });

    it('maps "hebi" shorthand to HelveticaBoldOblique', () => {
      expect(normalizeFontName('hebi')).toBe(StandardFonts.HelveticaBoldOblique);
    });
  });

  describe('Times Roman family', () => {
    it('maps "times" to TimesRoman', () => {
      expect(normalizeFontName('times')).toBe(StandardFonts.TimesRoman);
    });

    it('maps "Times" (mixed case) to TimesRoman', () => {
      expect(normalizeFontName('Times')).toBe(StandardFonts.TimesRoman);
    });

    it('maps "times new roman" to TimesRoman', () => {
      expect(normalizeFontName('times new roman')).toBe(StandardFonts.TimesRoman);
    });

    it('maps "times-roman" to TimesRoman', () => {
      expect(normalizeFontName('times-roman')).toBe(StandardFonts.TimesRoman);
    });

    it('maps "serif" to TimesRoman', () => {
      expect(normalizeFontName('serif')).toBe(StandardFonts.TimesRoman);
    });

    it('maps "tiro" shorthand to TimesRoman', () => {
      expect(normalizeFontName('tiro')).toBe(StandardFonts.TimesRoman);
    });

    it('maps "times-bold" to TimesRomanBold', () => {
      expect(normalizeFontName('times-bold')).toBe(StandardFonts.TimesRomanBold);
    });

    it('maps "tibo" shorthand to TimesRomanBold', () => {
      expect(normalizeFontName('tibo')).toBe(StandardFonts.TimesRomanBold);
    });

    it('maps "times-italic" to TimesRomanItalic', () => {
      expect(normalizeFontName('times-italic')).toBe(StandardFonts.TimesRomanItalic);
    });

    it('maps "tiit" shorthand to TimesRomanItalic', () => {
      expect(normalizeFontName('tiit')).toBe(StandardFonts.TimesRomanItalic);
    });

    it('maps "times-bolditalic" to TimesRomanBoldItalic', () => {
      expect(normalizeFontName('times-bolditalic')).toBe(StandardFonts.TimesRomanBoldItalic);
    });

    it('maps "tibi" shorthand to TimesRomanBoldItalic', () => {
      expect(normalizeFontName('tibi')).toBe(StandardFonts.TimesRomanBoldItalic);
    });
  });

  describe('Courier family', () => {
    it('maps "courier" to Courier', () => {
      expect(normalizeFontName('courier')).toBe(StandardFonts.Courier);
    });

    it('maps "Courier" (mixed case) to Courier', () => {
      expect(normalizeFontName('Courier')).toBe(StandardFonts.Courier);
    });

    it('maps "courier new" to Courier', () => {
      expect(normalizeFontName('courier new')).toBe(StandardFonts.Courier);
    });

    it('maps "monospace" to Courier', () => {
      expect(normalizeFontName('monospace')).toBe(StandardFonts.Courier);
    });

    it('maps "cour" shorthand to Courier', () => {
      expect(normalizeFontName('cour')).toBe(StandardFonts.Courier);
    });

    it('maps "courier-bold" to CourierBold', () => {
      expect(normalizeFontName('courier-bold')).toBe(StandardFonts.CourierBold);
    });

    it('maps "cobo" shorthand to CourierBold', () => {
      expect(normalizeFontName('cobo')).toBe(StandardFonts.CourierBold);
    });

    it('maps "courier-oblique" to CourierOblique', () => {
      expect(normalizeFontName('courier-oblique')).toBe(StandardFonts.CourierOblique);
    });

    it('maps "coit" shorthand to CourierOblique', () => {
      expect(normalizeFontName('coit')).toBe(StandardFonts.CourierOblique);
    });

    it('maps "courier-boldoblique" to CourierBoldOblique', () => {
      expect(normalizeFontName('courier-boldoblique')).toBe(StandardFonts.CourierBoldOblique);
    });

    it('maps "cobi" shorthand to CourierBoldOblique', () => {
      expect(normalizeFontName('cobi')).toBe(StandardFonts.CourierBoldOblique);
    });
  });

  describe('Symbol and dingbats', () => {
    it('maps "symbol" to Symbol', () => {
      expect(normalizeFontName('symbol')).toBe(StandardFonts.Symbol);
    });

    it('maps "zapfdingbats" to ZapfDingbats', () => {
      expect(normalizeFontName('zapfdingbats')).toBe(StandardFonts.ZapfDingbats);
    });
  });

  describe('Unknown font fallback', () => {
    it('falls back to Helvetica for a completely unknown font name', () => {
      expect(normalizeFontName('unknownfont')).toBe(StandardFonts.Helvetica);
    });

    it('falls back to Helvetica for an empty string', () => {
      expect(normalizeFontName('')).toBe(StandardFonts.Helvetica);
    });

    it('falls back to Helvetica for a random string', () => {
      expect(normalizeFontName('Comic Sans')).toBe(StandardFonts.Helvetica);
    });

    it('trims surrounding whitespace before lookup', () => {
      expect(normalizeFontName('  helvetica  ')).toBe(StandardFonts.Helvetica);
    });
  });
});

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
