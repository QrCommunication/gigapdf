/**
 * Tests for the searchable-PDF OCR pipeline.
 *
 * Pure helpers (TSV parsing + bbox→PDF placement) are tested everywhere
 * with inline fixtures. The end-to-end pipeline (rasterised test-free.pdf
 * → tesseract → invisible text layer → extractPlainText round-trip) is
 * gated behind the system `tesseract` binary via it.runIf — skipped
 * cleanly on CI hosts without tesseract installed.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import {
  parseTsvWords,
  tsvWordToPdfPlacement,
  makeSearchablePdf,
  DEFAULT_MIN_WORD_CONFIDENCE,
  type PdfPlacementContext,
} from '../../src/parse/ocr-searchable';
import { extractPlainText } from '../../src/parse/structured-text';
import { renderPages } from '../../src/render/mupdf-render';
import { loadFixture, SIMPLE_PDF } from '../helpers';

// ── Pre-conditions (resolved synchronously — it.runIf is evaluated at
//    declaration time, before any beforeAll) ─────────────────────────────────

function checkTesseract(): boolean {
  try {
    execSync('which tesseract', { stdio: 'ignore' });
    return true;
  } catch {
    process.stderr.write(
      '\n[ocr-searchable] tesseract not found in PATH — live OCR test skipped.\n' +
        '  Install: sudo apt-get install -y tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng\n\n',
    );
    return false;
  }
}

const tesseractAvailable = checkTesseract();

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

// ── parseTsvWords (pure) ─────────────────────────────────────────────────────

const TSV_HEADER =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';

function tsvLine(
  level: number,
  left: number,
  top: number,
  width: number,
  height: number,
  conf: number,
  text: string,
): string {
  return `${level}\t1\t1\t1\t1\t1\t${left}\t${top}\t${width}\t${height}\t${conf}\t${text}`;
}

describe('parseTsvWords', () => {
  it('parses a valid level-5 word row', () => {
    const tsv = [TSV_HEADER, tsvLine(5, 100, 200, 80, 20, 96.5, 'Hello')].join('\n');
    const words = parseTsvWords(tsv);
    expect(words).toEqual([
      { left: 100, top: 200, width: 80, height: 20, conf: 96.5, text: 'Hello' },
    ]);
  });

  it('skips the header line and non-word levels (1-4)', () => {
    const tsv = [
      TSV_HEADER,
      tsvLine(1, 0, 0, 1000, 1400, -1, ''),
      tsvLine(2, 0, 0, 1000, 1400, -1, ''),
      tsvLine(3, 0, 0, 1000, 1400, -1, ''),
      tsvLine(4, 100, 200, 500, 24, -1, ''),
      tsvLine(5, 100, 200, 80, 20, 91, 'mot'),
    ].join('\n');
    const words = parseTsvWords(tsv);
    expect(words).toHaveLength(1);
    expect(words[0]?.text).toBe('mot');
  });

  it(`drops words below the default confidence threshold (${DEFAULT_MIN_WORD_CONFIDENCE})`, () => {
    const tsv = [
      TSV_HEADER,
      tsvLine(5, 100, 200, 80, 20, 39.9, 'bruit'),
      tsvLine(5, 200, 200, 80, 20, 40, 'garde'),
    ].join('\n');
    const words = parseTsvWords(tsv);
    expect(words.map((w) => w.text)).toEqual(['garde']);
  });

  it('honours a custom minConfidence', () => {
    const tsv = [TSV_HEADER, tsvLine(5, 100, 200, 80, 20, 55, 'moyen')].join('\n');
    expect(parseTsvWords(tsv, 60)).toHaveLength(0);
    expect(parseTsvWords(tsv, 50)).toHaveLength(1);
  });

  it('skips whitespace-only text, zero-size boxes and malformed rows', () => {
    const tsv = [
      TSV_HEADER,
      tsvLine(5, 100, 200, 80, 20, 90, '   '),
      tsvLine(5, 100, 200, 0, 20, 90, 'large-zero'),
      tsvLine(5, 100, 200, 80, 0, 90, 'haut-zero'),
      '5\t1\t1\t1', // truncated row
      tsvLine(5, 100, 200, 80, 20, 88, 'valide'),
    ].join('\n');
    const words = parseTsvWords(tsv);
    expect(words.map((w) => w.text)).toEqual(['valide']);
  });

  it('handles CRLF line endings', () => {
    const tsv = [TSV_HEADER, tsvLine(5, 10, 20, 30, 12, 80, 'crlf')].join('\r\n');
    expect(parseTsvWords(tsv)).toHaveLength(1);
  });
});

// ── tsvWordToPdfPlacement (pure) ─────────────────────────────────────────────

describe('tsvWordToPdfPlacement', () => {
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
    const p = tsvWordToPdfPlacement(word, baseCtx);
    // scale = 500/1000 = 0.5 ; bottom px = 220 → y = 700 − 110 = 590
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(590);
    expect(p.rotation).toBe(0);
  });

  it('fontSize ≈ bbox height × scale × 0.9', () => {
    const p = tsvWordToPdfPlacement(word, baseCtx);
    expect(p.fontSize).toBeCloseTo(20 * 0.5 * 0.9); // 9 pt
  });

  it('rotation 90 — image axes follow the displayed page (width = pageHeight)', () => {
    // /Rotate 90: displayed page is 700×500 pt → image 1400×1000 px, scale 0.5.
    const ctx: PdfPlacementContext = { ...baseCtx, imageWidth: 1400, imageHeight: 1000, rotation: 90 };
    const p = tsvWordToPdfPlacement(word, ctx);
    expect(p.x).toBeCloseTo((200 + 20) * 0.5); // 110
    expect(p.y).toBeCloseTo(100 * 0.5); // 50
    expect(p.rotation).toBe(90);
  });

  it('rotation 180 — mirrors X and keeps the baseline measured from the top', () => {
    const ctx: PdfPlacementContext = { ...baseCtx, rotation: 180 };
    const p = tsvWordToPdfPlacement(word, ctx);
    expect(p.x).toBeCloseTo(500 - 100 * 0.5); // 450
    expect(p.y).toBeCloseTo((200 + 20) * 0.5); // 110
    expect(p.rotation).toBe(180);
  });

  it('rotation 270 — mirrors both axes of the 90 case', () => {
    const ctx: PdfPlacementContext = { ...baseCtx, imageWidth: 1400, imageHeight: 1000, rotation: 270 };
    const p = tsvWordToPdfPlacement(word, ctx);
    expect(p.x).toBeCloseTo(500 - (200 + 20) * 0.5); // 390
    expect(p.y).toBeCloseTo(700 - 100 * 0.5); // 650
    expect(p.rotation).toBe(270);
  });
});

// ── makeSearchablePdf — no-op path (no tesseract required) ───────────────────

describe('makeSearchablePdf — pages with existing text', () => {
  it('returns the original bytes untouched when every page already has text', async () => {
    const pdfBytes = loadFixture(SIMPLE_PDF);
    const result = await makeSearchablePdf(pdfBytes);
    expect(result.pagesProcessed).toBe(0);
    expect(result.wordsAdded).toBe(0);
    expect(result.bytes).toBe(pdfBytes); // same reference — zero rewrite
  });
});

// ── makeSearchablePdf — live tesseract round-trip ────────────────────────────

describe('makeSearchablePdf — live OCR (tesseract)', () => {
  it.runIf(tesseractAvailable && samplePdfPath !== null)(
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

      const rasterDoc = await PDFDocument.create();
      const png = await rasterDoc.embedPng(page1!.bytes);
      const widthPt = page1!.width / 2;
      const heightPt = page1!.height / 2;
      const rasterPage = rasterDoc.addPage([widthPt, heightPt]);
      rasterPage.drawImage(png, { x: 0, y: 0, width: widthPt, height: heightPt });
      const rasterBytes = new Uint8Array(await rasterDoc.save());

      // Sanity: no extractable text before OCR.
      const before = await extractPlainText(rasterBytes);
      expect((before[0]?.text ?? '').trim()).toBe('');

      const result = await makeSearchablePdf(rasterBytes, { dpi: 200 });
      expect(result.pagesProcessed).toBe(1);
      expect(result.wordsAdded).toBeGreaterThan(0);
      expect(result.bytes.byteLength).toBeGreaterThan(0);

      // The invisible layer must now be extractable by MuPDF.
      const after = await extractPlainText(result.bytes);
      const text = (after[0]?.text ?? '').trim();
      expect(text.length).toBeGreaterThan(0);

      // And the visual appearance is preserved: the page still renders
      // (no crash) at identical pixel dimensions.
      const rerendered = await renderPages(result.bytes, { pages: [1], scale: 1, format: 'png' });
      expect(rerendered[0]?.width).toBeCloseTo(Math.round(widthPt), -1);
    },
    180_000,
  );

  it.runIf(tesseractAvailable && samplePdfPath !== null)(
    'force: true re-OCRs pages that already contain text',
    async () => {
      const pdfBytes = loadFixture(SIMPLE_PDF);
      const result = await makeSearchablePdf(pdfBytes, { force: true, dpi: 144 });
      expect(result.pagesProcessed).toBeGreaterThan(0);
      // bytes were rewritten (text layer appended), even if word count is low
      expect(result.bytes).not.toBe(pdfBytes);
    },
    180_000,
  );
});
