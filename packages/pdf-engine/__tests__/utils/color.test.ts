import { describe, it, expect } from 'vitest';
import { hexToPackedRgb, rgbToHex } from '../../src/utils/color';

// The engine's drawing APIs take a packed 0xRRGGBB integer, so hexToPackedRgb
// is the bridge from the editor's hex strings.

describe('hexToPackedRgb', () => {
  describe('6-digit #RRGGBB format', () => {
    it('converts pure red correctly', () => {
      expect(hexToPackedRgb('#ff0000')).toBe(0xff0000);
    });

    it('converts pure green correctly', () => {
      expect(hexToPackedRgb('#00ff00')).toBe(0x00ff00);
    });

    it('converts pure blue correctly', () => {
      expect(hexToPackedRgb('#0000ff')).toBe(0x0000ff);
    });

    it('converts black #000000 to 0', () => {
      expect(hexToPackedRgb('#000000')).toBe(0x000000);
    });

    it('converts white #ffffff to 0xffffff', () => {
      expect(hexToPackedRgb('#ffffff')).toBe(0xffffff);
    });

    it('converts a mid-range color #804020', () => {
      expect(hexToPackedRgb('#804020')).toBe(0x804020);
    });

    it('handles uppercase hex letters', () => {
      expect(hexToPackedRgb('#AABBCC')).toBe(hexToPackedRgb('#aabbcc'));
      expect(hexToPackedRgb('#AABBCC')).toBe(0xaabbcc);
    });

    it('handles hex string without leading #', () => {
      expect(hexToPackedRgb('ffffff')).toBe(0xffffff);
    });
  });

  describe('3-digit #RGB shorthand format', () => {
    it('converts #fff (shorthand white) to 0xffffff', () => {
      expect(hexToPackedRgb('#fff')).toBe(0xffffff);
    });

    it('converts #000 (shorthand black) to 0', () => {
      expect(hexToPackedRgb('#000')).toBe(0x000000);
    });

    it('converts #f00 (shorthand red) to 0xff0000', () => {
      expect(hexToPackedRgb('#f00')).toBe(0xff0000);
    });

    it('expands shorthand digits correctly: #abc => 0xaabbcc', () => {
      expect(hexToPackedRgb('#abc')).toBe(0xaabbcc);
      expect(hexToPackedRgb('#abc')).toBe(hexToPackedRgb('#aabbcc'));
    });
  });

  it('clamps malformed channels to 0 rather than throwing', () => {
    // parseInt('zz', 16) → NaN → clamps to 0; the whole value stays a number.
    expect(() => hexToPackedRgb('#zzzzzz')).not.toThrow();
    expect(hexToPackedRgb('#zzzzzz')).toBe(0x000000);
  });
});

describe('rgbToHex', () => {
  it('converts (0, 0, 0) to #000000', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });

  it('converts (1, 1, 1) to #ffffff', () => {
    expect(rgbToHex(1, 1, 1)).toBe('#ffffff');
  });

  it('converts (1, 0, 0) to #ff0000', () => {
    expect(rgbToHex(1, 0, 0)).toBe('#ff0000');
  });

  it('pads single hex digits with a leading zero', () => {
    expect(rgbToHex(8 / 255, 0, 0)).toBe('#080000');
  });

  it('rounds fractional values correctly: 0.5 * 255 = 127.5 → 128 = 0x80', () => {
    expect(rgbToHex(0.5, 0, 0)).toBe('#800000');
  });

  it('produces lowercase hex digits', () => {
    expect(rgbToHex(0.67, 0.33, 0.1)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('roundtrips with hexToPackedRgb', () => {
    const packed = hexToPackedRgb('#4a7c3f');
    const r = ((packed >> 16) & 0xff) / 255;
    const g = ((packed >> 8) & 0xff) / 255;
    const b = (packed & 0xff) / 255;
    expect(rgbToHex(r, g, b)).toBe('#4a7c3f');
  });
});
