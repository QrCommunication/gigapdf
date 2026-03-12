import { PDFDocument } from 'pdf-lib';
import { PDFParseError, PDFPageOutOfRangeError } from '../errors';
import type { PageRange } from '../utils/page-range';

async function loadSource(buffer: Buffer): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (err) {
    throw new PDFParseError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function splitPDF(buffer: Buffer, ranges: PageRange[]): Promise<Buffer[]> {
  const sourceDoc = await loadSource(buffer);
  const pageCount = sourceDoc.getPageCount();

  for (const range of ranges) {
    if (range.start < 1) {
      throw new PDFPageOutOfRangeError(range.start, pageCount);
    }
    if (range.end > pageCount) {
      throw new PDFPageOutOfRangeError(range.end, pageCount);
    }
    if (range.start > range.end) {
      throw new PDFParseError(
        `Invalid range: start (${range.start}) must be less than or equal to end (${range.end})`,
      );
    }
  }

  const results: Buffer[] = [];

  for (const range of ranges) {
    const doc = await PDFDocument.create();
    const pageIndices: number[] = [];
    for (let p = range.start - 1; p <= range.end - 1; p++) {
      pageIndices.push(p);
    }
    const copiedPages = await doc.copyPages(sourceDoc, pageIndices);
    for (const copiedPage of copiedPages) {
      doc.addPage(copiedPage);
    }
    const bytes = await doc.save({ useObjectStreams: true });
    results.push(Buffer.from(bytes));
  }

  return results;
}

export async function splitAt(buffer: Buffer, splitPoints: number[]): Promise<Buffer[]> {
  const sourceDoc = await loadSource(buffer);
  const pageCount = sourceDoc.getPageCount();

  const sorted = [...new Set(splitPoints)].sort((a, b) => a - b);

  const ranges: PageRange[] = [];

  if (sorted.length === 0) {
    ranges.push({ start: 1, end: pageCount });
  } else {
    ranges.push({ start: 1, end: sorted[0]! });
    for (let i = 1; i < sorted.length; i++) {
      ranges.push({ start: sorted[i - 1]! + 1, end: sorted[i]! });
    }
    ranges.push({ start: sorted[sorted.length - 1]! + 1, end: pageCount });
  }

  return splitPDF(buffer, ranges);
}
