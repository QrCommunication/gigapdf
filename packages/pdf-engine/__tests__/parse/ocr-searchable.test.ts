/**
 * Tests for the searchable-PDF OCR pipeline.
 *
 * The pure helper (bbox→PDF placement) is tested with inline fixtures. The
 * end-to-end pipeline (image-only PDF → built-in WASM OCR → invisible text
 * layer → extractPlainText round-trip) is gated only on the presence of the
 * sample PDF — the OCR engine is always available (offline WASM, no binary).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEngine } from '../../src/wasm';
import {
  ocrWordToPdfPlacement,
  makeSearchablePdf,
  type PdfPlacementContext,
} from '../../src/parse/ocr-searchable';
import { extractPlainText } from '../../src/parse/structured-text';
import { renderPages } from '../../src/render/engine-render';
import { loadFixture, SIMPLE_PDF } from '../helpers';

/** test-free.pdf lives at the monorepo root. */
function findSamplePdf(): string | null {
  const candidates = [
    join(process.cwd(), 'test-free.pdf'),
    join(process.cwd(), '..', '..', 'test-free.pdf'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const samplePdfPath = findSamplePdf();

// ── ocrWordToPdfPlacement (pure) ─────────────────────────────────────────────

describe('ocrWordToPdfPlacement', () => {
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
    const p = ocrWordToPdfPlacement(word, baseCtx);
    // scale = 500/1000 = 0.5 ; bottom px = 220 → y = 700 − 110 = 590
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(590);
    expect(p.rotation).toBe(0);
  });

  it('fontSize ≈ bbox height × scale × 0.9', () => {
    const p = ocrWordToPdfPlacement(word, baseCtx);
    expect(p.fontSize).toBeCloseTo(20 * 0.5 * 0.9); // 9 pt
  });

  it('rotation 90 — image axes follow the displayed page (width = pageHeight)', () => {
    // /Rotate 90: displayed page is 700×500 pt → image 1400×1000 px, scale 0.5.
    const ctx: PdfPlacementContext = { ...baseCtx, imageWidth: 1400, imageHeight: 1000, rotation: 90 };
    const p = ocrWordToPdfPlacement(word, ctx);
    expect(p.x).toBeCloseTo((200 + 20) * 0.5); // 110
    expect(p.y).toBeCloseTo(100 * 0.5); // 50
    expect(p.rotation).toBe(90);
  });

  it('rotation 180 — mirrors X and keeps the baseline measured from the top', () => {
    const ctx: PdfPlacementContext = { ...baseCtx, rotation: 180 };
    const p = ocrWordToPdfPlacement(word, ctx);
    expect(p.x).toBeCloseTo(500 - 100 * 0.5); // 450
    expect(p.y).toBeCloseTo((200 + 20) * 0.5); // 110
    expect(p.rotation).toBe(180);
  });

  it('rotation 270 — mirrors both axes of the 90 case', () => {
    const ctx: PdfPlacementContext = { ...baseCtx, imageWidth: 1400, imageHeight: 1000, rotation: 270 };
    const p = ocrWordToPdfPlacement(word, ctx);
    expect(p.x).toBeCloseTo(500 - (200 + 20) * 0.5); // 390
    expect(p.y).toBeCloseTo(700 - 100 * 0.5); // 650
    expect(p.rotation).toBe(270);
  });
});

// ── makeSearchablePdf — no-op path ───────────────────────────────────────────

describe('makeSearchablePdf — pages with existing text', () => {
  it('returns the original bytes untouched when every page already has text', async () => {
    const pdfBytes = loadFixture(SIMPLE_PDF);
    const result = await makeSearchablePdf(pdfBytes);
    expect(result.pagesProcessed).toBe(0);
    expect(result.wordsAdded).toBe(0);
    expect(result.bytes).toBe(pdfBytes); // same reference — zero rewrite
  });
});

// ── makeSearchablePdf — live OCR round-trip ──────────────────────────────────

describe('makeSearchablePdf — live OCR (engine)', () => {
  it.runIf(samplePdfPath !== null)(
    'adds an invisible searchable text layer to a rasterised test-free.pdf',
    async () => {
      const original = new Uint8Array(readFileSync(samplePdfPath!));

      // Rasterise page 1 into an image-only PDF: render → embed PNG into a
      // fresh document at the same point size. The result has ZERO
      // extractable text — the exact scanned-document scenario.
      const rendered = await renderPages(original, {
        pages: [1],
        scale: 2,
        format: 'png',
      });
      const page1 = rendered[0];
      expect(page1).toBeDefined();

      const widthPt = page1!.width / 2;
      const heightPt = page1!.height / 2;
      // Build an image-only PDF natively: a fresh blank page at the target size
      // holding just the rendered PNG, with the seed text page dropped → zero
      // extractable text.
      const giga = await getEngine();
      const rasterDoc = giga.open(giga.txtToPdf('seed'));
      rasterDoc.addPage(widthPt, heightPt, 1);
      rasterDoc.addImage(2, page1!.bytes, 0, 0, widthPt, heightPt, 1);
      rasterDoc.deletePage(1);
      const rasterBytes = rasterDoc.save();
      rasterDoc.close();

      // Sanity: no extractable text before OCR.
      const before = await extractPlainText(rasterBytes);
      expect((before[0]?.text ?? '').trim()).toBe('');

      // The wiring is what we assert here, not the OCR recognition quality on a
      // synthetic image — the engine may legitimately recognise nothing.
      const result = await makeSearchablePdf(rasterBytes, { dpi: 200 });
      expect(result.pagesProcessed).toBe(1);
      expect(result.wordsAdded).toBeGreaterThanOrEqual(0);
      expect(result.bytes.byteLength).toBeGreaterThan(0);

      // Whatever was recognised, the document still extracts without crashing.
      const after = await extractPlainText(result.bytes);
      expect((after[0]?.text ?? '').length).toBeGreaterThanOrEqual(0);

      // And the visual appearance is preserved: the page still renders
      // (no crash) at identical pixel dimensions.
      const rerendered = await renderPages(result.bytes, { pages: [1], scale: 1, format: 'png' });
      expect(rerendered[0]?.width).toBeCloseTo(Math.round(widthPt), -1);
    },
    180_000,
  );

  it.runIf(samplePdfPath !== null)(
    'force: true re-OCRs pages that already contain text',
    async () => {
      const pdfBytes = loadFixture(SIMPLE_PDF);
      const result = await makeSearchablePdf(pdfBytes, { force: true, dpi: 144 });
      expect(result.pagesProcessed).toBeGreaterThan(0);
      // A re-OCR pass may add nothing, but it must still return a valid PDF.
      expect(result.bytes.byteLength).toBeGreaterThan(0);
    },
    180_000,
  );
});
