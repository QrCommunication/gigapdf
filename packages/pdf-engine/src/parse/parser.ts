import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type { DocumentObject, DocumentMetadata, BookmarkObject, PageObject } from '@giga-pdf/types';
import { PDFParseError, PDFPageOutOfRangeError } from '../errors';
import {
  extractMetadata,
  extractLayers,
  extractEmbeddedFiles,
  extractNamedDestinations,
} from './metadata-extractor';
import { extractTextElements } from './text-extractor';
import { extractImageElements } from './image-extractor';
import { extractDrawingElements } from './drawing-extractor';
import { extractAnnotationElements } from './annotation-extractor';
import { extractFormFieldElements } from './form-extractor';
import { extractBookmarks } from './bookmark-extractor';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
}

export interface ParseOptions {
  extractText?: boolean;
  extractImages?: boolean;
  extractDrawings?: boolean;
  extractAnnotations?: boolean;
  extractFormFields?: boolean;
  extractBookmarks?: boolean;
  baseUrl?: string | null;
  documentId?: string;
  pages?: number[];
}

export interface ParsePageOptions {
  extractText?: boolean;
  extractImages?: boolean;
  extractDrawings?: boolean;
  extractAnnotations?: boolean;
  extractFormFields?: boolean;
  baseUrl?: string | null;
  documentId?: string;
}

async function loadPdfjsDocument(buffer: Buffer): Promise<PDFDocumentProxy> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
  try {
    return await loadingTask.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PDFParseError(`Failed to parse PDF: ${message}`);
  }
}

async function buildPageObject(
  doc: PDFDocumentProxy,
  pageNumber: number,
  options: ParsePageOptions,
): Promise<PageObject> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;

  const [textElements, imageElements, drawingElements, annotationElements, formFieldElements] =
    await Promise.all([
      options.extractText !== false
        ? extractTextElements(page, pageNumber, pageHeight)
        : Promise.resolve([]),
      options.extractImages !== false
        ? extractImageElements(page, pageNumber, pageHeight, options.baseUrl, options.documentId)
        : Promise.resolve([]),
      options.extractDrawings !== false
        ? extractDrawingElements(page, pageNumber, pageHeight)
        : Promise.resolve([]),
      options.extractAnnotations !== false
        ? extractAnnotationElements(page, pageNumber, pageHeight)
        : Promise.resolve([]),
      options.extractFormFields !== false
        ? extractFormFieldElements(page, pageNumber, pageHeight)
        : Promise.resolve([]),
    ]);

  const elements = [
    ...textElements,
    ...imageElements,
    ...drawingElements,
    ...annotationElements,
    ...formFieldElements,
  ];

  const view = page.view as number[];
  const mediaBox = {
    x: view[0] ?? 0,
    y: view[1] ?? 0,
    width: view[2] ?? pageWidth,
    height: view[3] ?? pageHeight,
  };

  const rotation = (page.rotate ?? 0) as 0 | 90 | 180 | 270;

  return {
    pageId: randomUUID(),
    pageNumber,
    dimensions: { width: pageWidth, height: pageHeight, rotation },
    mediaBox,
    cropBox: null,
    elements,
    preview: { thumbnailUrl: null, fullUrl: null },
  };
}

export async function parseDocument(
  buffer: Buffer,
  options: ParseOptions = {},
): Promise<DocumentObject> {
  const doc = await loadPdfjsDocument(buffer);

  const [metadata, bookmarks, layers, embeddedFiles, namedDestinations] = await Promise.all([
    extractMetadata(doc),
    options.extractBookmarks !== false ? extractBookmarks(doc) : Promise.resolve([]),
    extractLayers(doc),
    extractEmbeddedFiles(doc),
    extractNamedDestinations(doc),
  ]);

  const pageNumbers =
    options.pages && options.pages.length > 0
      ? options.pages
      : Array.from({ length: doc.numPages }, (_, i) => i + 1);

  for (const pageNum of pageNumbers) {
    if (pageNum < 1 || pageNum > doc.numPages) {
      throw new PDFPageOutOfRangeError(pageNum, doc.numPages);
    }
  }

  const pageObjects = await Promise.all(
    pageNumbers.map((pageNum) => buildPageObject(doc, pageNum, options)),
  );

  return {
    documentId: options.documentId ?? randomUUID(),
    metadata,
    pages: pageObjects,
    outlines: bookmarks,
    namedDestinations,
    embeddedFiles,
    layers,
  };
}

export async function parsePage(
  buffer: Buffer,
  pageNumber: number,
  options: ParsePageOptions = {},
): Promise<PageObject> {
  const doc = await loadPdfjsDocument(buffer);

  if (pageNumber < 1 || pageNumber > doc.numPages) {
    throw new PDFPageOutOfRangeError(pageNumber, doc.numPages);
  }

  return buildPageObject(doc, pageNumber, options);
}

export async function parseMetadata(buffer: Buffer): Promise<DocumentMetadata> {
  const doc = await loadPdfjsDocument(buffer);
  return extractMetadata(doc);
}

export async function parseBookmarks(buffer: Buffer): Promise<BookmarkObject[]> {
  const doc = await loadPdfjsDocument(buffer);
  return extractBookmarks(doc);
}
