import { describe, it, expect } from 'vitest';
import { webToPdf, pdfToWeb, scaleRect } from '../../src/utils/coordinates';

// Standard US Letter page height used across tests.
const PAGE_HEIGHT = 792;

describe('webToPdf', () => {
  describe('coordinate system conversion (top-left Y-down -> bottom-left Y-up)', () => {
    it('converts a rect positioned at the top-left corner', () => {
      // Web: x=0, y=0, width=100, height=50, pageHeight=792
      // PDF y = 792 - 0 - 50 = 742
      const result = webToPdf(0, 0, 100, 50, PAGE_HEIGHT);
      expect(result).toEqual({ x: 0, y: 742, width: 100, height: 50 });
    });

    it('preserves x, width, and height unchanged', () => {
      const result = webToPdf(30, 100, 200, 80, PAGE_HEIGHT);
      expect(result.x).toBe(30);
      expect(result.width).toBe(200);
      expect(result.height).toBe(80);
    });

    it('converts y coordinate correctly: pageHeight - y - height', () => {
      const result = webToPdf(10, 200, 150, 60, PAGE_HEIGHT);
      expect(result.y).toBe(PAGE_HEIGHT - 200 - 60); // 532
    });

    it('converts a rect at the very bottom of the web page (large y)', () => {
      // A rect whose top-left is at y = 742, height = 50 occupies the last 50 points
      // PDF y = 792 - 742 - 50 = 0
      const result = webToPdf(0, 742, 100, 50, PAGE_HEIGHT);
      expect(result.y).toBe(0);
    });

    it('handles a rect exactly at the center of the page', () => {
      // y = 371, height = 50 → PDF y = 792 - 371 - 50 = 371
      const result = webToPdf(0, 371, 100, 50, PAGE_HEIGHT);
      expect(result.y).toBe(371);
    });

    it('works with a small custom pageHeight', () => {
      const result = webToPdf(5, 10, 20, 30, 100);
      expect(result).toEqual({ x: 5, y: 60, width: 20, height: 30 });
    });

    it('works with zero-size rect (point)', () => {
      const result = webToPdf(10, 20, 0, 0, PAGE_HEIGHT);
      expect(result).toEqual({ x: 10, y: PAGE_HEIGHT - 20, width: 0, height: 0 });
    });

    it('works with fractional (sub-pixel) coordinates', () => {
      const result = webToPdf(10.5, 20.25, 50.75, 30.5, PAGE_HEIGHT);
      expect(result.y).toBeCloseTo(PAGE_HEIGHT - 20.25 - 30.5, 10);
    });
  });
});

describe('pdfToWeb', () => {
  describe('coordinate system conversion (bottom-left Y-up -> top-left Y-down)', () => {
    it('converts a rect at PDF origin (bottom-left) to web bottom of page', () => {
      // PDF: x=0, y=0, width=100, height=50
      // Web y = 792 - 0 - 50 = 742
      const result = pdfToWeb(0, 0, 100, 50, PAGE_HEIGHT);
      expect(result).toEqual({ x: 0, y: 742, width: 100, height: 50 });
    });

    it('preserves x, width, and height unchanged', () => {
      const result = pdfToWeb(30, 100, 200, 80, PAGE_HEIGHT);
      expect(result.x).toBe(30);
      expect(result.width).toBe(200);
      expect(result.height).toBe(80);
    });

    it('converts y coordinate correctly: pageHeight - y - height', () => {
      const result = pdfToWeb(10, 532, 150, 60, PAGE_HEIGHT);
      expect(result.y).toBe(PAGE_HEIGHT - 532 - 60); // 200
    });

    it('works with zero coordinates', () => {
      const result = pdfToWeb(0, 0, 0, 0, PAGE_HEIGHT);
      expect(result).toEqual({ x: 0, y: PAGE_HEIGHT, width: 0, height: 0 });
    });

    it('works with fractional coordinates', () => {
      const result = pdfToWeb(0, 532.5, 100, 59.5, PAGE_HEIGHT);
      expect(result.y).toBeCloseTo(PAGE_HEIGHT - 532.5 - 59.5, 10);
    });
  });

  describe('roundtrip: webToPdf -> pdfToWeb returns original values', () => {
    it('roundtrips a standard rect', () => {
      const x = 50;
      const y = 100;
      const width = 200;
      const height = 80;

      const pdf = webToPdf(x, y, width, height, PAGE_HEIGHT);
      const web = pdfToWeb(pdf.x, pdf.y, pdf.width, pdf.height, PAGE_HEIGHT);

      expect(web).toEqual({ x, y, width, height });
    });

    it('roundtrips a rect at the top-left corner (0, 0)', () => {
      const pdf = webToPdf(0, 0, 100, 50, PAGE_HEIGHT);
      const web = pdfToWeb(pdf.x, pdf.y, pdf.width, pdf.height, PAGE_HEIGHT);
      expect(web).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    });

    it('roundtrips a rect at the bottom of the web page', () => {
      const pdf = webToPdf(10, 742, 100, 50, PAGE_HEIGHT);
      const web = pdfToWeb(pdf.x, pdf.y, pdf.width, pdf.height, PAGE_HEIGHT);
      expect(web).toEqual({ x: 10, y: 742, width: 100, height: 50 });
    });

    it('roundtrips fractional coordinates without precision loss', () => {
      const x = 12.5;
      const y = 300.75;
      const width = 150.25;
      const height = 45.5;

      const pdf = webToPdf(x, y, width, height, PAGE_HEIGHT);
      const web = pdfToWeb(pdf.x, pdf.y, pdf.width, pdf.height, PAGE_HEIGHT);

      expect(web.x).toBeCloseTo(x, 10);
      expect(web.y).toBeCloseTo(y, 10);
      expect(web.width).toBeCloseTo(width, 10);
      expect(web.height).toBeCloseTo(height, 10);
    });

    it('roundtrips pdfToWeb -> webToPdf returns original PDF values', () => {
      const x = 50;
      const y = 300;
      const width = 200;
      const height = 100;

      const web = pdfToWeb(x, y, width, height, PAGE_HEIGHT);
      const pdf = webToPdf(web.x, web.y, web.width, web.height, PAGE_HEIGHT);

      expect(pdf).toEqual({ x, y, width, height });
    });
  });
});

describe('scaleRect', () => {
  it('scales all bounds by factor 2', () => {
    const result = scaleRect({ x: 10, y: 20, width: 100, height: 50 }, 2);
    expect(result).toEqual({ x: 20, y: 40, width: 200, height: 100 });
  });

  it('scales by factor 1 returns identical values', () => {
    const bounds = { x: 30, y: 15, width: 200, height: 80 };
    expect(scaleRect(bounds, 1)).toEqual(bounds);
  });

  it('scales by factor 0 collapses rect to origin', () => {
    const result = scaleRect({ x: 10, y: 20, width: 100, height: 50 }, 0);
    expect(result).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('scales by fractional factor 0.5', () => {
    const result = scaleRect({ x: 20, y: 40, width: 200, height: 100 }, 0.5);
    expect(result).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('scales a DPI conversion factor (1 to 1.5x resolution)', () => {
    const result = scaleRect({ x: 0, y: 0, width: 612, height: 792 }, 1.5);
    expect(result).toEqual({ x: 0, y: 0, width: 918, height: 1188 });
  });

  it('scales fractional input coordinates correctly', () => {
    const result = scaleRect({ x: 1.5, y: 2.5, width: 10.4, height: 5.6 }, 2);
    expect(result.x).toBeCloseTo(3.0, 10);
    expect(result.y).toBeCloseTo(5.0, 10);
    expect(result.width).toBeCloseTo(20.8, 10);
    expect(result.height).toBeCloseTo(11.2, 10);
  });

  it('does not mutate the original bounds object', () => {
    const bounds = { x: 10, y: 20, width: 100, height: 50 };
    scaleRect(bounds, 3);
    expect(bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });
});
