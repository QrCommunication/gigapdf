import { PDFDocument, PDFRef } from 'pdf-lib';
import { PDFParseError } from '../errors';
import type { PageRange } from '../utils/page-range';
import { extractOutlines, buildOutlines, type OutlineItem } from '../utils/outlines';

export interface MergeOptions {
  pageRanges?: (PageRange[] | null)[];
}

function updateOutlineRefs(items: OutlineItem[], srcObjNumToCopiedRef: Map<number, PDFRef>): void {
  for (const item of items) {
    if (item.targetPageObjNum !== undefined) {
      const newRef = srcObjNumToCopiedRef.get(item.targetPageObjNum);
      if (newRef) {
        item.targetPageRef = newRef;
      }
    }
    updateOutlineRefs(item.children, srcObjNumToCopiedRef);
  }
}

export async function mergePDFs(buffers: Buffer[], options?: MergeOptions): Promise<Buffer> {
  if (buffers.length < 2) {
    throw new PDFParseError('At least 2 PDF buffers are required to merge');
  }

  const mergedDoc = await PDFDocument.create();
  const globalOutlines: OutlineItem[] = [];

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

    const sourceOutlines = extractOutlines(sourceDoc);
    const srcObjNumToCopiedRef = new Map<number, PDFRef>();

    const copiedPages = await mergedDoc.copyPages(sourceDoc, pageIndices);
    
    for (let p = 0; p < copiedPages.length; p++) {
      const copiedPage = copiedPages[p]!;
      mergedDoc.addPage(copiedPage);
      
      const srcPage = sourceDoc.getPage(pageIndices[p]!);
      const srcRef = sourceDoc.context.getObjectRef(srcPage.node);
      const newRef = mergedDoc.context.getObjectRef(copiedPage.node);
      
      if (srcRef && newRef) {
        srcObjNumToCopiedRef.set(srcRef.objectNumber, newRef);
      }
    }

    if (sourceOutlines.length > 0) {
      updateOutlineRefs(sourceOutlines, srcObjNumToCopiedRef);
      // Optional: Add a top-level bookmark for the document file to keep things organized
      // For now, just concatenate them sequentially
      globalOutlines.push(...sourceOutlines);
    }
  }

  if (globalOutlines.length > 0) {
    buildOutlines(mergedDoc, globalOutlines);
  }

  const bytes = await mergedDoc.save({ useObjectStreams: true });
  return Buffer.from(bytes);
}
