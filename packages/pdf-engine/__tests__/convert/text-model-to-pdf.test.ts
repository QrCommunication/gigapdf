/**
 * Tests for Markdown / CSV → PDF conversion via the in-house zero-dependency
 * WASM engine (`mdToModel`/`csvToModel` → `modelToPdf`).
 *
 * These run the real engine (no soffice, no network — pure WASM), so they
 * execute everywhere, unlike the LibreOffice-gated office tests.
 *
 * Test 1 — Markdown string  → PDF (magic %PDF-)
 * Test 2 — Markdown bytes   → PDF (magic %PDF-)
 * Test 3 — CSV string       → PDF (magic %PDF-)
 * Test 4 — CSV bytes        → PDF (magic %PDF-)
 * Test 5 — empty CSV        → throws PDFEngineError (no parseable fields)
 */
import { describe, it, expect } from 'vitest';
import { convertMarkdownToPdf, convertCsvToPdf } from '../../src/convert/text-model-to-pdf';
import { PDFEngineError } from '../../src/errors';

/** Assert the buffer starts with the PDF magic `%PDF-`. */
function expectPdfMagic(result: Uint8Array): void {
  expect(result).toBeInstanceOf(Uint8Array);
  expect(result.length).toBeGreaterThan(100);
  expect(Buffer.from(result.subarray(0, 5)).toString('ascii')).toBe('%PDF-');
}

const SAMPLE_MD = '# Title\n\nHello **world**.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
const SAMPLE_CSV = 'name,score\nAlice,10\nBob,20\n';

describe('convertMarkdownToPdf', () => {
  it('Test 1 — converts a Markdown string to PDF (magic %PDF-)', async () => {
    const result = await convertMarkdownToPdf(SAMPLE_MD);
    expectPdfMagic(result);
  });

  it('Test 2 — converts Markdown bytes (UTF-8) to PDF (magic %PDF-)', async () => {
    const bytes = new TextEncoder().encode(SAMPLE_MD);
    const result = await convertMarkdownToPdf(bytes);
    expectPdfMagic(result);
  });
});

describe('convertCsvToPdf', () => {
  it('Test 3 — converts a CSV string to PDF (magic %PDF-)', async () => {
    const result = await convertCsvToPdf(SAMPLE_CSV);
    expectPdfMagic(result);
  });

  it('Test 4 — converts CSV bytes (UTF-8) to PDF (magic %PDF-)', async () => {
    const bytes = new TextEncoder().encode(SAMPLE_CSV);
    const result = await convertCsvToPdf(bytes);
    expectPdfMagic(result);
  });

  it('Test 5 — empty CSV throws PDFEngineError (no parseable fields)', async () => {
    await expect(convertCsvToPdf(new Uint8Array(0))).rejects.toBeInstanceOf(PDFEngineError);
  });
});
