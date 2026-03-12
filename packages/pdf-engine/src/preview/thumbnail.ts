import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { PDFParseError, PDFPageOutOfRangeError } from '../errors';
import { DEFAULT_THUMBNAIL_WIDTH, DEFAULT_THUMBNAIL_HEIGHT } from '../constants';
import { renderPage, type PreviewFormat } from './renderer';

pdfjsLib.GlobalWorkerOptions.workerSrc = '';

export interface ThumbnailOptions {
  maxWidth?: number;
  maxHeight?: number;
  format?: PreviewFormat;
  quality?: number;
}

async function loadDocument(buffer: Buffer): Promise<PDFDocumentProxy> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
  return loadingTask.promise;
}

export async function renderThumbnail(
  buffer: Buffer,
  pageNumber: number,
  options?: ThumbnailOptions,
): Promise<Buffer> {
  let doc: PDFDocumentProxy | null = null;
  try {
    doc = await loadDocument(buffer);
  } catch {
    throw new PDFParseError('Failed to load PDF document');
  }

  const pageCount = doc.numPages;
  if (pageNumber < 1 || pageNumber > pageCount) {
    await doc.destroy();
    throw new PDFPageOutOfRangeError(pageNumber, pageCount);
  }

  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  await doc.destroy();

  const maxW = options?.maxWidth ?? DEFAULT_THUMBNAIL_WIDTH;
  const maxH = options?.maxHeight ?? DEFAULT_THUMBNAIL_HEIGHT;
  const scaleX = maxW / viewport.width;
  const scaleY = maxH / viewport.height;
  const scale = Math.min(scaleX, scaleY, 1);

  return renderPage(buffer, pageNumber, {
    scale,
    format: options?.format ?? 'png',
    quality: options?.quality,
  });
}

export async function renderAllThumbnails(
  buffer: Buffer,
  options?: ThumbnailOptions,
): Promise<Map<number, Buffer>> {
  let doc: PDFDocumentProxy | null = null;
  try {
    doc = await loadDocument(buffer);
  } catch {
    throw new PDFParseError('Failed to load PDF document');
  }

  const pageCount = doc.numPages;
  await doc.destroy();

  const results = new Map<number, Buffer>();
  const batchSize = 4;

  for (let i = 0; i < pageCount; i += batchSize) {
    const batch = Array.from(
      { length: Math.min(batchSize, pageCount - i) },
      (_, j) => i + j + 1,
    );
    const buffers = await Promise.all(
      batch.map(pageNum => renderThumbnail(buffer, pageNum, options)),
    );
    batch.forEach((pageNum, idx) => results.set(pageNum, buffers[idx]!));
  }

  return results;
}
