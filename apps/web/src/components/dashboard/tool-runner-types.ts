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
  /** One file or several. */
  uploadMode: ToolUploadMode;
  /** Native picker accept hint. */
  accept: string;
  /**
   * FormData key holding the uploaded file(s). Single-file endpoints expect
   * `file`; multi-file endpoints expect `files` (repeated). Defaults applied
   * by config authors.
   */
  fileFieldName: string;
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
  maxTotalBytes: number;
}
