/**
 * Registry of the config-driven PDF tools backed by {@link ToolRunner}.
 *
 * Each entry maps a tool to an existing `/api/pdf/*` or `/api/office/*`
 * endpoint and declares its option fields. Adding a tool here + a thin page +
 * its i18n block is all that is required — no new component.
 *
 * The `id` of each config doubles as the next-intl sub-namespace under
 * `tools.<id>` (e.g. `tools.split.actionButton`).
 */

import type { ToolConfig } from "./tool-runner-types";

/** 100 MB, mirrors the multi-file backend cap. */
const MAX_100MB = 100 * 1024 * 1024;
/** 250 MB, mirrors the single-file backend cap (split/compress/convert…). */
const MAX_250MB = 250 * 1024 * 1024;

/** Accept hint for endpoints that take a single PDF. */
const ACCEPT_PDF = ".pdf,application/pdf";
/** Accept hint for raster images (image-to-pdf). */
const ACCEPT_IMAGES = ".png,.jpg,.jpeg,.gif,.webp,.avif,image/*";
/** Accept hint for office documents (office-to-pdf). */
const ACCEPT_OFFICE =
  ".doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp";
/** Accept hint for Rich Text Format files (rtf-to-pdf). */
const ACCEPT_RTF = ".rtf,application/rtf,text/rtf";

/** Session-upload endpoint that returns `{ data: { document_id } }`. */
const UPLOAD_ENDPOINT = "/api/v1/documents/upload";

/** Escape a string for safe interpolation into HTML text content. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wrap plain text in a minimal, print-friendly HTML document so the in-house
 * HTML→PDF engine renders it faithfully (monospace, wrapping preserved).
 * `/api/pdf/convert` only accepts HTML/URL, so text tools convert to HTML here.
 */
function plainTextToHtml(raw: string): string {
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><style>',
    "body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;font-size:12pt;line-height:1.5;color:#111}",
    "pre{margin:0;white-space:pre-wrap;word-wrap:break-word;font-family:inherit}",
    "</style></head><body><pre>",
    escapeHtml(raw),
    "</pre></body></html>",
  ].join("");
}

/** Shared page-size options for the HTML/text → PDF tools. */
const PAGE_SIZE_FIELD = {
  type: "select" as const,
  name: "format",
  labelKey: "formatLabel",
  defaultValue: "A4",
  options: [
    { value: "A4", labelKey: "formatA4" },
    { value: "Letter", labelKey: "formatLetter" },
    { value: "Legal", labelKey: "formatLegal" },
  ],
};

/** Shared orientation switch (coerced to a real boolean in JSON mode). */
const ORIENTATION_FIELD = {
  type: "switch" as const,
  name: "landscape",
  labelKey: "landscapeLabel",
  descriptionKey: "landscapeDescription",
  defaultValue: "false",
};

/** Shared margin preset (mapped to a CSS length the convert route accepts). */
const MARGIN_FIELD = {
  type: "select" as const,
  name: "margin",
  labelKey: "marginLabel",
  defaultValue: "20mm",
  options: [
    { value: "0", labelKey: "marginNone" },
    { value: "12mm", labelKey: "marginNarrow" },
    { value: "20mm", labelKey: "marginNormal" },
    { value: "30mm", labelKey: "marginWide" },
  ],
};

/**
 * Turn a human page-range expression ("1-5, 8, 10-12") into the JSON array
 * string the split endpoint expects (`["1-5","8","10-12"]`). Whitespace and
 * empty segments are ignored; an empty input yields "" (field omitted).
 */
function serializeRanges(raw: string): string {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? JSON.stringify(parts) : "";
}

/**
 * Turn a human page list ("1, 3, 5-7") into the flat JSON integer array the
 * `pages` extract operation expects (`[1,3,5,6,7]`). Invalid tokens are
 * dropped; an empty result yields "".
 */
function serializePageNumbers(raw: string): string {
  const pages: number[] = [];
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start >= 1 && end >= start) {
        for (let p = start; p <= end; p += 1) pages.push(p);
      }
      continue;
    }
    const single = Number(trimmed);
    if (Number.isInteger(single) && single >= 1) pages.push(single);
  }
  // De-duplicate while preserving order.
  const unique = [...new Set(pages)];
  return unique.length > 0 ? JSON.stringify(unique) : "";
}

export const TOOL_CONFIGS = {
  split: {
    id: "split",
    namespace: "tools.split",
    icon: "scissors",
    endpoint: "/api/pdf/split",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "splitZip",
    defaultOutputName: "split-parts.zip",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    fields: [
      {
        type: "text",
        name: "ranges",
        labelKey: "rangesLabel",
        descriptionKey: "rangesDescription",
        placeholderKey: "rangesPlaceholder",
        required: true,
        serialize: serializeRanges,
      },
    ],
  },

  compress: {
    id: "compress",
    namespace: "tools.compress",
    icon: "file-archive",
    endpoint: "/api/pdf/compress",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "compressed.pdf",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    fields: [],
  },

  watermark: {
    id: "watermark",
    namespace: "tools.watermark",
    icon: "stamp",
    endpoint: "/api/pdf/watermark",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "watermarked.pdf",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    fields: [
      {
        type: "text",
        name: "text",
        labelKey: "textLabel",
        placeholderKey: "textPlaceholder",
        required: true,
      },
      {
        type: "select",
        name: "position",
        labelKey: "positionLabel",
        defaultValue: "center-diagonal",
        options: [
          { value: "center-diagonal", labelKey: "positionCenterDiagonal" },
          { value: "top-left", labelKey: "positionTopLeft" },
          { value: "top-right", labelKey: "positionTopRight" },
          { value: "bottom-left", labelKey: "positionBottomLeft" },
          { value: "bottom-right", labelKey: "positionBottomRight" },
          { value: "header", labelKey: "positionHeader" },
          { value: "footer", labelKey: "positionFooter" },
        ],
      },
      {
        type: "slider",
        name: "opacity",
        labelKey: "opacityLabel",
        descriptionKey: "opacityDescription",
        defaultValue: "0.3",
        min: 0.05,
        max: 1,
        step: 0.05,
      },
    ],
  },

  protect: {
    id: "protect",
    namespace: "tools.protect",
    icon: "lock",
    endpoint: "/api/pdf/encrypt",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "protected.pdf",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "action", value: "encrypt" }],
    fields: [
      {
        type: "password",
        name: "userPassword",
        labelKey: "passwordLabel",
        descriptionKey: "passwordDescription",
        placeholderKey: "passwordPlaceholder",
        required: true,
      },
      {
        type: "select",
        name: "algorithm",
        labelKey: "algorithmLabel",
        defaultValue: "AES-256",
        options: [
          { value: "AES-256", labelKey: "algorithmAes256" },
          { value: "AES-128", labelKey: "algorithmAes128" },
        ],
      },
      // The eight ISO 32000-1 (Table 22) access permissions, each a switch that
      // defaults to "true" (granted) for backward compatibility — leaving them
      // untouched encrypts with every action allowed, as before. Turning one
      // off sends `<name>=false`; the encrypt route assembles these into the
      // `DocumentPermissions` object passed to the engine.
      {
        type: "switch",
        name: "print",
        labelKey: "permPrintLabel",
        descriptionKey: "permPrintDescription",
        defaultValue: "true",
      },
      {
        type: "switch",
        name: "modify",
        labelKey: "permModifyLabel",
        descriptionKey: "permModifyDescription",
        defaultValue: "true",
      },
      {
        type: "switch",
        name: "copy",
        labelKey: "permCopyLabel",
        descriptionKey: "permCopyDescription",
        defaultValue: "true",
      },
      {
        type: "switch",
        name: "annotate",
        labelKey: "permAnnotateLabel",
        descriptionKey: "permAnnotateDescription",
        defaultValue: "true",
      },
      {
        type: "switch",
        name: "fillForms",
        labelKey: "permFillFormsLabel",
        descriptionKey: "permFillFormsDescription",
        defaultValue: "true",
      },
      {
        type: "switch",
        name: "extract",
        labelKey: "permExtractLabel",
        descriptionKey: "permExtractDescription",
        defaultValue: "true",
      },
      {
        type: "switch",
        name: "assemble",
        labelKey: "permAssembleLabel",
        descriptionKey: "permAssembleDescription",
        defaultValue: "true",
      },
      {
        type: "switch",
        name: "printHighQuality",
        labelKey: "permPrintHighQualityLabel",
        descriptionKey: "permPrintHighQualityDescription",
        defaultValue: "true",
      },
    ],
  },

  unlock: {
    id: "unlock",
    namespace: "tools.unlock",
    icon: "unlock",
    // Dedicated single-responsibility endpoint: opens the PDF with the password
    // and strips the encryption via GigaPdfDoc.removeEncryption() (a guaranteed
    // plaintext document), rather than the multi-action /api/pdf/encrypt route.
    endpoint: "/api/pdf/unlock",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "unlocked.pdf",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    fields: [
      {
        type: "password",
        name: "password",
        labelKey: "passwordLabel",
        descriptionKey: "passwordDescription",
        placeholderKey: "passwordPlaceholder",
        required: true,
      },
    ],
  },

  "extract-pages": {
    id: "extract-pages",
    namespace: "tools.extractPages",
    icon: "file-stack",
    endpoint: "/api/pdf/pages",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "extracted.pdf",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "operation", value: "extract" }],
    fields: [
      {
        type: "text",
        name: "params",
        labelKey: "pagesLabel",
        descriptionKey: "pagesDescription",
        placeholderKey: "pagesPlaceholder",
        required: true,
        // The `extract` operation reads { pageNumbers } from params.
        serialize: (raw) => {
          const list = serializePageNumbers(raw);
          return list ? JSON.stringify({ pageNumbers: JSON.parse(list) }) : "";
        },
      },
    ],
  },

  "image-to-pdf": {
    id: "image-to-pdf",
    namespace: "tools.imageToPdf",
    icon: "images",
    endpoint: "/api/pdf/image-to-pdf",
    uploadMode: "multiple",
    accept: ACCEPT_IMAGES,
    fileFieldName: "files",
    responseKind: "binary",
    defaultOutputName: "images.pdf",
    allowOutputName: true,
    maxTotalBytes: MAX_100MB,
    fields: [],
  },

  "pdf-to-image": {
    id: "pdf-to-image",
    namespace: "tools.pdfToImage",
    icon: "image",
    endpoint: "/api/pdf/to-image",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "pages.zip",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    fields: [
      {
        type: "select",
        name: "scale",
        labelKey: "scaleLabel",
        descriptionKey: "scaleDescription",
        defaultValue: "2",
        options: [
          { value: "1", labelKey: "scaleStandard" },
          { value: "2", labelKey: "scaleHigh" },
          { value: "3", labelKey: "scaleVeryHigh" },
        ],
      },
    ],
  },

  "office-to-pdf": {
    id: "office-to-pdf",
    namespace: "tools.officeToPdf",
    icon: "file-input",
    endpoint: "/api/office/upload",
    uploadMode: "single",
    accept: ACCEPT_OFFICE,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "converted.pdf",
    allowOutputName: false,
    maxTotalBytes: MAX_250MB,
    fields: [],
  },

  // RTF → PDF: the same /api/office/upload endpoint accepts Rich Text Format
  // and renders it through the engine's dedicated RTF parser (rtfToPdf), not
  // the Office converter. Backs the SEO "/rtf-pdf" tool page.
  "rtf-to-pdf": {
    id: "rtf-to-pdf",
    namespace: "tools.rtfToPdf",
    icon: "file-type",
    endpoint: "/api/office/upload",
    uploadMode: "single",
    accept: ACCEPT_RTF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "converted.pdf",
    allowOutputName: false,
    maxTotalBytes: MAX_250MB,
    fields: [],
  },

  ocr: {
    id: "ocr",
    namespace: "tools.ocr",
    icon: "scan-text",
    endpoint: "/api/pdf/ocr",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "searchable.pdf",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "output", value: "searchable" }],
    fields: [
      {
        type: "select",
        name: "lang",
        labelKey: "languageLabel",
        descriptionKey: "languageDescription",
        defaultValue: "fra+eng",
        options: [
          { value: "fra+eng", labelKey: "languageFraEng" },
          { value: "fra", labelKey: "languageFra" },
          { value: "eng", labelKey: "languageEng" },
          { value: "deu", labelKey: "languageDeu" },
          { value: "spa", labelKey: "languageSpa" },
          { value: "ita", labelKey: "languageIta" },
        ],
      },
      {
        type: "switch",
        name: "handwriting",
        labelKey: "handwritingLabel",
        descriptionKey: "handwritingDescription",
        defaultValue: "false",
      },
    ],
  },

  "pdf-a": {
    id: "pdf-a",
    namespace: "tools.pdfA",
    icon: "file-archive",
    endpoint: "/api/pdf/pdfa",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "archive.pdf",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    fields: [
      {
        type: "select",
        name: "variant",
        labelKey: "variantLabel",
        descriptionKey: "variantDescription",
        defaultValue: "pdfa-2u",
        options: [
          { value: "pdfa-2u", labelKey: "variant2u" },
          { value: "pdfa-2b", labelKey: "variant2b" },
          { value: "pdfa-1b", labelKey: "variant1b" },
          { value: "pdfa-1a", labelKey: "variant1a" },
          { value: "pdfa-3b", labelKey: "variant3b" },
        ],
      },
    ],
  },

  sign: {
    id: "sign",
    namespace: "tools.sign",
    icon: "file-signature",
    endpoint: "/api/pdf/sign",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "signed.pdf",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    fields: [
      {
        type: "file",
        name: "p12",
        labelKey: "certLabel",
        descriptionKey: "certDescription",
        accept: ".p12,.pfx",
        required: true,
      },
      {
        type: "password",
        name: "passphrase",
        labelKey: "passphraseLabel",
        descriptionKey: "passphraseDescription",
        placeholderKey: "passphrasePlaceholder",
      },
      {
        type: "text",
        name: "reason",
        labelKey: "reasonLabel",
        placeholderKey: "reasonPlaceholder",
      },
      {
        type: "text",
        name: "location",
        labelKey: "locationLabel",
        placeholderKey: "locationPlaceholder",
      },
      {
        type: "switch",
        name: "timestamp",
        labelKey: "timestampLabel",
        descriptionKey: "timestampDescription",
        defaultValue: "false",
      },
      {
        // Long-term validation (PAdES-B-LT): adds a /DSS with the chain +
        // OCSP/CRL revocation material. The route gives `ltv` precedence over
        // `timestamp` and LTV always embeds a B-T timestamp, so enabling this
        // forces timestamping regardless of the toggle above.
        type: "switch",
        name: "ltv",
        labelKey: "ltvLabel",
        descriptionKey: "ltvDescription",
        defaultValue: "false",
      },
    ],
  },

  // ── Text / HTML → PDF (in-house HTML→PDF engine, JSON to /api/pdf/convert) ──

  "text-to-pdf": {
    id: "text-to-pdf",
    namespace: "tools.textToPdf",
    icon: "file-text",
    endpoint: "/api/pdf/convert",
    request: { kind: "json" },
    input: {
      kind: "text",
      valueField: "html",
      labelKey: "inputLabel",
      placeholderKey: "inputPlaceholder",
      descriptionKey: "inputDescription",
      rows: 14,
      maxLength: 500_000,
      transform: plainTextToHtml,
    },
    responseKind: "binary",
    defaultOutputName: "document.pdf",
    allowOutputName: true,
    constants: [{ name: "source", value: "html" }],
    fields: [PAGE_SIZE_FIELD, ORIENTATION_FIELD, MARGIN_FIELD],
  },

  "html-to-pdf": {
    id: "html-to-pdf",
    namespace: "tools.htmlToPdf",
    icon: "file-code",
    endpoint: "/api/pdf/convert",
    request: { kind: "json" },
    input: {
      kind: "text",
      valueField: "html",
      labelKey: "inputLabel",
      placeholderKey: "inputPlaceholder",
      descriptionKey: "inputDescription",
      rows: 16,
      maxLength: 2_000_000,
    },
    responseKind: "binary",
    defaultOutputName: "page.pdf",
    allowOutputName: true,
    constants: [{ name: "source", value: "html" }],
    fields: [PAGE_SIZE_FIELD, ORIENTATION_FIELD, MARGIN_FIELD],
  },

  // ── PDF → Office (upload session document, then export — two-step chain) ──

  "pdf-to-word": {
    id: "pdf-to-word",
    namespace: "tools.pdfToWord",
    icon: "file-type",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.docx",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "docx" }],
    fields: [],
  },

  "pdf-to-excel": {
    id: "pdf-to-excel",
    namespace: "tools.pdfToExcel",
    icon: "file-spreadsheet",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.xlsx",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "xlsx" }],
    fields: [],
  },

  "pdf-to-powerpoint": {
    id: "pdf-to-powerpoint",
    namespace: "tools.pdfToPowerpoint",
    icon: "presentation",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.pptx",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "pptx" }],
    fields: [],
  },

  "pdf-to-odt": {
    id: "pdf-to-odt",
    namespace: "tools.pdfToOdt",
    icon: "file-text",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.odt",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "odt" }],
    fields: [],
  },

  "pdf-to-ods": {
    id: "pdf-to-ods",
    namespace: "tools.pdfToOds",
    icon: "table",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.ods",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    // The export route maps `xlsx` through its tabular extractor; ODS shares the
    // OOXML spreadsheet shape, so the engine emits an OpenDocument spreadsheet.
    constants: [{ name: "format", value: "ods" }],
    fields: [],
  },

  "pdf-to-odp": {
    id: "pdf-to-odp",
    namespace: "tools.pdfToOdp",
    icon: "presentation",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.odp",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "odp" }],
    fields: [],
  },

  "pdf-to-html": {
    id: "pdf-to-html",
    namespace: "tools.pdfToHtml",
    icon: "globe",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.html",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "html" }],
    fields: [],
  },

  "pdf-to-rtf": {
    id: "pdf-to-rtf",
    namespace: "tools.pdfToRtf",
    icon: "file-type",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.rtf",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "rtf" }],
    fields: [],
  },

  "pdf-to-text": {
    id: "pdf-to-text",
    namespace: "tools.pdfToText",
    icon: "file-text",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.txt",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "txt" }],
    fields: [],
  },

  "pdf-to-markdown": {
    id: "pdf-to-markdown",
    namespace: "tools.pdfToMarkdown",
    icon: "file-text",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.md",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "markdown" }],
    fields: [],
  },

  "pdf-to-csv": {
    id: "pdf-to-csv",
    namespace: "tools.pdfToCsv",
    icon: "file-spreadsheet",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.csv",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "csv" }],
    fields: [],
  },

  "pdf-to-epub": {
    id: "pdf-to-epub",
    namespace: "tools.pdfToEpub",
    icon: "book-open",
    endpoint: "/api/office/export",
    request: {
      kind: "uploadExport",
      uploadExport: { uploadEndpoint: UPLOAD_ENDPOINT },
    },
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.epub",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "format", value: "epub" }],
    fields: [],
  },

  // ── Text imports → PDF (plain UTF-8 sources, no upload session needed) ──
  // Both post the raw file to /api/convert/text-format, which runs the engine's
  // mdToModel / csvToModel → modelToPdf pipeline and returns the PDF binary.

  "csv-to-pdf": {
    id: "csv-to-pdf",
    namespace: "tools.csvToPdf",
    icon: "file-spreadsheet",
    endpoint: "/api/convert/text-format",
    uploadMode: "single",
    accept: ".csv,text/csv",
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.pdf",
    allowOutputName: false,
    maxTotalBytes: MAX_250MB,
    fields: [],
  },

  "markdown-to-pdf": {
    id: "markdown-to-pdf",
    namespace: "tools.markdownToPdf",
    icon: "file-text",
    endpoint: "/api/convert/text-format",
    uploadMode: "single",
    accept: ".md,.markdown,text/markdown",
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "document.pdf",
    allowOutputName: false,
    maxTotalBytes: MAX_250MB,
    fields: [],
  },
} satisfies Record<string, ToolConfig>;

/** Union of valid tool ids in the registry. */
export type ToolKey = keyof typeof TOOL_CONFIGS;

/** Look up a tool config by id (typed). */
export function getToolConfig(key: ToolKey): ToolConfig {
  return TOOL_CONFIGS[key];
}
