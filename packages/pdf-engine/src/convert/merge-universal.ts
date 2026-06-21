/**
 * Universal merge: take a heterogeneous list of files (PDF, image, Office, HTML,
 * RTF, plain text), convert each to PDF, then concatenate them — in the order
 * given — into a single PDF.
 *
 * Every conversion runs through the in-house zero-dependency engine
 * (`@qrcommunication/gigapdf-lib`): images via {@link imageToPdf}, Office docs
 * via {@link convertOfficeToPdf}, HTML via {@link htmlToPDF}, RTF/TXT via the
 * text wrappers. The final concatenation uses the engine's native
 * `mergePdfs(Uint8Array[])` primitive (append pages in order).
 *
 * Type detection prefers the filename extension when one is supplied, and falls
 * back to magic-byte sniffing otherwise. A file whose type cannot be determined
 * (or which fails to convert) is collected and reported in an aggregated error
 * that names every offending file — nothing is silently dropped.
 */

import { PDFEngineError } from '../errors';
import { getEngine } from '../wasm';
import { imageToPdf } from './image-to-pdf';
import { textToPdf, rtfToPdf } from './text-to-pdf';
import { htmlToPDF } from './html-to-pdf';
import { convertOfficeToPdf, isOfficeImportFormat, type OfficeImportFormat } from './office-headless';

/** One input to {@link mergeUniversal}. */
export interface UniversalMergeInput {
  /** Raw file bytes. */
  bytes: Uint8Array;
  /** Optional filename — its extension is the primary type hint when present. */
  filename?: string;
  /** Optional MIME type — currently informational; detection uses extension + magic bytes. */
  mimeType?: string;
}

/** The kinds of input {@link mergeUniversal} knows how to turn into a PDF. */
type DetectedKind =
  | { kind: 'pdf' }
  | { kind: 'image' }
  | { kind: 'office'; format: OfficeImportFormat }
  | { kind: 'html' }
  | { kind: 'rtf' }
  | { kind: 'txt' };

/** Lowercase extension (without the dot) of a filename, or `''` if none. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/** Do the first `sig` bytes of `bytes` match the given byte signature? */
function hasMagic(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const; // %PDF
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const; // \x89PNG
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const; // JFIF/EXIF SOI
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38] as const; // GIF8
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] as const; // RIFF
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50] as const; // WEBP (at offset 8)
const FTYP_TAG = [0x66, 0x74, 0x79, 0x70] as const; // ftyp (at offset 4)
const AVIF_BRAND = [0x61, 0x76, 0x69, 0x66] as const; // avif (at offset 8)
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const; // PK\x03\x04 (OOXML / ODF)
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const; // legacy Office
const RTF_MAGIC = [0x7b, 0x5c, 0x72, 0x74, 0x66] as const; // {\rtf

/** Sniff an image kind purely from magic bytes (PNG/JPEG/GIF/WebP/AVIF). */
function isImageMagic(bytes: Uint8Array): boolean {
  if (hasMagic(bytes, PNG_MAGIC) || hasMagic(bytes, JPEG_MAGIC) || hasMagic(bytes, GIF_MAGIC)) {
    return true;
  }
  // WebP: "RIFF"...."WEBP"
  if (hasMagic(bytes, RIFF_MAGIC) && hasMagic(bytes, WEBP_TAG, 8)) return true;
  // AVIF: ....ftyp....avif
  if (hasMagic(bytes, FTYP_TAG, 4) && hasMagic(bytes, AVIF_BRAND, 8)) return true;
  return false;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);

/**
 * Decide how to convert one input, preferring the filename extension and falling
 * back to magic bytes. Returns `null` when the type cannot be determined.
 */
function detectKind(input: UniversalMergeInput): DetectedKind | null {
  const { bytes, filename } = input;
  const ext = filename ? extensionOf(filename) : '';

  // 1) Extension-driven (authoritative when a filename is supplied).
  if (ext) {
    if (ext === 'pdf') return { kind: 'pdf' };
    if (IMAGE_EXTENSIONS.has(ext)) return { kind: 'image' };
    if (isOfficeImportFormat(ext)) return { kind: 'office', format: ext };
    if (HTML_EXTENSIONS.has(ext)) return { kind: 'html' };
    if (ext === 'rtf') return { kind: 'rtf' };
    if (ext === 'txt') return { kind: 'txt' };
    // Unknown extension → fall through to magic-byte sniffing.
  }

  // 2) Magic-byte sniffing.
  if (hasMagic(bytes, PDF_MAGIC)) return { kind: 'pdf' };
  if (isImageMagic(bytes)) return { kind: 'image' };
  if (hasMagic(bytes, RTF_MAGIC)) return { kind: 'rtf' };
  if (hasMagic(bytes, OLE2_MAGIC)) {
    // Legacy Office container — sub-format is ambiguous from bytes alone; the
    // engine still auto-detects internally. `doc` is a safe label.
    return { kind: 'office', format: 'doc' };
  }
  if (hasMagic(bytes, ZIP_MAGIC)) {
    // OOXML or ODF — same caveat; `docx` is a safe label for the engine.
    return { kind: 'office', format: 'docx' };
  }

  // 3) Default to plain text only when a filename was given but unrecognized,
  //    OR no filename and the bytes aren't a known binary container. Otherwise
  //    we can't tell — report it.
  if (ext === 'txt' || (!filename && bytes.length > 0)) return { kind: 'txt' };
  return null;
}

/** Convert a single detected input to PDF bytes. */
async function convertOne(input: UniversalMergeInput, detected: DetectedKind): Promise<Uint8Array> {
  switch (detected.kind) {
    case 'pdf':
      return input.bytes;
    case 'image':
      return imageToPdf(input.bytes);
    case 'office':
      return convertOfficeToPdf(input.bytes, detected.format);
    case 'html': {
      const buf = await htmlToPDF(new TextDecoder('utf-8').decode(input.bytes));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    case 'rtf':
      return rtfToPdf(input.bytes);
    case 'txt':
      return textToPdf(input.bytes);
  }
}

/** Human-friendly label for an input in error messages. */
function labelOf(input: UniversalMergeInput, index: number): string {
  return input.filename ?? `file #${index + 1}`;
}

/**
 * Convert each input to PDF and concatenate them into a single PDF, in order.
 *
 *  - 0 inputs → throws (nothing to merge).
 *  - 1 input  → returns that input's PDF conversion directly (no merge step).
 *  - N inputs → converts all, then `engine.mergePdfs([...])`.
 *
 * Supported per-file types: PDF (passthrough), image (PNG/JPEG/GIF/WebP/AVIF),
 * Office (docx/doc/odt, xlsx/xls/ods, pptx/ppt/odp), HTML, RTF, plain text.
 *
 * @throws {PDFEngineError} if the list is empty, or if any file's type cannot be
 *   determined / it fails to convert. The message names every offending file.
 */
export async function mergeUniversal(files: UniversalMergeInput[]): Promise<Uint8Array> {
  if (files.length === 0) {
    throw new PDFEngineError('mergeUniversal requires at least one file', 'MERGE_UNIVERSAL_EMPTY_INPUT');
  }

  const pdfs: Uint8Array[] = [];
  const failures: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const input = files[i]!;
    const detected = detectKind(input);
    if (detected === null) {
      failures.push(`${labelOf(input, i)} (unrecognized file type)`);
      continue;
    }
    try {
      pdfs.push(await convertOne(input, detected));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push(`${labelOf(input, i)} (${reason})`);
    }
  }

  if (failures.length > 0) {
    throw new PDFEngineError(
      `mergeUniversal could not convert ${failures.length} file(s): ${failures.join('; ')}`,
      'MERGE_UNIVERSAL_CONVERT_FAILED',
    );
  }

  // Single file → return its PDF directly; no need to round-trip through merge.
  if (pdfs.length === 1) return pdfs[0]!;

  const giga = await getEngine();
  const merged = giga.mergePdfs(pdfs);
  if (merged.length === 0) {
    throw new PDFEngineError('mergeUniversal produced an empty document', 'MERGE_UNIVERSAL_EMPTY_OUTPUT');
  }
  return merged;
}
