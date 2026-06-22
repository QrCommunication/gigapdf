/**
 * Shared contract for the generic {@link ToolRunner} organism.
 *
 * A "tool" is a stateless upload → server-action → download workflow that
 * reuses one of the existing `/api/pdf/*` or `/api/office/*` endpoints. Each
 * concrete tool (split, compress, watermark, …) is described by a
 * {@link ToolConfig} object — no bespoke component per tool. The runner reads
 * the config to render the dropzone, the option fields, and to build the
 * `FormData` posted to the endpoint, then handles the response shape.
 *
 * i18n: every user-facing string is a key resolved against the tool's own
 * next-intl namespace (`tools.<key>`), so labels live in messages/{fr,en}.json
 * and never in this module.
 */

/** How many files the tool accepts. */
export type ToolUploadMode = "single" | "multiple";

/**
 * Shape of the endpoint response, which dictates how the runner turns it into
 * a download:
 * - `binary`   — the body IS the result file (PDF, ZIP). Downloaded as-is.
 * - `splitZip` — JSON `{ data: { parts: [{ filename, data: base64 }] } }`;
 *                the runner zips the base64 parts client-side into one archive.
 */
export type ToolResponseKind = "binary" | "splitZip";

/**
 * How a tool collects its primary input. Defaults to `file` (dropzone) when a
 * config omits {@link ToolConfig.input}, so the twelve historic file-tools keep
 * working unchanged.
 * - `file` — drag-and-drop / file picker (the original behaviour).
 * - `text` — a multi-line textarea (e.g. raw HTML or plain text to render).
 * - `url`  — a single URL field (e.g. a page to capture as PDF).
 */
export type ToolInputKind = "file" | "text" | "url";

/**
 * Declares a non-file primary input (textarea or URL field). The captured
 * value is sent on the request under {@link valueField} via the tool's
 * {@link ToolRequestSpec}. Only used by `text`/`url` tools.
 */
export interface ToolTextInput {
  /** Which control to render for the primary input. */
  kind: Exclude<ToolInputKind, "file">;
  /**
   * Key carrying the captured text/URL in the request payload (JSON property or
   * FormData field), e.g. `html` or `url` for `/api/pdf/convert`.
   */
  valueField: string;
  /** i18n key (tool namespace) for the input label. */
  labelKey: string;
  /** i18n key for the input placeholder. */
  placeholderKey?: string;
  /** i18n key for helper text shown under the input. */
  descriptionKey?: string;
  /** Textarea row count (ignored for `url`). Defaults to 12. */
  rows?: number;
  /** Reject submissions longer than this many characters (instant feedback). */
  maxLength?: number;
  /**
   * Optional pure mapping from the raw user input to the exact wire value (e.g.
   * wrap plain text in an HTML document for `/api/pdf/convert`). Applied just
   * before the request is built. Identity when omitted.
   */
  transform?: (raw: string) => string;
}

/**
 * How the runner serialises the request to {@link ToolConfig.endpoint}:
 * - `formData`     — multipart body (the original behaviour; default).
 * - `json`         — `application/json` body (constants + fields + the text
 *                    input). Used by `/api/pdf/convert`.
 * - `uploadExport` — two-step chain for PDF→Office: upload the queued file to
 *                    {@link ToolUploadExport.uploadEndpoint} to obtain a
 *                    document id, then POST `{ documentId, ...constants }` as
 *                    JSON to {@link ToolConfig.endpoint}. Returns the binary.
 */
export type ToolRequestKind = "formData" | "json" | "uploadExport";

/** Settings for the {@link ToolRequestKind} `uploadExport` chain. */
export interface ToolUploadExport {
  /** Session-upload endpoint returning `{ data: { document_id } }`. */
  uploadEndpoint: string;
  /** FormData field carrying the uploaded file (defaults to `file`). */
  uploadFileField?: string;
  /** JSON property carrying the returned id on the export call (defaults to `documentId`). */
  documentIdField?: string;
}

/** Optional, additive request descriptor. Absent ⇒ `formData`. */
export interface ToolRequestSpec {
  kind: ToolRequestKind;
  /** Required when `kind === "uploadExport"`. */
  uploadExport?: ToolUploadExport;
}

/** Kinds of option inputs a tool can expose above the action button. */
export type ToolFieldType =
  | "text"
  | "password"
  | "select"
  | "switch"
  | "slider"
  | "file";

/** One selectable option for a `select` field. */
export interface ToolSelectOption {
  /** Value submitted in the FormData. */
  value: string;
  /** i18n key (within the tool namespace) for the visible label. */
  labelKey: string;
}

/**
 * A single configurable option rendered above the action button. The `name`
 * is the FormData key; `labelKey`/`descriptionKey`/`placeholderKey` are i18n
 * keys within the tool's namespace.
 */
export interface ToolField {
  type: ToolFieldType;
  /** FormData field name sent to the endpoint. */
  name: string;
  /** i18n key for the field label. */
  labelKey: string;
  /** i18n key for an optional helper text under the field. */
  descriptionKey?: string;
  /** i18n key for an input placeholder (text/password). */
  placeholderKey?: string;
  /** Whether the request is blocked until this field has a value. */
  required?: boolean;
  /** Default value applied on mount (string fields / select / switch="true"). */
  defaultValue?: string;
  /** Options for `select`. */
  options?: ToolSelectOption[];
  /** `slider` bounds (inclusive). */
  min?: number;
  max?: number;
  step?: number;
  /** `file` accept attribute (e.g. ".p12,.pfx"). */
  accept?: string;
  /**
   * Optional mapping from the user-typed value to the exact wire value the
   * endpoint expects (e.g. turn "1-5, 6-10" into the JSON `["1-5","6-10"]`).
   * Applied just before the FormData is built. Return an empty string to omit
   * the field. Pure function — no side effects.
   */
  serialize?: (raw: string) => string;
}

/**
 * A constant FormData field always appended to the request (e.g. `action`,
 * `output`). Decouples the wire contract from user-facing options.
 */
export interface ToolConstantField {
  name: string;
  value: string;
}

/** Full description of a tool the {@link ToolRunner} can execute. */
export interface ToolConfig {
  /** Stable identifier (used for logging + React keys). */
  id: string;
  /** next-intl namespace holding this tool's strings (`tools.<id>`). */
  namespace: string;
  /** Lucide icon name resolved by the page header. */
  icon: string;
  /** Endpoint hit on submit. */
  endpoint: string;
  /**
   * Primary input descriptor. Omit for the historic file-dropzone tools; set
   * to a {@link ToolTextInput} for text/URL tools (e.g. text/HTML → PDF).
   */
  input?: ToolTextInput;
  /**
   * How the request is serialised. Omit for `formData` (default); set to
   * `json` for `/api/pdf/convert`, or `uploadExport` for the PDF→Office chain.
   */
  request?: ToolRequestSpec;
  /** One file or several. Required for file tools; ignored for text/URL tools. */
  uploadMode?: ToolUploadMode;
  /** Native picker accept hint. Required for file tools. */
  accept?: string;
  /**
   * FormData key holding the uploaded file(s). Single-file endpoints expect
   * `file`; multi-file endpoints expect `files` (repeated). Required for file
   * tools.
   */
  fileFieldName?: string;
  /** How to interpret the response. */
  responseKind: ToolResponseKind;
  /** Default output filename (used for the download + sensible fallback). */
  defaultOutputName: string;
  /** Whether to surface an editable "output file name" input. */
  allowOutputName: boolean;
  /** Per-tool option inputs. */
  fields: ToolField[];
  /** Always-sent constant fields. */
  constants?: ToolConstantField[];
  /** Total upload cap in bytes (mirrors the backend for instant feedback). */
  maxTotalBytes?: number;
}
