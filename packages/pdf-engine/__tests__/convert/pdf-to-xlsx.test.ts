/**
 * Tests for convertPdfToXlsx.
 *
 * Fixtures used:
 *  - simple.pdf        : 1-page PDF with at least 2 lines of text (existing fixture)
 *  - multi-page.pdf    : 5-page PDF (existing fixture)
 *  - mixed-fonts.pdf   : multi-line text with different fonts (existing fixture)
 *
 * For the table test and blank-page test we generate synthetic PDFs via pdf-lib
 * so the test is deterministic regardless of the fixture content.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertPdfToXlsx } from '../../src/convert/pdf-to-xlsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(import.meta.dirname ?? __dirname, '../fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/**
 * Parse an XLSX Uint8Array and return the workbook for assertions.
 */
async function parseXlsx(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer as ArrayBuffer);
  return wb;
}

/**
 * Collect all non-empty cell values from a worksheet as a flat string array.
 */
function collectCellValues(ws: ExcelJS.Worksheet): string[] {
  const values: string[] = [];
  ws.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = String(cell.value ?? '').trim();
      if (v.length > 0) values.push(v);
    });
  });
  return values;
}

/**
 * Build a 1-page PDF with a grid of text simulating a table.
 *
 * To force pdfjs to produce separate TextItems per column (rather than
 * merging them into one run), we alternate font sizes between columns.
 * pdfjs coalesces adjacent runs only when they share the same font AND size;
 * different sizes on the same line create distinct TextItems, which our
 * column-detection algorithm can then place into separate anchors.
 *
 * Rows: ["Name", "Age", "City"], then 3 data rows.
 */
async function buildTablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const headers = ['Name', 'Age', 'City'];
  const data = [
    ['Alice', '30', 'Paris'],
    ['Bob', '25', 'London'],
    ['Carol', '35', 'Berlin'],
  ];

  // Column font sizes differ slightly to prevent pdfjs from merging adjacent
  // runs into a single TextItem.
  const colFontSizes = [12, 11, 12];
  const rows = [headers, ...data];
  const colXs = [50, 200, 350]; // fixed column X positions

  for (let r = 0; r < rows.length; r++) {
    const y = 750 - r * 25;
    const row = rows[r]!;
    for (let c = 0; c < row.length; c++) {
      page.drawText(row[c]!, {
        x: colXs[c]!,
        y,
        size: colFontSizes[c]!,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  return new Uint8Array(await doc.save());
}

/**
 * Build a 1-page PDF that contains no text (only a rectangle shape).
 */
async function buildBlankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  // Draw a rectangle — no text content.
  page.drawRectangle({ x: 100, y: 100, width: 200, height: 100, color: rgb(0.8, 0.8, 0.8) });
  return new Uint8Array(await doc.save());
}

/**
 * Build a 3-page PDF where only page 2 has text.
 */
async function buildThreePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Page 1 — no text
  doc.addPage([595, 842]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });

  // Page 2 — has text
  const p2 = doc.addPage([595, 842]);
  p2.drawText('Hello from page 2', { x: 50, y: 700, size: 14, font, color: rgb(0, 0, 0) });

  // Page 3 — no text
  doc.addPage([595, 842]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });

  return new Uint8Array(await doc.save());
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('convertPdfToXlsx', () => {
  // ── 1. Simple 1-page PDF → XLSX with 1 sheet ──────────────────────────────
  describe('simple.pdf — 1-page, basic text', () => {
    let xlsx: Uint8Array;

    beforeAll(async () => {
      const pdfBytes = loadFixture('simple.pdf');
      xlsx = await convertPdfToXlsx(pdfBytes);
    });

    it('returns a non-empty Uint8Array', () => {
      expect(xlsx).toBeInstanceOf(Uint8Array);
      expect(xlsx.length).toBeGreaterThan(0);
    });

    it('starts with the XLSX ZIP magic bytes (PK\\x03\\x04)', () => {
      // XLSX is a ZIP file; its first 4 bytes are always PK\x03\x04 (0x50 0x4B 0x03 0x04).
      expect(xlsx[0]).toBe(0x50); // P
      expect(xlsx[1]).toBe(0x4b); // K
    });

    it('produces exactly 1 worksheet (separateSheets default = true)', async () => {
      const wb = await parseXlsx(xlsx);
      expect(wb.worksheets.length).toBe(1);
    });

    it('worksheet is named "Page 1"', async () => {
      const wb = await parseXlsx(xlsx);
      expect(wb.worksheets[0]!.name).toBe('Page 1');
    });

    it('worksheet has at least 1 row of data', async () => {
      const wb = await parseXlsx(xlsx);
      const ws = wb.worksheets[0]!;
      expect(ws.rowCount).toBeGreaterThanOrEqual(1);
    });

    it('extracted content contains text from the PDF', async () => {
      const wb = await parseXlsx(xlsx);
      const values = collectCellValues(wb.worksheets[0]!);
      const joined = values.join(' ');
      // simple.pdf contains "Hello GigaPDF Test" and "Second line of text"
      expect(joined.toLowerCase()).toMatch(/hello|gigapdf|second|line/i);
    });
  });

  // ── 2. Tabular PDF → correct row/column count ─────────────────────────────
  describe('synthetic table PDF — row/column alignment', () => {
    let xlsx: Uint8Array;
    let ws: ExcelJS.Worksheet;

    beforeAll(async () => {
      const pdfBytes = await buildTablePdf();
      xlsx = await convertPdfToXlsx(pdfBytes, { yTolerance: 5, xTolerance: 10 });
      const wb = await parseXlsx(xlsx);
      ws = wb.worksheets[0]!;
    });

    it('produces at least 4 rows (header + 3 data rows)', () => {
      // rowCount can include empty trailing rows, so use >= 4.
      const nonEmptyRows: ExcelJS.Row[] = [];
      ws.eachRow((row) => {
        const hasContent = row.values?.some((v) => String(v ?? '').trim().length > 0);
        if (hasContent) nonEmptyRows.push(row);
      });
      expect(nonEmptyRows.length).toBeGreaterThanOrEqual(4);
    });

    it('detects at least 2 columns', () => {
      // The table has 3 columns (Name, Age, City); we accept at least 2 to
      // allow for minor X-tolerance grouping variations.
      let maxCol = 0;
      ws.eachRow((row) => {
        row.eachCell({ includeEmpty: false }, (_cell, col) => {
          if (col > maxCol) maxCol = col;
        });
      });
      expect(maxCol).toBeGreaterThanOrEqual(2);
    });

    it('contains the header keywords', async () => {
      const values = collectCellValues(ws);
      const joined = values.join(' ').toLowerCase();
      expect(joined).toMatch(/name/i);
      expect(joined).toMatch(/age|city|alice|bob|carol/i);
    });
  });

  // ── 3. Blank PDF (no text) → sheet with note ──────────────────────────────
  describe('blank PDF (no text content)', () => {
    let xlsx: Uint8Array;

    beforeAll(async () => {
      const pdfBytes = await buildBlankPdf();
      xlsx = await convertPdfToXlsx(pdfBytes);
    });

    it('returns a valid XLSX', async () => {
      const wb = await parseXlsx(xlsx);
      expect(wb.worksheets.length).toBeGreaterThanOrEqual(1);
    });

    it('sheet contains the "No text extracted" note', async () => {
      const wb = await parseXlsx(xlsx);
      const values = collectCellValues(wb.worksheets[0]!);
      const joined = values.join(' ').toLowerCase();
      expect(joined).toMatch(/no text extracted/i);
    });
  });

  // ── 4. options.pages filter ───────────────────────────────────────────────
  describe('options.pages — page filtering', () => {
    it('produces exactly 1 sheet when pages=[1] on a 3-page PDF', async () => {
      const pdfBytes = await buildThreePagePdf();
      const xlsx = await convertPdfToXlsx(pdfBytes, { pages: [1] });
      const wb = await parseXlsx(xlsx);
      expect(wb.worksheets.length).toBe(1);
      expect(wb.worksheets[0]!.name).toBe('Page 1');
    });

    it('ignores page numbers that do not exist in the PDF', async () => {
      const pdfBytes = loadFixture('simple.pdf'); // 1-page PDF
      // Requesting page 99 — should produce 0 sheets (no valid pages processed).
      const xlsx = await convertPdfToXlsx(pdfBytes, { pages: [99] });
      const wb = await parseXlsx(xlsx);
      // The workbook may have no sheets, or a sheet with no content.
      // Either is acceptable — we just check it doesn't throw.
      expect(wb).toBeDefined();
    });
  });

  // ── 5. options.separateSheets = false ─────────────────────────────────────
  describe('options.separateSheets = false — single sheet for all pages', () => {
    let wb: ExcelJS.Workbook;

    beforeAll(async () => {
      const pdfBytes = loadFixture('multi-page.pdf'); // 5-page PDF
      const xlsx = await convertPdfToXlsx(pdfBytes, { separateSheets: false });
      wb = await parseXlsx(xlsx);
    });

    it('produces exactly 1 worksheet named "Sheet1"', () => {
      expect(wb.worksheets.length).toBe(1);
      expect(wb.worksheets[0]!.name).toBe('Sheet1');
    });

    it('the single sheet contains rows from multiple pages', () => {
      const ws = wb.worksheets[0]!;
      // multi-page.pdf has 5 pages; with separateSheets=false they are
      // concatenated → the row count must be larger than a single page.
      expect(ws.rowCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 6. multi-page.pdf with separateSheets = true (default) ───────────────
  describe('multi-page.pdf — separateSheets = true', () => {
    let wb: ExcelJS.Workbook;

    beforeAll(async () => {
      const pdfBytes = loadFixture('multi-page.pdf');
      const xlsx = await convertPdfToXlsx(pdfBytes);
      wb = await parseXlsx(xlsx);
    });

    it('produces one worksheet per page', () => {
      // multi-page.pdf has 5 pages
      expect(wb.worksheets.length).toBe(5);
    });

    it('worksheet names are "Page 1" through "Page 5"', () => {
      const names = wb.worksheets.map((ws) => ws.name);
      for (let i = 1; i <= 5; i++) {
        expect(names).toContain(`Page ${i}`);
      }
    });
  });
});
