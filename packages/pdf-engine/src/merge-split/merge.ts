import { PDFDocument } from 'pdf-lib';
import { PDFParseError } from '../errors';
import type { PageRange } from '../utils/page-range';

export interface MergeOptions {
  pageRanges?: (PageRange[] | null)[];
}

export async function mergePDFs(buffers: Buffer[], options?: MergeOptions): Promise<Buffer> {
  if (buffers.length < 2) {
    throw new PDFParseError('At least 2 PDF buffers are required to merge');
  }

  const mergedDoc = await PDFDocument.create();

  for (let i = 0; i < buffers.length; i++) {
    const data = buffers[i]!;

    let sourceDoc: PDFDocument;
    try {
      sourceDoc = await PDFDocument.load(data, { ignoreEncryption: true });
    } catch (err) {
      throw new PDFParseError(
        `Failed to parse PDF at index ${i}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const pageCount = sourceDoc.getPageCount();
    const rangesForDoc = options?.pageRanges?.[i];

    let pageIndices: number[];
    if (rangesForDoc != null) {
      pageIndices = rangesForDoc.flatMap((range) => {
        const indices: number[] = [];
        for (let p = range.start - 1; p <= range.end - 1; p++) {
          indices.push(p);
        }
        return indices;
      });
    } else {
      pageIndices = Array.from({ length: pageCount }, (_, idx) => idx);
    }

    const copiedPages = await mergedDoc.copyPages(sourceDoc, pageIndices);
    for (const copiedPage of copiedPages) {
      mergedDoc.addPage(copiedPage);
    }
  }

  const bytes = await mergedDoc.save({ useObjectStreams: true });
  return Buffer.from(bytes);
}
