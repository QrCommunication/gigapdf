/**
 * export-formats.ts
 *
 * Pure, dependency-free mapping for the editor's universal export menu (#84).
 *
 * Every target the GigaPDF SDK can lower the current document into is described
 * here once — its file extension, MIME `contentType`, and whether the SDK method
 * returns binary bytes (`Uint8Array`) or a text string. The export helper
 * ({@link file://./export-document.ts}) and the toolbar menu both read this table
 * so the wire-up stays in lockstep with the SDK.
 *
 * No React, no DOM, no SDK import — trivially unit-testable.
 */

/** Every format the universal export menu can produce from the current document. */
export type ExportFormat =
  | "docx"
  | "xlsx"
  | "pptx"
  | "odt"
  | "ods"
  | "odp"
  | "html"
  | "rtf"
  | "pdf"
  | "markdown"
  | "csv"
  | "epub";

/** Whether the SDK method for a format returns raw bytes or a text string. */
export type ExportKind = "binary" | "text";

/** Descriptor for one export target. */
export interface ExportFormatDescriptor {
  /**
   * Lower-case file extension (no leading dot). Usually equals the format key,
   * but differs where the conventional extension does not (`markdown` → `md`).
   */
  readonly extension: string;
  /** MIME type used for the download `Blob` + `Content-Type`. */
  readonly contentType: string;
  /** `binary` → SDK returns `Uint8Array`; `text` → SDK returns `string`. */
  readonly kind: ExportKind;
}

/**
 * The single source of truth for every export target. OOXML + OpenDocument MIME
 * types match the office-export route's `CONTENT_TYPE_MAP`; `html`/`rtf` are the
 * text-producing targets, `pdf` re-serialises the document.
 */
export const EXPORT_FORMATS: Readonly<Record<ExportFormat, ExportFormatDescriptor>> = {
  docx: {
    extension: "docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "binary",
  },
  xlsx: {
    extension: "xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "binary",
  },
  pptx: {
    extension: "pptx",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "binary",
  },
  odt: {
    extension: "odt",
    contentType: "application/vnd.oasis.opendocument.text",
    kind: "binary",
  },
  ods: {
    extension: "ods",
    contentType: "application/vnd.oasis.opendocument.spreadsheet",
    kind: "binary",
  },
  odp: {
    extension: "odp",
    contentType: "application/vnd.oasis.opendocument.presentation",
    kind: "binary",
  },
  html: {
    extension: "html",
    contentType: "text/html;charset=utf-8",
    kind: "text",
  },
  rtf: {
    extension: "rtf",
    contentType: "application/rtf",
    kind: "text",
  },
  pdf: {
    extension: "pdf",
    contentType: "application/pdf",
    kind: "binary",
  },
  // Reflowable targets raised from the unified model (`toModel` → `modelTo*`).
  markdown: {
    extension: "md",
    contentType: "text/markdown;charset=utf-8",
    kind: "text",
  },
  csv: {
    extension: "csv",
    contentType: "text/csv;charset=utf-8",
    kind: "text",
  },
  epub: {
    extension: "epub",
    contentType: "application/epub+zip",
    kind: "binary",
  },
} as const;

/** Type guard: is `value` one of the supported export formats? */
export function isExportFormat(value: string): value is ExportFormat {
  return Object.prototype.hasOwnProperty.call(EXPORT_FORMATS, value);
}

/** Look up the descriptor for a format. */
export function exportFormatDescriptor(
  format: ExportFormat,
): ExportFormatDescriptor {
  return EXPORT_FORMATS[format];
}

/**
 * Build a download filename for an export: the document's base name (extension
 * stripped) plus the target extension. Falls back to `document` when no usable
 * base name is provided.
 */
export function exportFilename(
  baseName: string | null | undefined,
  format: ExportFormat,
): string {
  const trimmed = (baseName ?? "").trim();
  const withoutExt = trimmed.replace(/\.[^./\\]+$/, "");
  const safe = withoutExt.length > 0 ? withoutExt : "document";
  return `${safe}.${EXPORT_FORMATS[format].extension}`;
}
