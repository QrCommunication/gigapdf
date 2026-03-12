import { describe, it, expect } from 'vitest';
import { hexToRgb, rgbToHex, normalizeColor } from '../../src/utils/color';

// pdf-lib's rgb() returns an object with shape { type: 'RGB', red, green, blue }
// We assert on that plain structure so tests remain decoupled from pdf-lib internals.

describe('hexToRgb', () => {
  describe('6-digit #RRGGBB format', () => {
    it('converts pure red correctly', () => {
      const result = hexToRgb('#ff0000');
      expect(result).toMatchObject({ type: 'RGB', red: 1, green: 0, blue: 0 });
    });

    it('converts pure green correctly', () => {
      const result = hexToRgb('#00ff00');
      expect(result).toMatchObject({ type: 'RGB', red: 0, green: 1, blue: 0 });
    });

    it('converts pure blue correctly', () => {
      const result = hexToRgb('#0000ff');
      expect(result).toMatchObject({ type: 'RGB', red: 0, green: 0, blue: 1 });
    });

    it('converts black #000000 to (0, 0, 0)', () => {
      const result = hexToRgb('#000000');
      expect(result).toMatchObject({ type: 'RGB', red: 0, green: 0, blue: 0 });
    });

    it('converts white #ffffff to (1, 1, 1)', () => {
      const result = hexToRgb('#ffffff');
      expect(result).toMatchObject({ type: 'RGB', red: 1, green: 1, blue: 1 });
    });

    it('converts a mid-range color #804020', () => {
      const result = hexToRgb('#804020') as { type: string; red: number; green: number; blue: number };
      expect(result.type).toBe('RGB');
      // 0x80 = 128, 128/255 ≈ 0.502
      expect(result.red).toBeCloseTo(128 / 255, 5);
      // 0x40 = 64, 64/255 ≈ 0.251
      expect(result.green).toBeCloseTo(64 / 255, 5);
      // 0x20 = 32, 32/255 ≈ 0.125
      expect(result.blue).toBeCloseTo(32 / 255, 5);
    });

    it('handles uppercase hex letters', () => {
      const lower = hexToRgb('#aabbcc') as { red: number; green: number; blue: number };
      const upper = hexToRgb('#AABBCC') as { red: number; green: number; blue: number };
      expect(upper.red).toBeCloseTo(lower.red, 10);
      expect(upper.green).toBeCloseTo(lower.green, 10);
      expect(upper.blue).toBeCloseTo(lower.blue, 10);
    });

    it('handles hex string without leading #', () => {
      // The function calls hex.replace('#', '') so a string without # also works
      const result = hexToRgb('ffffff') as { type: string; red: number; green: number; blue: number };
      expect(result.type).toBe('RGB');
      expect(result.red).toBe(1);
      expect(result.green).toBe(1);
      expect(result.blue).toBe(1);
    });
  });

  describe('3-digit #RGB shorthand format', () => {
    it('converts #fff (shorthand white) to (1, 1, 1)', () => {
      const result = hexToRgb('#fff');
      expect(result).toMatchObject({ type: 'RGB', red: 1, green: 1, blue: 1 });
    });

    it('converts #000 (shorthand black) to (0, 0, 0)', () => {
      const result = hexToRgb('#000');
      expect(result).toMatchObject({ type: 'RGB', red: 0, green: 0, blue: 0 });
    });

    it('converts #f00 (shorthand red) to (1, 0, 0)', () => {
      const result = hexToRgb('#f00');
      expect(result).toMatchObject({ type: 'RGB', red: 1, green: 0, blue: 0 });
    });

    it('converts #0f0 (shorthand green) to (0, 1, 0)', () => {
      const result = hexToRgb('#0f0');
      expect(result).toMatchObject({ type: 'RGB', red: 0, green: 1, blue: 0 });
    });

    it('converts #00f (shorthand blue) to (0, 0, 1)', () => {
      const result = hexToRgb('#00f');
      expect(result).toMatchObject({ type: 'RGB', red: 0, green: 0, blue: 1 });
    });

    it('expands shorthand digits correctly: #abc => #aabbcc', () => {
      const shorthand = hexToRgb('#abc') as { red: number; green: number; blue: number };
      const full = hexToRgb('#aabbcc') as { red: number; green: number; blue: number };
      expect(shorthand.red).toBeCloseTo(full.red, 10);
      expect(shorthand.green).toBeCloseTo(full.green, 10);
      expect(shorthand.blue).toBeCloseTo(full.blue, 10);
    });
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

  it('converts (0, 1, 0) to #00ff00', () => {
    expect(rgbToHex(0, 1, 0)).toBe('#00ff00');
  });

  it('converts (0, 0, 1) to #0000ff', () => {
    expect(rgbToHex(0, 0, 1)).toBe('#0000ff');
  });

  it('pads single hex digits with a leading zero', () => {
    // 0x08 = 8 → should produce "08", not "8"
    expect(rgbToHex(8 / 255, 0, 0)).toBe('#080000');
  });

  it('rounds fractional values correctly: 0.5 * 255 = 127.5 → 128 = 0x80', () => {
    const result = rgbToHex(0.5, 0, 0);
    expect(result).toBe('#800000');
  });

  it('roundtrips with hexToRgb: hex -> rgb -> hex', () => {
    const originalHex = '#4a7c3f';
    const color = hexToRgb(originalHex) as { red: number; green: number; blue: number };
    const resultHex = rgbToHex(color.red, color.green, color.blue);
    expect(resultHex).toBe(originalHex);
  });

  it('produces lowercase hex digits', () => {
    expect(rgbToHex(0.67, 0.33, 0.1)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('normalizeColor', () => {
  describe('null / falsy input', () => {
    it('returns undefined for null', () => {
      expect(normalizeColor(null)).toBeUndefined();
    });

    it('returns undefined for empty string (falsy)', () => {
      expect(normalizeColor('')).toBeUndefined();
    });
  });

  describe('hex string input', () => {
    it('accepts a 6-digit hex string and returns a Color', () => {
      const result = normalizeColor('#ff0000');
      expect(result).toMatchObject({ type: 'RGB', red: 1, green: 0, blue: 0 });
    });

    it('accepts a 3-digit hex string shorthand', () => {
      const result = normalizeColor('#f00');
      expect(result).toMatchObject({ type: 'RGB', red: 1, green: 0, blue: 0 });
    });

    it('accepts black hex #000000', () => {
      expect(normalizeColor('#000000')).toMatchObject({ type: 'RGB', red: 0, green: 0, blue: 0 });
    });

    it('accepts white hex #ffffff', () => {
      expect(normalizeColor('#ffffff')).toMatchObject({ type: 'RGB', red: 1, green: 1, blue: 1 });
    });
  });

  describe('[r, g, b] number array input (0-255 range)', () => {
    it('converts [255, 0, 0] to red', () => {
      const result = normalizeColor([255, 0, 0]);
      expect(result).toMatchObject({ type: 'RGB', red: 1, green: 0, blue: 0 });
    });

    it('converts [0, 255, 0] to green', () => {
      const result = normalizeColor([0, 255, 0]);
      expect(result).toMatchObject({ type: 'RGB', red: 0, green: 1, blue: 0 });
    });

    it('converts [0, 0, 255] to blue', () => {
      const result = normalizeColor([0, 0, 255]);
      expect(result).toMatchObject({ type: 'RGB', red: 0, green: 0, blue: 1 });
    });

    it('converts [0, 0, 0] to black', () => {
      const result = normalizeColor([0, 0, 0]);
      expect(result).toMatchObject({ type: 'RGB', red: 0, green: 0, blue: 0 });
    });

    it('converts [255, 255, 255] to white', () => {
      const result = normalizeColor([255, 255, 255]);
      expect(result).toMatchObject({ type: 'RGB', red: 1, green: 1, blue: 1 });
    });

    it('converts mid-range [128, 64, 32] correctly', () => {
      const result = normalizeColor([128, 64, 32]) as { red: number; green: number; blue: number };
      expect(result.red).toBeCloseTo(128 / 255, 5);
      expect(result.green).toBeCloseTo(64 / 255, 5);
      expect(result.blue).toBeCloseTo(32 / 255, 5);
    });
  });

  describe('Uint8ClampedArray input', () => {
    it('converts Uint8ClampedArray([255, 0, 0]) to red', () => {
      const result = normalizeColor(new Uint8ClampedArray([255, 0, 0]));
      expect(result).toMatchObject({ type: 'RGB', red: 1, green: 0, blue: 0 });
    });

    it('converts Uint8ClampedArray([0, 0, 0]) to black', () => {
      const result = normalizeColor(new Uint8ClampedArray([0, 0, 0]));
      expect(result).toMatchObject({ type: 'RGB', red: 0, green: 0, blue: 0 });
    });

    it('converts Uint8ClampedArray([255, 255, 255]) to white', () => {
      const result = normalizeColor(new Uint8ClampedArray([255, 255, 255]));
      expect(result).toMatchObject({ type: 'RGB', red: 1, green: 1, blue: 1 });
    });

    it('converts Uint8ClampedArray with mid-range values correctly', () => {
      const result = normalizeColor(new Uint8ClampedArray([100, 150, 200])) as {
        red: number; green: number; blue: number;
      };
      expect(result.red).toBeCloseTo(100 / 255, 5);
      expect(result.green).toBeCloseTo(150 / 255, 5);
      expect(result.blue).toBeCloseTo(200 / 255, 5);
    });
  });
});
