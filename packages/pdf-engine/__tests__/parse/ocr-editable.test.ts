/**
 * Tests for the editable-OCR pipeline (mask the scan + lay real text on top).
 *
 *  - `sampleBackgroundColor` (pure) is tested with inline RGBA fixtures.
 *  - The no-op path (a PDF that already has text) is tested against a fixture.
 *  - The mask-before-text ordering and per-line mask placement are tested with a
 *    fully mocked engine, so we assert the WIRING deterministically without
 *    depending on OCR recognition quality: every line gets an `addRectangle`
 *    BEFORE the page's single `addTextLayer`, and the searchable pipeline is
 *    never touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';

// ── sampleBackgroundColor (pure) ─────────────────────────────────────────────

describe('sampleBackgroundColor', () => {
  // Build a `width×height` RGBA image with a uniform background, then optionally
  // paint a darker filled rect (the "glyphs") so we can prove the interior is
  // excluded from the sample.
  function makeImage(
    width: number,
    height: number,
    bg: [number, number, number, number],
  ): { width: number; height: number; rgba: Uint8Array } {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = bg[0];
      rgba[i * 4 + 1] = bg[1];
      rgba[i * 4 + 2] = bg[2];
      rgba[i * 4 + 3] = bg[3];
    }
    return { width, height, rgba };
  }

  function fillRect(
    img: { width: number; rgba: Uint8Array },
    rect: { left: number; top: number; width: number; height: number },
    color: [number, number, number, number],
  ): void {
    for (let py = rect.top; py < rect.top + rect.height; py++) {
      for (let px = rect.left; px < rect.left + rect.width; px++) {
        const idx = (py * img.width + px) * 4;
        img.rgba[idx] = color[0];
        img.rgba[idx + 1] = color[1];
        img.rgba[idx + 2] = color[2];
        img.rgba[idx + 3] = color[3];
      }
    }
  }

  it('returns the uniform background colour of the surrounding ring', async () => {
    const { sampleBackgroundColor } = await import('../../src/parse/ocr-editable');
    const img = makeImage(40, 40, [0xf0, 0xe0, 0xd0, 255]);
    // Paint dark "glyphs" inside the sampled rect — they must be ignored.
    fillRect(img, { left: 12, top: 12, width: 16, height: 16 }, [0x10, 0x10, 0x10, 255]);

    const color = sampleBackgroundColor(img, { left: 12, top: 12, width: 16, height: 16 });
    expect(color).toBe(0xf0e0d0);
  });

  it('ignores the rect interior (glyphs do not pollute the estimate)', async () => {
    const { sampleBackgroundColor } = await import('../../src/parse/ocr-editable');
    // Whole image is the glyph colour EXCEPT a light ring around the rect.
    const img = makeImage(40, 40, [0x00, 0x00, 0x00, 255]);
    fillRect(img, { left: 8, top: 8, width: 24, height: 24 }, [0xff, 0xff, 0xff, 255]);
    // Re-darken the interior so only the ring (rows/cols 8..11 & 28..31) is light.
    fillRect(img, { left: 12, top: 12, width: 16, height: 16 }, [0x00, 0x00, 0x00, 255]);

    const color = sampleBackgroundColor(img, { left: 12, top: 12, width: 16, height: 16 }, 2);
    expect(color).toBe(0xffffff);
  });

  it('returns null when the ring has no opaque pixels (rect flush to the edge)', async () => {
    const { sampleBackgroundColor } = await import('../../src/parse/ocr-editable');
    const img = makeImage(20, 20, [0xab, 0xcd, 0xef, 255]);
    // Rect covers the ENTIRE image → the outside ring is off-image → no samples.
    const color = sampleBackgroundColor(img, { left: 0, top: 0, width: 20, height: 20 });
    expect(color).toBeNull();
  });

  it('returns null when the surrounding ring is fully transparent', async () => {
    const { sampleBackgroundColor } = await import('../../src/parse/ocr-editable');
    const img = makeImage(40, 40, [0xff, 0xff, 0xff, 0]); // alpha 0 everywhere
    const color = sampleBackgroundColor(img, { left: 12, top: 12, width: 16, height: 16 });
    expect(color).toBeNull();
  });

  it('returns null on a malformed image (rgba shorter than width*height*4)', async () => {
    const { sampleBackgroundColor } = await import('../../src/parse/ocr-editable');
    const bad = { width: 10, height: 10, rgba: new Uint8Array(8) };
    expect(sampleBackgroundColor(bad, { left: 2, top: 2, width: 4, height: 4 })).toBeNull();
  });

  it('takes the per-channel median across a noisy ring', async () => {
    const { sampleBackgroundColor } = await import('../../src/parse/ocr-editable');
    const img = makeImage(40, 40, [100, 100, 100, 255]);
    // Inject a few outlier ring pixels; the median must stay at the background.
    fillRect(img, { left: 8, top: 8, width: 2, height: 2 }, [250, 0, 250, 255]);
    const color = sampleBackgroundColor(img, { left: 12, top: 12, width: 16, height: 16 }, 3);
    // Median per channel ≈ background (100,100,100) → 0x646464.
    expect(color).toBe(0x646464);
  });
});

// ── makeEditableOcrPdf — no-op path (real engine) ────────────────────────────

describe('makeEditableOcrPdf — pages with existing text', () => {
  it('returns the original bytes untouched when every page already has text', async () => {
    const { makeEditableOcrPdf } = await import('../../src/parse/ocr-editable');
    const pdfBytes = loadFixture(SIMPLE_PDF);
    const result = await makeEditableOcrPdf(pdfBytes);
    expect(result.pagesProcessed).toBe(0);
    expect(result.wordsAdded).toBe(0);
    expect(result.masksAdded).toBe(0);
    expect(result.bytes).toBe(pdfBytes); // same reference — zero rewrite
  });
});

// ── makeEditableOcrPdf — mask-before-text ordering (mocked engine) ────────────

describe('makeEditableOcrPdf — mask + text wiring (mocked)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('paints a background mask on each recognized line BEFORE the text layer', async () => {
    // Record the order of engine mutations so we can assert masks precede text.
    const calls: string[] = [];

    // Two words on the same line, one on a second line → two line masks.
    const words = [
      { text: 'Bonjour', x: 100, y: 100, w: 120, h: 24 },
      { text: 'monde', x: 230, y: 102, w: 90, h: 24 },
      { text: 'Seconde', x: 100, y: 160, w: 110, h: 24 },
    ];

    const addRectangle = vi.fn(() => {
      calls.push('rect');
      return true;
    });
    const addTextLayer = vi.fn((_page: number, runs: unknown[]) => {
      calls.push('text');
      return (runs as unknown[]).length;
    });

    const doc = {
      pageInfo: vi.fn(() => ({ width: 600, height: 800, rotation: 0 })),
      // A PNG placeholder feeds BOTH getOcrWords (mocked) and decodePng (mocked).
      renderPage: vi.fn(() => new Uint8Array([1, 2, 3])),
      addRectangle,
      addTextLayer,
      saveCompressed: vi.fn(() => new Uint8Array([9, 9, 9])),
      close: vi.fn(),
    };

    const engine = {
      open: vi.fn(() => doc),
      // Decoded background: uniform light grey so a non-null fill is sampled.
      decodePng: vi.fn(() => ({
        width: 1200,
        height: 1600,
        rgba: new Uint8Array(1200 * 1600 * 4).fill(0xe0),
      })),
    };

    // Recognition is host-side now: mock the main engine (`../wasm`) and the OCR
    // client (`../ocr-engine`) so neither the real WASM engine nor the OCR
    // service is touched on the dummy bytes below. `scriptTokensToOcrModel` is
    // kept real via importOriginal.
    vi.doMock('../../src/wasm', () => ({ getEngine: vi.fn(async () => engine) }));
    vi.doMock('../../src/ocr-engine', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/ocr-engine')>();
      return { ...actual, getOcrWords: vi.fn(async () => words) };
    });
    // The page has NO extractable text → it is selected for OCR.
    vi.doMock('../../src/parse/structured-text', () => ({
      extractPlainText: vi.fn(async () => [{ pageNumber: 1, text: '' }]),
    }));

    const { makeEditableOcrPdf } = await import('../../src/parse/ocr-editable');
    const result = await makeEditableOcrPdf(new Uint8Array([0]), { dpi: 144 });

    expect(result.pagesProcessed).toBe(1);
    // Two visual lines → two masks; three words written in one text layer.
    expect(result.masksAdded).toBe(2);
    expect(addRectangle).toHaveBeenCalledTimes(2);
    expect(addTextLayer).toHaveBeenCalledTimes(1);
    expect(addTextLayer.mock.calls[0]![1]).toHaveLength(3);
    expect(result.wordsAdded).toBe(3);

    // Ordering: ALL masks are painted before the text layer.
    expect(calls).toEqual(['rect', 'rect', 'text']);

    // Masks use an opaque fill (opacity arg = 1) and no stroke (null).
    for (const call of addRectangle.mock.calls) {
      const [, , , , , stroke, fill, lineWidth, opacity] = call as unknown[];
      expect(stroke).toBeNull();
      expect(typeof fill).toBe('number'); // sampled 0xRRGGBB
      expect(lineWidth).toBe(0);
      expect(opacity).toBe(1);
    }

    // The searchable pipeline must be untouched — only the editable path ran.
    expect(doc.saveCompressed).toHaveBeenCalledTimes(1);
    expect(doc.close).toHaveBeenCalledTimes(1);
  });

  it('falls back to a white mask when the page background cannot be decoded', async () => {
    const words = [{ text: 'Word', x: 50, y: 50, w: 60, h: 20 }];
    const addRectangle = vi.fn(() => true);

    const doc = {
      pageInfo: vi.fn(() => ({ width: 600, height: 800, rotation: 0 })),
      renderPage: vi.fn(() => new Uint8Array([0])),
      addRectangle,
      addTextLayer: vi.fn(() => 1),
      saveCompressed: vi.fn(() => new Uint8Array([1])),
      close: vi.fn(),
    };
    const engine = {
      open: vi.fn(() => doc),
      decodePng: vi.fn(() => null), // decode failure → white fallback
    };

    vi.doMock('../../src/wasm', () => ({ getEngine: vi.fn(async () => engine) }));
    vi.doMock('../../src/ocr-engine', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/ocr-engine')>();
      return { ...actual, getOcrWords: vi.fn(async () => words) };
    });
    vi.doMock('../../src/parse/structured-text', () => ({
      extractPlainText: vi.fn(async () => [{ pageNumber: 1, text: '' }]),
    }));

    const { makeEditableOcrPdf } = await import('../../src/parse/ocr-editable');
    const result = await makeEditableOcrPdf(new Uint8Array([0]));

    expect(result.masksAdded).toBe(1);
    const fill = (addRectangle.mock.calls[0] as unknown[])[6];
    expect(fill).toBe(0xffffff); // WHITE_RGB fallback
  });
});
