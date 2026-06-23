/**
 * Pure helpers for the unified GED import flow (no React, no DOM, no network).
 *
 * The GED accepts ANY file type now: the original bytes are stored as-is
 * (no client-side Office→PDF conversion). Validation is therefore limited to
 * a size cap that matches the storage backend (`_FILE_SIZE_LIMIT` = 250 MB)
 * and a non-empty check. Format-specific enrichment (PDF thumbnail + text
 * extraction) is decided downstream from `isPdfFile`.
 *
 * Everything here is unit-tested (see `__tests__/document-import.test.ts`).
 */

/** Storage backend hard cap (POST /api/v1/storage/documents → 413 above this). */
export const MAX_IMPORT_FILE_SIZE_BYTES = 250 * 1024 * 1024;

/**
 * Bounded concurrency: at most 3 full upload pipelines in flight. Unbounded
 * `Promise.allSettled` would open one pipeline (upload + optional enrich) per
 * file and overwhelm the backend on large drops; sequential is too slow.
 */
export const IMPORT_CONCURRENCY = 3;

/** A single file accepted for import (validation passed). */
export interface ImportValidationOk {
  ok: true;
}

/** A single file rejected client-side, with an i18n key for the reason. */
export interface ImportValidationError {
  ok: false;
  /** i18n key under `documents.import.*` describing the rejection. */
  reasonKey: "errorEmpty" | "errorTooLarge";
}

export type ImportValidation = ImportValidationOk | ImportValidationError;

/**
 * Validate a file for the universal import. ALL formats are allowed — only an
 * empty file or one exceeding the storage size cap is rejected. Returns an
 * i18n key (not a translated string) so callers control the wording/locale.
 */
export function validateImportFile(
  file: { size: number },
  maxBytes: number = MAX_IMPORT_FILE_SIZE_BYTES,
): ImportValidation {
  if (file.size <= 0) {
    return { ok: false, reasonKey: "errorEmpty" };
  }
  if (file.size > maxBytes) {
    return { ok: false, reasonKey: "errorTooLarge" };
  }
  return { ok: true };
}

/** Lowercase file extension WITHOUT the dot, or "" when there is none. */
export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * True when the file is a PDF (by extension or MIME). PDFs get the extra
 * first-page thumbnail render + full-text extraction; other formats are
 * stored as-is without that PDF-only enrichment.
 */
export function isPdfFile(file: { name: string; type?: string }): boolean {
  return getFileExtension(file.name) === "pdf" || file.type === "application/pdf";
}

/**
 * Office (and RTF) import formats convertible to an editable PDF on upload.
 *
 * The OOXML/OLE2/ODF entries MIRROR `OFFICE_IMPORT_FORMATS` from
 * `@giga-pdf/pdf-engine` (`convert/office-headless.ts`) — kept as a local
 * literal so this module stays pure (no WASM engine import, which would break
 * the jsdom unit test). The conversion route (`/api/office/upload`) is the
 * type-checked gate against the engine's `OfficeImportFormat`; this list only
 * decides client-side routing.
 *
 * NOTE: `rtf` is included — `/api/office/upload` accepts it (magic `{\rtf`) and
 * converts it via the engine's `rtfToPdf`. RTF therefore becomes an editable PDF
 * on upload instead of being dead-stored as raw text.
 */
const OFFICE_CONVERT_EXTENSIONS = new Set([
  "docx",
  "xlsx",
  "pptx",
  "doc",
  "xls",
  "ppt",
  "odt",
  "ods",
  "odp",
  "rtf",
]);

/**
 * True when the file is an Office (or RTF) document that should be converted to
 * PDF on upload (so it becomes editable in the editor). Detected by extension
 * only; the conversion route re-validates the container/RTF magic bytes
 * server-side.
 */
export function isOfficeFile(file: { name: string }): boolean {
  return OFFICE_CONVERT_EXTENSIONS.has(getFileExtension(file.name));
}

/**
 * Raster image formats convertible to a single-page editable PDF on upload.
 *
 * MIRRORS the engine's `imageToPdf` supported formats (PNG/JPEG/GIF/WebP/AVIF).
 * On upload they are raised to a PDF (`/api/convert/image` → native WASM
 * `imageToPdf`) so they open as an editable page in the editor instead of being
 * dead-stored as raw image bytes. The conversion route re-validates the image
 * magic bytes server-side.
 */
const IMAGE_CONVERT_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
]);

/**
 * True when the file is a raster image that should be converted to PDF on upload
 * (so it becomes editable in the editor). Detected by extension only; the
 * conversion route re-validates the image magic bytes server-side.
 */
export function isImageFile(file: { name: string }): boolean {
  return IMAGE_CONVERT_EXTENSIONS.has(getFileExtension(file.name));
}

/**
 * Text-model import formats convertible to an editable PDF on upload.
 *
 * Markdown (`md`/`markdown`) and CSV are plain UTF-8 text files (no binary
 * container). On upload they are lowered into the engine's unified document
 * model and raised to a PDF (`mdToModel`/`csvToModel` → `modelToPdf`) so they
 * open as editable pages in the editor instead of failing to parse as a PDF.
 *
 * The conversion route (`/api/convert/text-format`) is the type-checked gate
 * against the engine's `convertMarkdownToPdf`/`convertCsvToPdf`; this list only
 * decides client-side routing.
 */
const TEXT_MODEL_CONVERT_EXTENSIONS = new Set(['md', 'markdown', 'csv']);

/**
 * True when the file is a Markdown or CSV document that should be converted to
 * PDF on upload (so it becomes editable in the editor). Detected by extension
 * only; the conversion route re-validates server-side.
 */
export function isTextModelFile(file: { name: string }): boolean {
  return TEXT_MODEL_CONVERT_EXTENSIONS.has(getFileExtension(file.name));
}

/** Strip a single trailing extension from a file name for the stored title. */
export function stripExtension(fileName: string): string {
  const ext = getFileExtension(fileName);
  if (!ext) return fileName;
  return fileName.slice(0, fileName.length - ext.length - 1);
}

/**
 * Run `worker` over `items` with at most `concurrency` runners in flight.
 * Results preserve input order. Each worker is expected to resolve (never
 * reject) so one bad item cannot abort the batch.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;

  const runner = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  };

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runner()));
  return results;
}

/** Outcome of importing one file (never throws). */
export type ImportOutcome =
  | { ok: true; name: string }
  | { ok: false; name: string; reason: string };

/** Aggregate counts + named failures for the end-of-batch summary toast. */
export interface ImportSummary {
  successCount: number;
  failures: Array<{ name: string; reason: string }>;
}

/** Reduce per-file outcomes into a summary for toast rendering. */
export function summarizeOutcomes(
  outcomes: readonly ImportOutcome[],
): ImportSummary {
  const failures = outcomes
    .filter((o): o is Extract<ImportOutcome, { ok: false }> => !o.ok)
    .map((o) => ({ name: o.name, reason: o.reason }));
  return { successCount: outcomes.length - failures.length, failures };
}
