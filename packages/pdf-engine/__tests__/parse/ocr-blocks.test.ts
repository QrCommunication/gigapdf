/**
 * Tests for the on-demand OCR block extractor (#85).
 *
 * The pure pixel→PDF-point box helper (`ocrWordToPdfBox`) is tested with inline
 * fixtures across all four `/Rotate` values; it must agree with
 * `ocrWordToPdfPlacement` on the lower-left corner (placement returns the
 * baseline at the bottom of the box, so placement.{x,y} == box lower-left for
 * each rotation). The end-to-end engine path is covered by the live OCR tests
 * in ocr-searchable.test.ts (same engine, same geometry).
 */
import { describe, it, expect } from 'vitest';
import { ocrWordToPdfBox, pdfBoxToImageRect } from '../../src/parse/ocr-blocks';
import {
  ocrWordToPdfPlacement,
  type PdfPlacementContext,
} from '../../src/parse/ocr-searchable';

// ── ocrWordToPdfBox (pure) ───────────────────────────────────────────────────

describe('ocrWordToPdfBox', () => {
  // Portrait page 500×700 pt rendered at scale 2 → image 1000×1400 px.
  const baseCtx: PdfPlacementContext = {
    imageWidth: 1000,
    imageHeight: 1400,
    pageWidth: 500,
    pageHeight: 700,
    rotation: 0,
  };
  const word = { left: 100, top: 200, width: 80, height: 20 };

  it('rotation 0 — scales by pageWidth/imageWidth and flips Y bottom-up', () => {
    const b = ocrWordToPdfBox(word, baseCtx);
    // scale = 500/1000 = 0.5. Left 100→50, right 180→90.
    // top 200→ y 700−100=600, bottom 220→ y 700−110=590.
    expect(b.x).toBeCloseTo(50);
    expect(b.y).toBeCloseTo(590);
    expect(b.w).toBeCloseTo(40); // (180−100)*0.5
    expect(b.h).toBeCloseTo(10); // (220−200)*0.5
  });

  it('lower-left corner matches ocrWordToPdfPlacement (rotation 0)', () => {
    const b = ocrWordToPdfBox(word, baseCtx);
    const p = ocrWordToPdfPlacement(word, baseCtx);
    expect(b.x).toBeCloseTo(p.x);
    expect(b.y).toBeCloseTo(p.y);
  });

  it('always returns non-negative width and height', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const ctx: PdfPlacementContext =
        rotation === 90 || rotation === 270
          ? { ...baseCtx, imageWidth: 1400, imageHeight: 1000, rotation }
          : { ...baseCtx, rotation };
      const b = ocrWordToPdfBox(word, ctx);
      expect(b.w).toBeGreaterThanOrEqual(0);
      expect(b.h).toBeGreaterThanOrEqual(0);
    }
  });

  it('rotation 90 — axes swap (image width = pageHeight)', () => {
    // /Rotate 90: displayed page 700×500 pt → image 1400×1000 px, scale 0.5.
    // image (px,py) → user (py·s, px·s). top px 200→x 100, bottom 220→x 110;
    // left 100→y 50, right 180→y 90. AABB lower-left = (100, 50).
    const ctx: PdfPlacementContext = {
      ...baseCtx,
      imageWidth: 1400,
      imageHeight: 1000,
      rotation: 90,
    };
    const b = ocrWordToPdfBox(word, ctx);
    expect(b.x).toBeCloseTo(100);
    expect(b.y).toBeCloseTo(50);
    // After the 90° swap, box width comes from the image height span and vice versa.
    expect(b.w).toBeCloseTo(20 * 0.5); // 10
    expect(b.h).toBeCloseTo(80 * 0.5); // 40
    // placement baseline X = box's far X edge (box.x + box.w) under this rotation.
    const p = ocrWordToPdfPlacement(word, ctx);
    expect(p.x).toBeCloseTo(b.x + b.w);
  });

  it('rotation 180 — mirrors X, full box preserved', () => {
    const ctx: PdfPlacementContext = { ...baseCtx, rotation: 180 };
    const b = ocrWordToPdfBox(word, ctx);
    // Right image edge 180px → user x = 500 − 90 = 410 (min corner).
    expect(b.x).toBeCloseTo(410);
    expect(b.w).toBeCloseTo(40);
    expect(b.h).toBeCloseTo(10);
  });

  it('rotation 270 — mirrors both axes of the 90 case', () => {
    const ctx: PdfPlacementContext = {
      ...baseCtx,
      imageWidth: 1400,
      imageHeight: 1000,
      rotation: 270,
    };
    const b = ocrWordToPdfBox(word, ctx);
    expect(b.w).toBeCloseTo(10);
    expect(b.h).toBeCloseTo(40);
    expect(b.w).toBeGreaterThan(0);
    expect(b.h).toBeGreaterThan(0);
  });
});

// ── pdfBoxToImageRect (pure, inverse round-trip) ─────────────────────────────

describe('pdfBoxToImageRect', () => {
  const word = { left: 100, top: 200, width: 80, height: 20 };

  const ctxFor = (rotation: 0 | 90 | 180 | 270): PdfPlacementContext =>
    rotation === 90 || rotation === 270
      ? { imageWidth: 1400, imageHeight: 1000, pageWidth: 500, pageHeight: 700, rotation }
      : { imageWidth: 1000, imageHeight: 1400, pageWidth: 500, pageHeight: 700, rotation };

  it.each([0, 90, 180, 270] as const)(
    'inverts ocrWordToPdfBox round-trip for rotation %i',
    (rotation) => {
      const ctx = ctxFor(rotation);
      const box = ocrWordToPdfBox(word, ctx);
      const rect = pdfBoxToImageRect(box, ctx);
      // Round-trip: the recovered image rect equals the original word pixel box.
      expect(rect.left).toBeCloseTo(word.left, 4);
      expect(rect.top).toBeCloseTo(word.top, 4);
      expect(rect.width).toBeCloseTo(word.width, 4);
      expect(rect.height).toBeCloseTo(word.height, 4);
    },
  );

  it('maps a point box into pixels (rotation 0, scale 2)', () => {
    const ctx = ctxFor(0);
    // A 40×10 pt box at lower-left (50, 590) on a 500×700 page rendered to
    // 1000×1400 px → 80×20 px at (100, 200).
    const rect = pdfBoxToImageRect({ x: 50, y: 590, w: 40, h: 10 }, ctx);
    expect(rect.left).toBeCloseTo(100);
    expect(rect.top).toBeCloseTo(200);
    expect(rect.width).toBeCloseTo(80);
    expect(rect.height).toBeCloseTo(20);
  });
});
