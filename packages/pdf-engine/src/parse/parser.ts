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
import { extractTextElementsByPage } from './text-extractor';
import type { TextElement } from '@giga-pdf/types';
import { extractImageElementsByPage } from './image-extractor';
import type { ImageElement } from '@giga-pdf/types';
import { extractDrawingElementsByPage } from './drawing-extractor';
import type { ShapeElement } from '@giga-pdf/types';
import { extractAnnotationElementsByPage } from './annotation-extractor';
import type { AnnotationElement } from '@giga-pdf/types';
import { extractFormFieldsByPage } from './form-extractor';
import type { FormFieldElement } from '@giga-pdf/types';
import { extractBookmarks } from './bookmark-extractor';
import { getEngine } from '../wasm';

/** A page's coordinate frame, read from the native engine (no pdfjs). */
interface PageGeometry {
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  mediaBox: { x: number; y: number; width: number; height: number };
}

/**
 * Read every page's geometry (size, rotation, raw MediaBox) from the native
 * engine in one document open. Replaces the pdfjs `getViewport` / `page.view` /
 * `page.rotate` reads the parser used to do per page.
 */
async function extractPageGeometry(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<{ pageCount: number; geometryByPage: Map<number, PageGeometry> }> {
  const giga = await getEngine();
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  let doc: ReturnType<typeof giga.open>;
  try {
    doc = giga.open(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PDFParseError(`Failed to parse PDF: ${message}`);
  }
  const geometryByPage = new Map<number, PageGeometry>();
  let pageCount = 0;
  try {
    pageCount = doc.pageCount();
    for (let p = 1; p <= pageCount; p++) {
      const info = doc.pageInfo(p);
      const mb = info.mediaBox;
      geometryByPage.set(p, {
        width: info.width,
        height: info.height,
        rotation: (((info.rotation % 360) + 360) % 360) as 0 | 90 | 180 | 270,
        mediaBox: { x: mb[0], y: mb[1], width: mb[2], height: mb[3] },
      });
    }
  } finally {
    doc.close();
  }
  return { pageCount, geometryByPage };
}

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

// ---------------------------------------------------------------------------
// Page-level orchestration
// ---------------------------------------------------------------------------

async function buildPageObject(
  geometry: PageGeometry,
  pageNumber: number,
  options: ParsePageOptions,
  formsByPage: Map<number, FormFieldElement[]> = new Map(),
  imagesByPage: Map<number, ImageElement[]> = new Map(),
  annotationsByPage: Map<number, AnnotationElement[]> = new Map(),
  drawingsByPage: Map<number, ShapeElement[]> = new Map(),
  textsByPage: Map<number, TextElement[]> = new Map(),
): Promise<PageObject> {
  const { width: pageWidth, height: pageHeight, rotation, mediaBox } = geometry;

  const [textElements, imageElements, drawingElements, annotationElements, formFieldElements] =
    await Promise.all([
      options.extractText !== false
        ? Promise.resolve(textsByPage.get(pageNumber) ?? [])
        : Promise.resolve([]),
      options.extractImages !== false
        ? Promise.resolve(imagesByPage.get(pageNumber) ?? [])
        : Promise.resolve([]),
      options.extractDrawings !== false
        ? Promise.resolve(drawingsByPage.get(pageNumber) ?? [])
        : Promise.resolve([]),
      options.extractAnnotations !== false
        ? Promise.resolve(annotationsByPage.get(pageNumber) ?? [])
        : Promise.resolve([]),
      options.extractFormFields !== false
        ? Promise.resolve(formsByPage.get(pageNumber) ?? [])
        : Promise.resolve([]),
    ]);

  const elements = [
    ...textElements,
    ...imageElements,
    ...drawingElements,
    ...annotationElements,
    ...formFieldElements,
  ];

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
  geometry: PageGeometry,
  pageNumber: number,
  options: ParseOptions,
  formsByPage: Map<number, FormFieldElement[]> = new Map(),
  imagesByPage: Map<number, ImageElement[]> = new Map(),
  annotationsByPage: Map<number, AnnotationElement[]> = new Map(),
  drawingsByPage: Map<number, ShapeElement[]> = new Map(),
  textsByPage: Map<number, TextElement[]> = new Map(),
): Promise<PageObject> {
  const { width: pageWidth, height: pageHeight, rotation, mediaBox } = geometry;

  const extractFormsEnabled = shouldExtractForms(options);

  // All five element collections are document-level (extracted once via the
  // native engine and sliced per page); forms keep their own guard upstream.
  const [textElements, imageElements, drawingElements, annotationElements, formFieldElements] =
    await Promise.all([
      options.extractText !== false
        ? Promise.resolve(textsByPage.get(pageNumber) ?? [])
        : Promise.resolve([]),

      options.extractImages !== false
        ? Promise.resolve(imagesByPage.get(pageNumber) ?? [])
        : Promise.resolve([]),

      options.extractDrawings !== false
        ? Promise.resolve(drawingsByPage.get(pageNumber) ?? [])
        : Promise.resolve([]),

      options.extractAnnotations !== false
        ? Promise.resolve(annotationsByPage.get(pageNumber) ?? [])
        : Promise.resolve([]),

      extractFormsEnabled
        ? Promise.resolve(formsByPage.get(pageNumber) ?? [])
        : Promise.resolve([]),
    ]);

  const elements = [
    ...textElements,
    ...imageElements,
    ...drawingElements,
    ...annotationElements,
    ...formFieldElements,
  ];

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

  // pdfjs `getDocument` may transfer (and detach) the input buffer, which would
  // leave the native-engine extractors below reading a detached ArrayBuffer.
  // Snapshot a private host copy for them BEFORE pdfjs touches the original.
  const libBytes = new Uint8Array(
    pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes),
  );

  const { pageCount, geometryByPage } = await extractPageGeometry(libBytes);

  engineLogger.debug('[parser] PDF loaded', {
    documentId,
    numPages: pageCount,
  });

  // Step 2 — Document-level extractions (parallel, each with graceful fallback).
  const [metadata, bookmarks, layers, embeddedFiles, namedDestinations] = await Promise.all([
    safeExtract('metadata', async () => {
      const m = await extractMetadata(libBytes);
      // safeExtract expects T[], so we wrap the single object
      return [m];
    }).then((arr) => arr[0] ?? {
      title: null, author: null, subject: null, keywords: [], creator: null,
      producer: null, creationDate: null, modificationDate: null,
      pageCount, pdfVersion: '1.7', isEncrypted: false,
      permissions: {
        print: true, modify: true, copy: true, annotate: true,
        fillForms: true, extract: true, assemble: true, printHighQuality: true,
      },
    }),

    options.extractBookmarks !== false
      ? safeExtract('bookmarks', () => extractBookmarks(libBytes))
      : Promise.resolve([]),

    safeExtract('layers', () => extractLayers(libBytes)),
    safeExtract('embeddedFiles', () => extractEmbeddedFiles(libBytes)),

    safeExtract('namedDestinations', async () => {
      const destinations = await extractNamedDestinations(libBytes);
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
    const total = Math.min(pageCount, maxPages);
    pageNumbers = Array.from({ length: total }, (_, i) => i + 1);
  }

  for (const pageNum of pageNumbers) {
    if (pageNum < 1 || pageNum > pageCount) {
      throw new PDFPageOutOfRangeError(pageNum, pageCount);
    }
  }

  if (pageCount > maxPages && !options.pages) {
    engineLogger.warn('[parser] document exceeds maxPages — truncating', {
      documentId,
      totalPages: pageCount,
      maxPages,
      processing: pageNumbers.length,
    });
  }

  engineLogger.debug('[parser] extracting pages', {
    documentId,
    pages: pageNumbers.length,
  });

  // AcroForm fields and embedded images are document-level: extract each once
  // (via the native engine) and slice per page.
  const formsByPage = shouldExtractForms(options)
    ? await extractFormFieldsByPage(libBytes)
    : new Map<number, FormFieldElement[]>();
  const imagesByPage =
    options.extractImages !== false
      ? await extractImageElementsByPage(libBytes, options.baseUrl, documentId)
      : new Map<number, ImageElement[]>();
  const annotationsByPage =
    options.extractAnnotations !== false
      ? await extractAnnotationElementsByPage(libBytes)
      : new Map<number, AnnotationElement[]>();
  const drawingsByPage =
    options.extractDrawings !== false
      ? await extractDrawingElementsByPage(libBytes)
      : new Map<number, ShapeElement[]>();
  const textsByPage =
    options.extractText !== false
      ? await extractTextElementsByPage(libBytes)
      : new Map<number, TextElement[]>();

  // Step 3 — Per-page extraction (pages run in parallel; element maps are
  // sliced per page in buildPageObjectSafe).
  const pageObjects = await Promise.all(
    pageNumbers.map((pageNum) =>
      buildPageObjectSafe(
        geometryByPage.get(pageNum)!,
        pageNum,
        { ...options, documentId },
        formsByPage,
        imagesByPage,
        annotationsByPage,
        drawingsByPage,
        textsByPage,
      ),
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
  const libBytes = new Uint8Array(
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer),
  );

  const { pageCount, geometryByPage } = await extractPageGeometry(libBytes);

  if (pageNumber < 1 || pageNumber > pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, pageCount);
  }

  const formsByPage =
    options.extractFormFields !== false
      ? await extractFormFieldsByPage(libBytes)
      : new Map<number, FormFieldElement[]>();
  const imagesByPage =
    options.extractImages !== false
      ? await extractImageElementsByPage(libBytes, options.baseUrl, options.documentId)
      : new Map<number, ImageElement[]>();
  const annotationsByPage =
    options.extractAnnotations !== false
      ? await extractAnnotationElementsByPage(libBytes)
      : new Map<number, AnnotationElement[]>();
  const drawingsByPage =
    options.extractDrawings !== false
      ? await extractDrawingElementsByPage(libBytes)
      : new Map<number, ShapeElement[]>();
  const textsByPage =
    options.extractText !== false
      ? await extractTextElementsByPage(libBytes)
      : new Map<number, TextElement[]>();

  return buildPageObject(
    geometryByPage.get(pageNumber)!,
    pageNumber,
    options,
    formsByPage,
    imagesByPage,
    annotationsByPage,
    drawingsByPage,
    textsByPage,
  );
}

export async function parseMetadata(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<DocumentMetadata> {
  return extractMetadata(buffer);
}

export async function parseBookmarks(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<BookmarkObject[]> {
  return extractBookmarks(buffer);
}
