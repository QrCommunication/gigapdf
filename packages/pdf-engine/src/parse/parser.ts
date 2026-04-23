import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRequire } from 'node:module';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type { DocumentObject, DocumentMetadata, BookmarkObject, PageObject } from '@giga-pdf/types';
import { PDFParseError, PDFPageOutOfRangeError } from '../errors';
import { engineLogger } from '../utils/logger';
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

// Configure pdfjs worker source for Node.js runtime. pdfjs-dist 5.x dynamic-imports
// the worker module via `await import(workerSrc)`. We try multiple resolution
// strategies since bundlers (Turbopack/webpack) may make import.meta.url
// virtual and break createRequire.
//
// We force-set (not conditional) to override any earlier `workerSrc = ''`
// initialization from other extractor modules imported before parser.ts.
(() => {
  // Strategy 1: bare specifier — works when pdfjs-dist is external (Node resolves)
  const bareSpec = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

  // Strategy 2: createRequire from import.meta.url — works in pure ESM Node runtime
  try {
    const requireFn = createRequire(import.meta.url);
    const absPath = requireFn.resolve(bareSpec);
    pdfjsLib.GlobalWorkerOptions.workerSrc = absPath.startsWith('file://')
      ? absPath
      : `file://${absPath}`;
    return;
  } catch {
    // fall through
  }

  // Strategy 3: createRequire from process.cwd() — works when import.meta.url is bundler-virtual
  try {
    const requireFn = createRequire(`${process.cwd()}/package.json`);
    const absPath = requireFn.resolve(bareSpec);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${absPath}`;
    return;
  } catch {
    // fall through
  }

  // Strategy 4: bare specifier — Node.js ESM import() resolves via node_modules
  pdfjsLib.GlobalWorkerOptions.workerSrc = bareSpec;
})();

/** Timeout in milliseconds applied to each individual extractor. */
const EXTRACTOR_TIMEOUT_MS = 5_000;

export interface ParseOptions {
  /** Extract text blocks with positions and fonts. Default: true */
  extractText?: boolean;
  /** Extract embedded images with bounds and format info. Default: true */
  extractImages?: boolean;
  /** Extract vector drawings and shapes. Default: true */
  extractDrawings?: boolean;
  /** Extract annotations (highlights, notes, links). Default: true */
  extractAnnotations?: boolean;
  /**
   * Extract AcroForm fields.
   * Alias kept for backward-compatibility: also accepted as `extractFormFields`.
   * Default: true
   */
  extractForms?: boolean;
  /** @deprecated Use `extractForms` instead. Kept for backward-compatibility. */
  extractFormFields?: boolean;
  /** Extract bookmark outlines (TOC). Default: true */
  extractBookmarks?: boolean;
  /** Generate page thumbnails. Default: false */
  includeThumbnails?: boolean;
  /** Scale factor used when generating thumbnails (0 < scale ≤ 1). Default: 0.2 */
  thumbnailScale?: number;
  /** Maximum number of pages to process. Default: 500 */
  maxPages?: number;
  /** Base URL used to build image src URLs. */
  baseUrl?: string | null;
  /** Document ID forwarded to image URLs. */
  documentId?: string;
  /** Explicit list of page numbers to parse (1-based). Overrides maxPages. */
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Race a promise against a timeout.  If the timeout fires first the promise
 * rejects with a TimeoutError so the caller can apply graceful-degradation.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Extractor timed out after ${ms}ms: ${label}`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Run an extractor with a timeout and return an empty array on failure so that
 * a single broken extractor never blocks the whole parse pipeline.
 */
async function safeExtract<T>(
  label: string,
  fn: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await withTimeout(fn(), EXTRACTOR_TIMEOUT_MS, label);
  } catch (error) {
    engineLogger.warn(`[parser] extractor "${label}" failed — continuing without it`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Resolve the effective boolean flag for form-field extraction.
 * Accepts both the new `extractForms` and the legacy `extractFormFields` names.
 */
function shouldExtractForms(options: ParseOptions): boolean {
  if (options.extractForms !== undefined) return options.extractForms !== false;
  if (options.extractFormFields !== undefined) return options.extractFormFields !== false;
  return true;
}

function toUint8Array(input: Buffer | ArrayBuffer | Uint8Array): Uint8Array {
  if (Buffer.isBuffer(input)) {
    // Buffer extends Uint8Array — share the underlying ArrayBuffer slice
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  // Plain ArrayBuffer
  return new Uint8Array(input as ArrayBuffer);
}

/**
 * Ensure pdfjs workerSrc points to a resolvable file path.
 * Called lazily before each getDocument() to survive bundler code transformations
 * (Turbopack replaces require.resolve() with module IDs at static top-level,
 * breaking the top-level IIFE approach).
 */
function ensureWorkerSrc(): void {
  const current = pdfjsLib.GlobalWorkerOptions.workerSrc;
  // Already set to an absolute file:// URL — nothing to do
  if (typeof current === 'string' && current.startsWith('file://')) return;

  try {
    // Runtime strategy: createRequire from process.cwd() — the only strategy that
    // survives Turbopack/webpack bundling because the resolve() call uses a
    // runtime-dynamic string (not a literal that bundlers can statically rewrite).
    const requireFn = createRequire(`${process.cwd()}/package.json`);
    const spec = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
    const absPath = requireFn.resolve(spec);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${absPath}`;
  } catch {
    // If resolution fails, leave as-is — pdfjs fakeWorker fallback may work
  }
}

async function loadPdfjsDocument(
  input: Buffer | ArrayBuffer | Uint8Array,
): Promise<PDFDocumentProxy> {
  ensureWorkerSrc();
  const data = toUint8Array(input);
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableWorker: true,
    isEvalSupported: false,
    verbosity: 0,
  } as Parameters<typeof pdfjsLib.getDocument>[0]);
  try {
    return await loadingTask.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PDFParseError(`Failed to parse PDF: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Page-level orchestration
// ---------------------------------------------------------------------------

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

/**
 * Build a page object with per-extractor graceful degradation and timeouts.
 *
 * Extraction order (all run in parallel via Promise.all):
 *   1. text        — text blocks with positions and fonts
 *   2. images      — embedded raster images
 *   3. drawings    — vector shapes and paths
 *   4. annotations — highlights, notes, links
 *   5. forms       — AcroForm widget fields
 *
 * If any individual extractor throws or times out (5 s), its result is
 * replaced by an empty array and a warning is logged.  The other extractors
 * continue unaffected.
 */
async function buildPageObjectSafe(
  doc: PDFDocumentProxy,
  pageNumber: number,
  options: ParseOptions,
): Promise<PageObject> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;

  const extractFormsEnabled = shouldExtractForms(options);

  // All five per-page extractors run in parallel.
  // Each is individually guarded by safeExtract (timeout + error isolation).
  const [textElements, imageElements, drawingElements, annotationElements, formFieldElements] =
    await Promise.all([
      options.extractText !== false
        ? safeExtract(`text:p${pageNumber}`, () =>
            extractTextElements(page, pageNumber, pageHeight),
          )
        : Promise.resolve([]),

      options.extractImages !== false
        ? safeExtract(`images:p${pageNumber}`, () =>
            extractImageElements(
              page,
              pageNumber,
              pageHeight,
              options.baseUrl,
              options.documentId,
            ),
          )
        : Promise.resolve([]),

      options.extractDrawings !== false
        ? safeExtract(`drawings:p${pageNumber}`, () =>
            extractDrawingElements(page, pageNumber, pageHeight),
          )
        : Promise.resolve([]),

      options.extractAnnotations !== false
        ? safeExtract(`annotations:p${pageNumber}`, () =>
            extractAnnotationElements(page, pageNumber, pageHeight),
          )
        : Promise.resolve([]),

      extractFormsEnabled
        ? safeExtract(`forms:p${pageNumber}`, () =>
            extractFormFieldElements(page, pageNumber, pageHeight),
          )
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

  // Thumbnail generation is intentionally deferred: a thumbnail URL would
  // require a rendering step (canvas/Playwright) which is handled by the
  // preview module.  We set the URL to null and let callers request previews
  // via the dedicated /preview API when `includeThumbnails` is true.
  // This keeps the parse pipeline fast and avoids a hard dependency on the
  // browser canvas in server contexts.
  const preview =
    options.includeThumbnails === true
      ? {
          thumbnailUrl: null, // populated by preview module on demand
          fullUrl: null,
          thumbnailScale: options.thumbnailScale ?? 0.2,
        }
      : { thumbnailUrl: null, fullUrl: null };

  return {
    pageId: randomUUID(),
    pageNumber,
    dimensions: { width: pageWidth, height: pageHeight, rotation },
    mediaBox,
    cropBox: null,
    elements,
    preview,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a PDF document into a complete `DocumentObject`.
 *
 * Extraction pipeline (sequential steps, parallel where safe):
 *
 * Step 1 — Open PDF via pdfjs-dist.
 * Step 2 — Extract document-level data in parallel:
 *           metadata, bookmarks (outlines), layers, embedded files,
 *           named destinations.
 * Step 3 — For each page (up to `maxPages`, or the explicit `pages` list),
 *           run all enabled per-page extractors in parallel:
 *           text → images → drawings → annotations → forms.
 *           Each extractor is individually guarded: if it throws or exceeds
 *           5 s, it returns [] and logs a warning (graceful degradation).
 * Step 4 — Assemble and return the DocumentObject.
 *
 * @param pdfBytes  - PDF content as Buffer, ArrayBuffer, or Uint8Array.
 * @param options   - Fine-grained control over what to extract.
 * @returns         Fully populated DocumentObject.
 */
export async function parseDocument(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  options: ParseOptions = {},
): Promise<DocumentObject> {
  const documentId = options.documentId ?? randomUUID();
  const startMs = Date.now();

  engineLogger.info('[parser] parseDocument — start', { documentId });

  const doc = await loadPdfjsDocument(pdfBytes);

  engineLogger.debug('[parser] PDF loaded', {
    documentId,
    numPages: doc.numPages,
  });

  // Step 2 — Document-level extractions (parallel, each with graceful fallback).
  const [metadata, bookmarks, layers, embeddedFiles, namedDestinations] = await Promise.all([
    safeExtract('metadata', async () => {
      const m = await extractMetadata(doc);
      // safeExtract expects T[], so we wrap the single object
      return [m];
    }).then((arr) => arr[0] ?? {
      title: null, author: null, subject: null, keywords: [], creator: null,
      producer: null, creationDate: null, modificationDate: null,
      pageCount: doc.numPages, pdfVersion: '1.7', isEncrypted: false,
      permissions: {
        print: true, modify: true, copy: true, annotate: true,
        fillForms: true, extract: true, assemble: true, printHighQuality: true,
      },
    }),

    options.extractBookmarks !== false
      ? safeExtract('bookmarks', () => extractBookmarks(doc))
      : Promise.resolve([]),

    safeExtract('layers', () => extractLayers(doc)),
    safeExtract('embeddedFiles', () => extractEmbeddedFiles(doc)),

    safeExtract('namedDestinations', async () => {
      const destinations = await extractNamedDestinations(doc);
      // safeExtract expects T[], wrap the record as a single-element array
      return [destinations];
    }).then((arr) => arr[0] ?? {}),
  ]);

  // Step 3 — Determine which pages to process.
  const maxPages = options.maxPages ?? 500;

  let pageNumbers: number[];
  if (options.pages && options.pages.length > 0) {
    pageNumbers = options.pages;
  } else {
    const total = Math.min(doc.numPages, maxPages);
    pageNumbers = Array.from({ length: total }, (_, i) => i + 1);
  }

  for (const pageNum of pageNumbers) {
    if (pageNum < 1 || pageNum > doc.numPages) {
      throw new PDFPageOutOfRangeError(pageNum, doc.numPages);
    }
  }

  if (doc.numPages > maxPages && !options.pages) {
    engineLogger.warn('[parser] document exceeds maxPages — truncating', {
      documentId,
      totalPages: doc.numPages,
      maxPages,
      processing: pageNumbers.length,
    });
  }

  engineLogger.debug('[parser] extracting pages', {
    documentId,
    pages: pageNumbers.length,
  });

  // Step 3 — Per-page extraction (pages run in parallel; extractors within
  // each page also run in parallel via buildPageObjectSafe).
  const pageObjects = await Promise.all(
    pageNumbers.map((pageNum) =>
      buildPageObjectSafe(doc, pageNum, { ...options, documentId }),
    ),
  );

  const elapsedMs = Date.now() - startMs;
  engineLogger.info('[parser] parseDocument — complete', {
    documentId,
    pages: pageObjects.length,
    elapsedMs,
  });

  return {
    documentId,
    metadata,
    pages: pageObjects,
    outlines: bookmarks,
    namedDestinations,
    embeddedFiles,
    layers,
  };
}

export async function parsePage(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  pageNumber: number,
  options: ParsePageOptions = {},
): Promise<PageObject> {
  const doc = await loadPdfjsDocument(buffer);

  if (pageNumber < 1 || pageNumber > doc.numPages) {
    throw new PDFPageOutOfRangeError(pageNumber, doc.numPages);
  }

  return buildPageObject(doc, pageNumber, options);
}

export async function parseMetadata(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<DocumentMetadata> {
  const doc = await loadPdfjsDocument(buffer);
  return extractMetadata(doc);
}

export async function parseBookmarks(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<BookmarkObject[]> {
  const doc = await loadPdfjsDocument(buffer);
  return extractBookmarks(doc);
}
