import { describe, it, expect } from 'vitest';
import { base14NameFor } from '../../src/utils/bundled-fonts';

/**
 * `base14NameFor` decides whether an added-text font is a base-14 standard
 * family (→ reference the standard font, zero FontFile, ~50× smaller saves) or
 * an arbitrary font (→ keep the bundled Liberation embed). It must map the five
 * standard families + style variants and exclude specialised OCR Courier.
 */
describe('base14NameFor', () => {
  it('maps Helvetica/Arial to the Helvetica family with style variants', () => {
    expect(base14NameFor('Helvetica', 'normal', 'normal')).toBe('Helvetica');
    expect(base14NameFor('Arial', 'bold', 'normal')).toBe('Helvetica-Bold');
    expect(base14NameFor('ArialMT', 'normal', 'italic')).toBe('Helvetica-Oblique');
    expect(base14NameFor('Helvetica', 'bold', 'italic')).toBe('Helvetica-BoldOblique');
  });

  it('maps Times / Times New Roman to the Times family with style variants', () => {
    expect(base14NameFor('Times New Roman', 'normal', 'normal')).toBe('Times-Roman');
    expect(base14NameFor('TimesNewRomanPSMT', 'bold', 'normal')).toBe('Times-Bold');
    expect(base14NameFor('Times', 'normal', 'italic')).toBe('Times-Italic');
    expect(base14NameFor('Times', 'bold', 'italic')).toBe('Times-BoldItalic');
  });

  it('maps Courier to the Courier family with style variants', () => {
    expect(base14NameFor('Courier', 'normal', 'normal')).toBe('Courier');
    expect(base14NameFor('Courier New', 'bold', 'normal')).toBe('Courier-Bold');
    expect(base14NameFor('Courier', 'normal', 'italic')).toBe('Courier-Oblique');
  });

  it('maps Symbol and ZapfDingbats (no style variants)', () => {
    expect(base14NameFor('Symbol', 'bold', 'italic')).toBe('Symbol');
    expect(base14NameFor('ZapfDingbats', 'normal', 'normal')).toBe('ZapfDingbats');
  });

  it('detects subset-prefixed names and a trailing weight in the name', () => {
    expect(base14NameFor('ABCDEF+Helvetica', undefined, undefined)).toBe('Helvetica');
    expect(base14NameFor('WXYZAB+Times-Bold', undefined, undefined)).toBe('Times-Bold');
  });

  it('returns null for non-base-14 families (keeps the bundled embed)', () => {
    expect(base14NameFor('Calibri', 'normal', 'normal')).toBeNull();
    expect(base14NameFor('Comic Sans MS', 'normal', 'normal')).toBeNull();
    expect(base14NameFor('Roboto', 'bold', 'normal')).toBeNull();
    expect(base14NameFor(null, undefined, undefined)).toBeNull();
    expect(base14NameFor('', undefined, undefined)).toBeNull();
  });

  it('excludes OCR/Pitch Courier variants (specialised bundled CourierPrime)', () => {
    expect(base14NameFor('OCR-B', 'normal', 'normal')).toBeNull();
    expect(base14NameFor('CourierOCR', 'normal', 'normal')).toBeNull();
  });
});
