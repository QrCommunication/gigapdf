import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { DocumentMetadata, DocumentPermissions } from '@giga-pdf/types';
import {
  PDFParseError,
  PDFEncryptedError,
  PDFInvalidPasswordError,
  PDFPageOutOfRangeError,
} from '../errors';

export interface PDFDocumentHandle {
  readonly id: string;
  readonly pageCount: number;
  readonly isDirty: boolean;
  readonly wasEncrypted: boolean;
  readonly _pdfDoc: PDFDocument;
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

const dirtyMap = new WeakMap<PDFDocument, boolean>();

export function markDirty(doc: PDFDocument): void {
  dirtyMap.set(doc, true);
}

export async function openDocument(
  source: Buffer | string,
  options: OpenDocumentOptions = {},
): Promise<PDFDocumentHandle> {
  let data: Uint8Array;
  if (typeof source === 'string') {
    data = await readFile(source);
  } else {
    data = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }

  try {
    const pdfDoc = await PDFDocument.load(data, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    // pdf-lib loads encrypted PDFs silently with ignoreEncryption: true.
    // We detect encryption via the /Encrypt entry in the trailer dictionary.
    const isEncrypted =
      pdfDoc.catalog.lookup(PDFName.of('Encrypt')) !== undefined ||
      pdfDoc.context.trailerInfo.Encrypt !== undefined;

    if (isEncrypted && !options.password) {
      throw new PDFEncryptedError();
    }

    // pdf-lib does not support decryption; a provided password cannot be validated.
    // We surface PDFInvalidPasswordError only if the document is encrypted and a
    // password was given, since we cannot confirm correctness either way.
    if (isEncrypted && options.password) {
      throw new PDFInvalidPasswordError();
    }

    dirtyMap.set(pdfDoc, false);

    return {
      id: randomUUID(),
      get pageCount() {
        return pdfDoc.getPageCount();
      },
      get isDirty() {
        return dirtyMap.get(pdfDoc) ?? false;
      },
      wasEncrypted: isEncrypted,
      _pdfDoc: pdfDoc,
    };
  } catch (error) {
    if (error instanceof PDFEncryptedError) throw error;
    if (error instanceof PDFInvalidPasswordError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('encrypt')) {
      throw new PDFEncryptedError();
    }
    throw new PDFParseError(`Failed to open PDF: ${message}`);
  }
}

export async function saveDocument(
  handle: PDFDocumentHandle,
  options: SaveDocumentOptions = {},
): Promise<Buffer> {
  const bytes = await handle._pdfDoc.save({
    useObjectStreams: options.useObjectStreams ?? true,
    updateFieldAppearances: true,
  });
  dirtyMap.set(handle._pdfDoc, false);
  return Buffer.from(bytes);
}

export function closeDocument(handle: PDFDocumentHandle): void {
  dirtyMap.delete(handle._pdfDoc);
}

export function getMetadata(handle: PDFDocumentHandle): DocumentMetadata {
  const doc = handle._pdfDoc;

  const rawKeywords = doc.getKeywords();
  const keywords = rawKeywords
    ? rawKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : [];

  const toISOOrNull = (date: Date | undefined): string | null =>
    date instanceof Date && !isNaN(date.getTime()) ? date.toISOString() : null;

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
    title: doc.getTitle() ?? null,
    author: doc.getAuthor() ?? null,
    subject: doc.getSubject() ?? null,
    keywords,
    creator: doc.getCreator() ?? null,
    producer: doc.getProducer() ?? null,
    creationDate: toISOOrNull(doc.getCreationDate()),
    modificationDate: toISOOrNull(doc.getModificationDate()),
    pageCount: doc.getPageCount(),
    pdfVersion: '1.7',
    isEncrypted: handle.wasEncrypted,
    permissions,
  };
}

export function setMetadata(
  handle: PDFDocumentHandle,
  metadata: Partial<Pick<DocumentMetadata, 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer'>>,
): void {
  const doc = handle._pdfDoc;

  if (metadata.title !== undefined) doc.setTitle(metadata.title ?? '');
  if (metadata.author !== undefined) doc.setAuthor(metadata.author ?? '');
  if (metadata.subject !== undefined) doc.setSubject(metadata.subject ?? '');
  if (metadata.keywords !== undefined) doc.setKeywords(metadata.keywords);
  if (metadata.creator !== undefined) doc.setCreator(metadata.creator ?? '');
  if (metadata.producer !== undefined) doc.setProducer(metadata.producer ?? '');

  markDirty(doc);
}

export function getPageDimensions(
  handle: PDFDocumentHandle,
  pageNumber: number,
): PageDimensions {
  const pageCount = handle._pdfDoc.getPageCount();
  if (pageNumber < 1 || pageNumber > pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, pageCount);
  }

  const page = handle._pdfDoc.getPage(pageNumber - 1);
  const { width, height } = page.getSize();
  const rawAngle = page.getRotation().angle;

  // Normalize to the four valid rotation values.
  const normalized = ((rawAngle % 360) + 360) % 360;
  const rotation = (
    normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0
  ) as 0 | 90 | 180 | 270;

  return { width, height, rotation };
}
