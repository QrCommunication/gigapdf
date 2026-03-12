import { describe, it, expect } from 'vitest';
import {
  POINTS_PER_INCH,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_PAGE_HEIGHT,
  A4_PAGE_WIDTH,
  A4_PAGE_HEIGHT,
  MAX_PREVIEW_DPI,
  DEFAULT_PREVIEW_DPI,
  DEFAULT_THUMBNAIL_WIDTH,
  DEFAULT_THUMBNAIL_HEIGHT,
  DEFAULT_JPEG_QUALITY,
  MAX_FILE_SIZE,
  CLEANUP_INTERVAL_MS,
  DEFAULT_SESSION_TIMEOUT_MS,
} from '../src/constants';

describe('PDF unit constants', () => {
  describe('POINTS_PER_INCH', () => {
    it('equals 72 (standard PDF points per inch)', () => {
      expect(POINTS_PER_INCH).toBe(72);
    });

    it('is a positive integer', () => {
      expect(POINTS_PER_INCH).toBeGreaterThan(0);
      expect(Number.isInteger(POINTS_PER_INCH)).toBe(true);
    });
  });
});

describe('US Letter page dimensions', () => {
  describe('DEFAULT_PAGE_WIDTH', () => {
    it('equals 612 points (8.5 inches × 72 dpi)', () => {
      expect(DEFAULT_PAGE_WIDTH).toBe(612);
    });

    it('equals 8.5 inches when divided by POINTS_PER_INCH', () => {
      expect(DEFAULT_PAGE_WIDTH / POINTS_PER_INCH).toBeCloseTo(8.5, 5);
    });
  });

  describe('DEFAULT_PAGE_HEIGHT', () => {
    it('equals 792 points (11 inches × 72 dpi)', () => {
      expect(DEFAULT_PAGE_HEIGHT).toBe(792);
    });

    it('equals 11 inches when divided by POINTS_PER_INCH', () => {
      expect(DEFAULT_PAGE_HEIGHT / POINTS_PER_INCH).toBeCloseTo(11, 5);
    });
  });

  it('page is taller than it is wide (portrait orientation)', () => {
    expect(DEFAULT_PAGE_HEIGHT).toBeGreaterThan(DEFAULT_PAGE_WIDTH);
  });
});

describe('A4 page dimensions', () => {
  describe('A4_PAGE_WIDTH', () => {
    it('equals 595.28 points', () => {
      expect(A4_PAGE_WIDTH).toBeCloseTo(595.28, 2);
    });

    it('corresponds to approximately 210 mm (ISO 216)', () => {
      // 1 inch = 25.4 mm, so 210 mm = 210/25.4 inches = 8.268... inches = 595.28 pts
      const expectedPoints = (210 / 25.4) * POINTS_PER_INCH;
      expect(A4_PAGE_WIDTH).toBeCloseTo(expectedPoints, 1);
    });
  });

  describe('A4_PAGE_HEIGHT', () => {
    it('equals 841.89 points', () => {
      expect(A4_PAGE_HEIGHT).toBeCloseTo(841.89, 2);
    });

    it('corresponds to approximately 297 mm (ISO 216)', () => {
      // 297 mm = 297/25.4 inches = 11.693... inches = 841.89 pts
      const expectedPoints = (297 / 25.4) * POINTS_PER_INCH;
      expect(A4_PAGE_HEIGHT).toBeCloseTo(expectedPoints, 1);
    });
  });

  it('A4 page is taller than it is wide (portrait orientation)', () => {
    expect(A4_PAGE_HEIGHT).toBeGreaterThan(A4_PAGE_WIDTH);
  });

  it('A4 page is smaller than US Letter in width', () => {
    expect(A4_PAGE_WIDTH).toBeLessThan(DEFAULT_PAGE_WIDTH);
  });

  it('A4 page is taller than US Letter', () => {
    expect(A4_PAGE_HEIGHT).toBeGreaterThan(DEFAULT_PAGE_HEIGHT);
  });
});

describe('Preview DPI constants', () => {
  describe('MAX_PREVIEW_DPI', () => {
    it('equals 300', () => {
      expect(MAX_PREVIEW_DPI).toBe(300);
    });

    it('is a positive integer', () => {
      expect(MAX_PREVIEW_DPI).toBeGreaterThan(0);
      expect(Number.isInteger(MAX_PREVIEW_DPI)).toBe(true);
    });
  });

  describe('DEFAULT_PREVIEW_DPI', () => {
    it('equals 150', () => {
      expect(DEFAULT_PREVIEW_DPI).toBe(150);
    });

    it('is a positive integer', () => {
      expect(DEFAULT_PREVIEW_DPI).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_PREVIEW_DPI)).toBe(true);
    });
  });

  it('DEFAULT_PREVIEW_DPI is less than or equal to MAX_PREVIEW_DPI', () => {
    expect(DEFAULT_PREVIEW_DPI).toBeLessThanOrEqual(MAX_PREVIEW_DPI);
  });
});

describe('Thumbnail constants', () => {
  describe('DEFAULT_THUMBNAIL_WIDTH', () => {
    it('equals 200', () => {
      expect(DEFAULT_THUMBNAIL_WIDTH).toBe(200);
    });

    it('is a positive integer', () => {
      expect(DEFAULT_THUMBNAIL_WIDTH).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_THUMBNAIL_WIDTH)).toBe(true);
    });
  });

  describe('DEFAULT_THUMBNAIL_HEIGHT', () => {
    it('equals 300', () => {
      expect(DEFAULT_THUMBNAIL_HEIGHT).toBe(300);
    });

    it('is a positive integer', () => {
      expect(DEFAULT_THUMBNAIL_HEIGHT).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_THUMBNAIL_HEIGHT)).toBe(true);
    });
  });

  it('thumbnail height is greater than thumbnail width (portrait aspect)', () => {
    expect(DEFAULT_THUMBNAIL_HEIGHT).toBeGreaterThan(DEFAULT_THUMBNAIL_WIDTH);
  });
});

describe('DEFAULT_JPEG_QUALITY', () => {
  it('equals 85', () => {
    expect(DEFAULT_JPEG_QUALITY).toBe(85);
  });

  it('is within the valid JPEG quality range [0, 100]', () => {
    expect(DEFAULT_JPEG_QUALITY).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_JPEG_QUALITY).toBeLessThanOrEqual(100);
  });
});

describe('MAX_FILE_SIZE', () => {
  it('equals 100 MB in bytes (100 * 1024 * 1024)', () => {
    expect(MAX_FILE_SIZE).toBe(100 * 1024 * 1024);
  });

  it('equals 104857600 bytes', () => {
    expect(MAX_FILE_SIZE).toBe(104_857_600);
  });

  it('is a positive integer', () => {
    expect(MAX_FILE_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_FILE_SIZE)).toBe(true);
  });
});

describe('Session timing constants', () => {
  describe('CLEANUP_INTERVAL_MS', () => {
    it('equals 60000 ms (60 seconds)', () => {
      expect(CLEANUP_INTERVAL_MS).toBe(60_000);
    });

    it('equals exactly 60 seconds when converted', () => {
      expect(CLEANUP_INTERVAL_MS / 1000).toBe(60);
    });
  });

  describe('DEFAULT_SESSION_TIMEOUT_MS', () => {
    it('equals 1800000 ms (30 minutes)', () => {
      expect(DEFAULT_SESSION_TIMEOUT_MS).toBe(30 * 60 * 1000);
    });

    it('equals exactly 30 minutes when converted to minutes', () => {
      expect(DEFAULT_SESSION_TIMEOUT_MS / 60_000).toBe(30);
    });
  });

  it('session timeout is greater than cleanup interval', () => {
    expect(DEFAULT_SESSION_TIMEOUT_MS).toBeGreaterThan(CLEANUP_INTERVAL_MS);
  });
});
