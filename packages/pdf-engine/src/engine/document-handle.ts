import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { GigaPdfDoc } from '@qrcommunication/gigapdf-lib';
import type { DocumentMetadata, DocumentPermissions } from '@giga-pdf/types';
import { getEngine } from '../wasm';
import {
  PDFParseError,
  PDFEncryptedError,
  PDFInvalidPasswordError,
  PDFPageOutOfRangeError,
} from '../errors';

/**
 * A handle to an open PDF, backed by the zero-dependency Rust→WASM engine
 * (`@qrcommunication/gigapdf-lib`). `_doc` is a live `GigaPdfDoc` — page ops,
 * renderers, flatten, etc. mutate it in place, then `saveDocument` serializes
 * it. Fully self-contained — no third-party PDF/Office libraries.
 */
export interface PDFDocumentHandle {
  readonly id: string;
  readonly pageCount: number;
  readonly isDirty: boolean;
  readonly wasEncrypted: boolean;
  readonly _doc: GigaPdfDoc;
}

export interface OpenDocumentOptions {
  password?: string;
}

export interface SaveDocumentOptions {
  garbage?: 0 | 1 | 2 | 3 | 4;
  useObjectStreams?: boolean;
  updateMetadata?: boolean;
}

export interface PageDimensions {
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

const dirtyMap = new WeakMap<GigaPdfDoc, boolean>();
// Tracks documents whose WASM handle has been freed, so `closeDocument` is
// idempotent — calling `GigaPdfDoc.close()` twice would trap the WASM module
// ("unreachable") and corrupt the shared engine heap.
const closedDocs = new WeakSet<GigaPdfDoc>();

export function markDirty(doc: GigaPdfDoc): void {
  dirtyMap.set(doc, true);
}

/** Normalise any /Rotate angle to one of the four valid PDF rotations. */
function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const n = ((angle % 360) + 360) % 360;
  return (n === 90 || n === 180 || n === 270 ? n : 0) as 0 | 90 | 180 | 270;
}

export async function openDocument(
  source: Buffer | string,
  options: OpenDocumentOptions = {},
): Promise<PDFDocumentHandle> {
  const giga = await getEngine();

  let data: Uint8Array;
  if (typeof source === 'string') {
    data = await readFile(source);
  } else {
    data = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }

  // Detect encryption without decrypting (reads /Encrypt /P/V/R only).
  let isEncrypted = false;
  try {
    isEncrypted = giga.encryptionInfo(data).encrypted;
  } catch {
    isEncrypted = false;
  }

  if (isEncrypted && !options.password) {
    throw new PDFEncryptedError();
  }

  let doc: GigaPdfDoc;
  try {
    if (isEncrypted && options.password) {
      const opened = giga.openEncrypted(data, options.password);
      if (opened === null) {
        throw new PDFInvalidPasswordError();
      }
      doc = opened;
    } else {
      doc = giga.open(data);
    }
  } catch (error) {
    if (error instanceof PDFEncryptedError) throw error;
    if (error instanceof PDFInvalidPasswordError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('encrypt')) {
      throw new PDFEncryptedError();
    }
    throw new PDFParseError(`Failed to open PDF: ${message}`);
  }

  dirtyMap.set(doc, false);

  return {
    id: randomUUID(),
    get pageCount() {
      return doc.pageCount();
    },
    get isDirty() {
      return dirtyMap.get(doc) ?? false;
    },
    wasEncrypted: isEncrypted,
    _doc: doc,
  };
}

export async function saveDocument(
  handle: PDFDocumentHandle,
  options: SaveDocumentOptions = {},
): Promise<Buffer> {
  // `saveCompressed` packs objects into Flate object streams (smaller output),
  // the engine's object-stream packing mode. `save` is the plain
  // serializer used when the caller opts out.
  const bytes =
    options.useObjectStreams === false
      ? handle._doc.save()
      : handle._doc.saveCompressed();
  dirtyMap.set(handle._doc, false);
  return Buffer.from(bytes);
}

export function closeDocument(handle: PDFDocumentHandle): void {
  if (closedDocs.has(handle._doc)) return;
  closedDocs.add(handle._doc);
  dirtyMap.delete(handle._doc);
  // Free the underlying WASM document handle.
  handle._doc.close();
}

/**
 * Extract selected pages into a brand-new document.
 *
 * Returns a fresh handle so the caller can save it independently (e.g., download
 * a subset). The engine's `extractPages` produces a standalone PDF that we
 * re-open into a handle.
 */
export async function extractPages(
  handle: PDFDocumentHandle,
  pageNumbers: number[],
): Promise<PDFDocumentHandle> {
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
    throw new Error('extractPages requires a non-empty array of page numbers.');
  }

  const pageCount = handle._doc.pageCount();
  for (const pn of pageNumbers) {
    if (!Number.isInteger(pn) || pn < 1 || pn > pageCount) {
      throw new PDFPageOutOfRangeError(pn, pageCount);
    }
  }

  const bytes = handle._doc.extractPages(pageNumbers);
  return openDocument(Buffer.from(bytes));
}

/**
 * Parse a PDF date string (`D:YYYYMMDDHHmmSS…`) to an ISO-8601 string, or null
 * when absent/unparseable. Only the date+time prefix is used (timezone offsets
 * are ignored — treated as UTC, matching the previous behaviour).
 */
function pdfDateToIso(raw: string | null): string | null {
  if (!raw) return null;
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw);
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = m;
  const date = new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
  );
  return isNaN(date.getTime()) ? null : date.toISOString();
}

export function getMetadata(handle: PDFDocumentHandle): DocumentMetadata {
  const doc = handle._doc;
  const get = (key: string): string | null => {
    const v = doc.getMetadata(key);
    return v && v.length > 0 ? v : null;
  };

  const rawKeywords = get('Keywords');
  const keywords = rawKeywords
    ? rawKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : [];

  const permissions: DocumentPermissions = {
    print: true,
    modify: true,
    copy: true,
    annotate: true,
    fillForms: true,
    extract: true,
    assemble: true,
    printHighQuality: true,
  };

  return {
    title: get('Title'),
    author: get('Author'),
    subject: get('Subject'),
    keywords,
    creator: get('Creator'),
    producer: get('Producer'),
    creationDate: pdfDateToIso(get('CreationDate')),
    modificationDate: pdfDateToIso(get('ModDate')),
    pageCount: doc.pageCount(),
    pdfVersion: '1.7',
    isEncrypted: handle.wasEncrypted,
    permissions,
  };
}

export function setMetadata(
  handle: PDFDocumentHandle,
  metadata: Partial<
    Pick<DocumentMetadata, 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer'>
  >,
): void {
  const doc = handle._doc;

  if (metadata.title !== undefined) doc.setMetadata('Title', metadata.title ?? '');
  if (metadata.author !== undefined) doc.setMetadata('Author', metadata.author ?? '');
  if (metadata.subject !== undefined) doc.setMetadata('Subject', metadata.subject ?? '');
  if (metadata.keywords !== undefined)
    doc.setMetadata('Keywords', metadata.keywords.join(', '));
  if (metadata.creator !== undefined) doc.setMetadata('Creator', metadata.creator ?? '');
  if (metadata.producer !== undefined) doc.setMetadata('Producer', metadata.producer ?? '');

  markDirty(doc);
}

export function getPageDimensions(
  handle: PDFDocumentHandle,
  pageNumber: number,
): PageDimensions {
  const pageCount = handle._doc.pageCount();
  if (pageNumber < 1 || pageNumber > pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, pageCount);
  }

  const info = handle._doc.pageInfo(pageNumber);
  return {
    width: info.width,
    height: info.height,
    rotation: normalizeRotation(info.rotation),
  };
}
