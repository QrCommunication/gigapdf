/**
 * Robust metadata extraction with MuPDF fallback.
 *
 * pdf-lib is strict about cross-reference table integrity and refuses to
 * open documents with malformed dictionaries — even when only the metadata
 * section is corrupted. This loses metadata access for ~5% of real-world
 * PDFs (scanners producing non-conformant xref tables, old PDF 1.2
 * producers, ZUGFeRD invoices with embedded attachments confusing pdf-lib).
 *
 * MuPDF is more lenient at parse time and exposes `Document.getMetaData(key)`
 * for the common metadata fields. We try pdf-lib first (fast, native types)
 * and fall back to MuPDF if it throws.
 */

import { engineLogger } from '../utils/logger';
import { openDocument, getMetadata as getPdfLibMetadata } from '../engine/document-handle';
import type { DocumentMetadata } from '@giga-pdf/types';

const MUPDF_KEY_MAP: Record<string, string> = {
  // mupdf documented info-dict keys
  title: 'info:Title',
  author: 'info:Author',
  subject: 'info:Subject',
  keywords: 'info:Keywords',
  creator: 'info:Creator',
  producer: 'info:Producer',
  creationDate: 'info:CreationDate',
  modificationDate: 'info:ModDate',
};

export async function getMetadataRobust(
  pdfBytes: Uint8Array | Buffer,
): Promise<DocumentMetadata> {
  // Try pdf-lib first — preferred path because it returns typed values
  // (Date instances, parsed keyword list) and we already have a code path
  // exercised by the legacy route.
  try {
    const buffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
    const handle = await openDocument(buffer);
    return getPdfLibMetadata(handle);
  } catch (pdfLibErr) {
    engineLogger.warn('metadata-robust: pdf-lib failed, falling back to mupdf', {
      error: pdfLibErr instanceof Error ? pdfLibErr.message : String(pdfLibErr),
    });
  }

  // Fallback — MuPDF tolerates malformed xref / corrupted catalogs.
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(
    pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes),
    'application/pdf',
  );

  const safeRead = (key: string): string | null => {
    try {
      const v = doc.getMetaData(key);
      return v && v.length > 0 ? v : null;
    } catch {
      return null;
    }
  };

  const rawKeywords = safeRead(MUPDF_KEY_MAP.keywords!);
  const keywords = rawKeywords
    ? rawKeywords.split(',').map((k) => k.trim()).filter(Boolean)
    : [];

  const parsePdfDate = (raw: string | null): string | null => {
    if (!raw) return null;
    // PDF date format: D:YYYYMMDDHHmmSSOHH'mm' — strip prefix + reformat.
    const m = raw.match(/^D:?(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
    if (!m) return null;
    try {
      const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
      return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
    } catch {
      return null;
    }
  };

  return {
    title: safeRead(MUPDF_KEY_MAP.title!),
    author: safeRead(MUPDF_KEY_MAP.author!),
    subject: safeRead(MUPDF_KEY_MAP.subject!),
    keywords,
    creator: safeRead(MUPDF_KEY_MAP.creator!),
    producer: safeRead(MUPDF_KEY_MAP.producer!),
    creationDate: parsePdfDate(safeRead(MUPDF_KEY_MAP.creationDate!)),
    modificationDate: parsePdfDate(safeRead(MUPDF_KEY_MAP.modificationDate!)),
    pageCount: doc.countPages(),
    pdfVersion: '1.7',
    isEncrypted: doc.needsPassword(),
    permissions: {
      print: true,
      modify: true,
      copy: true,
      annotate: true,
      fillForms: true,
      extract: true,
      assemble: true,
      printHighQuality: true,
    },
  };
}
