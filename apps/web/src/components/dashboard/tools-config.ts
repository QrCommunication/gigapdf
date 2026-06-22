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
    ],
  },

  unlock: {
    id: "unlock",
    namespace: "tools.unlock",
    icon: "unlock",
    endpoint: "/api/pdf/encrypt",
    uploadMode: "single",
    accept: ACCEPT_PDF,
    fileFieldName: "file",
    responseKind: "binary",
    defaultOutputName: "unlocked.pdf",
    allowOutputName: true,
    maxTotalBytes: MAX_250MB,
    constants: [{ name: "action", value: "decrypt" }],
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
    ],
  },
} satisfies Record<string, ToolConfig>;

/** Union of valid tool ids in the registry. */
export type ToolKey = keyof typeof TOOL_CONFIGS;

/** Look up a tool config by id (typed). */
export function getToolConfig(key: ToolKey): ToolConfig {
  return TOOL_CONFIGS[key];
}
