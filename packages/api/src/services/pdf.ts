import type {
  DocumentObject,
  DocumentMetadata,
  FormFieldElement,
} from '@giga-pdf/types';

/**
 * Response wrapper for PDF API routes
 */
interface PdfApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Options for opening/parsing a PDF
 */
interface OpenPdfOptions {
  password?: string;
  extractText?: boolean;
  extractImages?: boolean;
  extractAnnotations?: boolean;
  extractFormFields?: boolean;
}

/**
 * Parsed document response from /api/pdf/open
 */
interface OpenPdfResult {
  documentId: string;
  pageCount: number;
  metadata: DocumentObject['metadata'];
  pages: DocumentObject['pages'];
  bookmarks: DocumentObject['outlines'];
  layers: DocumentObject['layers'];
  embeddedFiles: DocumentObject['embeddedFiles'];
  filename: string;
  fileSize: number;
}

/**
 * Options for saving/normalizing a PDF
 */
interface SavePdfOptions {
  garbage?: 0 | 1 | 2 | 3 | 4;
  useObjectStreams?: boolean;
}

/**
 * Options for merging PDFs
 */
interface MergePdfOptions {
  ranges?: string[];
  outputName?: string;
}

/**
 * Split result part
 */
interface SplitPart {
  filename: string;
  pageCount: number | null;
  data: string; // base64
}

/**
 * Options for splitting a PDF
 */
interface SplitPdfOptions {
  splitPoints?: number[];
  ranges?: string[];
  outputNames?: string[];
}

/**
 * Split result
 */
interface SplitPdfResult {
  originalFilename: string;
  partsCount: number;
  parts: SplitPart[];
}

/**
 * Preview options
 */
interface PreviewOptions {
  mode?: 'page' | 'thumbnail' | 'all';
  pageNumber?: number;
  dpi?: number;
  scale?: number;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Thumbnail data from "all" mode
 */
interface ThumbnailData {
  pageNumber: number;
  data: string; // base64
  mimeType: string;
}

/**
 * All-thumbnails result
 */
interface AllThumbnailsResult {
  format: string;
  count: number;
  thumbnails: ThumbnailData[];
}

/**
 * Encrypt options
 */
interface EncryptOptions {
  userPassword?: string;
  ownerPassword?: string;
  algorithm?: 'AES-128' | 'AES-256';
  permissions?: Record<string, boolean>;
}

/**
 * Permissions result
 */
interface PermissionsResult {
  isEncrypted: boolean;
  permissions: Record<string, boolean>;
}

/**
 * Form field info from get action
 */
interface FormFieldsResult {
  fields: FormFieldElement[];
  totalFields: number;
  filledFields: number;
}

/**
 * Text/Image/Shape element operation options
 */
interface ElementOperationOptions {
  operation: 'add' | 'update';
  pageNumber: number;
  element: Record<string, unknown>;
  oldBounds?: { x: number; y: number; width: number; height: number };
}

/**
 * Convert options
 */
interface ConvertOptions {
  html?: string;
  url?: string;
  format?: string;
  landscape?: boolean;
  pageSize?: string;
  margin?: string;
}

/**
 * Metadata result
 */
interface MetadataResult {
  metadata: DocumentMetadata;
}

/**
 * Flatten options
 */
interface FlattenOptions {
  flattenAnnotations?: boolean;
  flattenForms?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAuthHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleJsonResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as PdfApiResponse<T>;
  if (!json.success) {
    throw new Error(json.error ?? 'PDF operation failed');
  }
  return json.data as T;
}

async function handleBlobResponse(response: Response): Promise<Blob> {
  if (!response.ok) {
    const json = (await response.json()) as PdfApiResponse;
    throw new Error(json.error ?? `HTTP ${response.status}`);
  }
  return response.blob();
}

function appendFileToForm(form: FormData, file: File | Blob, fieldName = 'file'): void {
  if (file instanceof File) {
    form.append(fieldName, file);
  } else {
    form.append(fieldName, file, 'document.pdf');
  }
}

// ─── PDF Service ─────────────────────────────────────────────────────────────

export const pdfService = {
  /**
   * Parse/open a PDF and return full document structure
   */
  openPdf: async (file: File | Blob, options: OpenPdfOptions = {}): Promise<OpenPdfResult> => {
    const form = new FormData();
    appendFileToForm(form, file);

    if (options.password) form.append('password', options.password);
    if (options.extractText === false) form.append('extractText', 'false');
    if (options.extractImages === false) form.append('extractImages', 'false');
    if (options.extractAnnotations === false) form.append('extractAnnotations', 'false');
    if (options.extractFormFields === false) form.append('extractFormFields', 'false');

    const response = await fetch('/api/pdf/open', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleJsonResponse<OpenPdfResult>(response);
  },

  /**
   * Save/normalize a PDF with optional compaction
   */
  savePdf: async (file: File | Blob, options: SavePdfOptions = {}): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);

    if (options.garbage !== undefined) form.append('garbage', String(options.garbage));
    if (options.useObjectStreams !== undefined) form.append('useObjectStreams', String(options.useObjectStreams));

    const response = await fetch('/api/pdf/save', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Merge multiple PDFs into one
   */
  mergePdfs: async (files: File[], options: MergePdfOptions = {}): Promise<Blob> => {
    const form = new FormData();
    for (const file of files) {
      form.append('files[]', file);
    }

    if (options.ranges) {
      for (const range of options.ranges) {
        form.append('ranges[]', range);
      }
    }
    if (options.outputName) form.append('outputName', options.outputName);

    const response = await fetch('/api/pdf/merge', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Split a PDF into multiple parts
   */
  splitPdf: async (file: File | Blob, options: SplitPdfOptions): Promise<SplitPdfResult> => {
    const form = new FormData();
    appendFileToForm(form, file);

    if (options.splitPoints) form.append('splitPoints', JSON.stringify(options.splitPoints));
    if (options.ranges) form.append('ranges', JSON.stringify(options.ranges));
    if (options.outputNames) form.append('outputNames', JSON.stringify(options.outputNames));

    const response = await fetch('/api/pdf/split', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleJsonResponse<SplitPdfResult>(response);
  },

  /**
   * Render page preview or thumbnails
   */
  previewPage: async (file: File | Blob, options: PreviewOptions = {}): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);

    const mode = options.mode ?? 'page';
    form.append('mode', mode);

    if (options.pageNumber !== undefined) form.append('pageNumber', String(options.pageNumber));
    if (options.dpi !== undefined) form.append('dpi', String(options.dpi));
    if (options.scale !== undefined) form.append('scale', String(options.scale));
    if (options.format) form.append('format', options.format);
    if (options.quality !== undefined) form.append('quality', String(options.quality));
    if (options.maxWidth !== undefined) form.append('maxWidth', String(options.maxWidth));
    if (options.maxHeight !== undefined) form.append('maxHeight', String(options.maxHeight));

    const response = await fetch('/api/pdf/preview', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Render all page thumbnails (returns base64 data)
   */
  previewAllThumbnails: async (
    file: File | Blob,
    options: Omit<PreviewOptions, 'mode' | 'pageNumber'> = {},
  ): Promise<AllThumbnailsResult> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('mode', 'all');

    if (options.format) form.append('format', options.format);
    if (options.quality !== undefined) form.append('quality', String(options.quality));
    if (options.maxWidth !== undefined) form.append('maxWidth', String(options.maxWidth));
    if (options.maxHeight !== undefined) form.append('maxHeight', String(options.maxHeight));

    const response = await fetch('/api/pdf/preview', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleJsonResponse<AllThumbnailsResult>(response);
  },

  /**
   * Encrypt a PDF
   */
  encryptPdf: async (file: File | Blob, options: EncryptOptions): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('action', 'encrypt');

    if (options.userPassword) form.append('userPassword', options.userPassword);
    if (options.ownerPassword) form.append('ownerPassword', options.ownerPassword);
    if (options.algorithm) form.append('algorithm', options.algorithm);
    if (options.permissions) form.append('permissions', JSON.stringify(options.permissions));

    const response = await fetch('/api/pdf/encrypt', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Decrypt a PDF
   */
  decryptPdf: async (file: File | Blob, password: string): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('action', 'decrypt');
    form.append('password', password);

    const response = await fetch('/api/pdf/encrypt', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Get PDF permissions
   */
  getPermissions: async (file: File | Blob): Promise<PermissionsResult> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('action', 'getPermissions');

    const response = await fetch('/api/pdf/encrypt', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleJsonResponse<PermissionsResult>(response);
  },

  /**
   * Set PDF permissions
   */
  setPermissions: async (
    file: File | Blob,
    ownerPassword: string,
    permissions: Record<string, boolean>,
  ): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('action', 'setPermissions');
    form.append('ownerPassword', ownerPassword);
    form.append('permissions', JSON.stringify(permissions));

    const response = await fetch('/api/pdf/encrypt', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Get form fields from a PDF
   */
  getFormFields: async (file: File | Blob): Promise<FormFieldsResult> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('action', 'get');

    const response = await fetch('/api/pdf/forms', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleJsonResponse<FormFieldsResult>(response);
  },

  /**
   * Fill form fields in a PDF
   */
  fillFormFields: async (
    file: File | Blob,
    values: Record<string, string | boolean | string[]>,
  ): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('action', 'fill');
    form.append('values', JSON.stringify(values));

    const response = await fetch('/api/pdf/forms', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Add a form field to a PDF
   */
  addFormField: async (
    file: File | Blob,
    pageNumber: number,
    field: FormFieldElement,
  ): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('action', 'create');
    form.append('pageNumber', String(pageNumber));
    form.append('field', JSON.stringify(field));

    const response = await fetch('/api/pdf/forms', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Add/update text element on a PDF page
   */
  textOperation: async (file: File | Blob, options: ElementOperationOptions): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('operation', options.operation);
    form.append('pageNumber', String(options.pageNumber));
    form.append('element', JSON.stringify(options.element));
    if (options.oldBounds) form.append('oldBounds', JSON.stringify(options.oldBounds));

    const response = await fetch('/api/pdf/text', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Add/update image element on a PDF page
   */
  imageOperation: async (file: File | Blob, options: ElementOperationOptions): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('operation', options.operation);
    form.append('pageNumber', String(options.pageNumber));
    form.append('element', JSON.stringify(options.element));
    if (options.oldBounds) form.append('oldBounds', JSON.stringify(options.oldBounds));

    const response = await fetch('/api/pdf/image', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Add/update shape element on a PDF page
   */
  shapeOperation: async (file: File | Blob, options: ElementOperationOptions): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('operation', options.operation);
    form.append('pageNumber', String(options.pageNumber));
    form.append('element', JSON.stringify(options.element));
    if (options.oldBounds) form.append('oldBounds', JSON.stringify(options.oldBounds));

    const response = await fetch('/api/pdf/shape', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Add/update annotation on a PDF page
   */
  annotationOperation: async (file: File | Blob, options: ElementOperationOptions): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('operation', options.operation);
    form.append('pageNumber', String(options.pageNumber));
    form.append('element', JSON.stringify(options.element));
    if (options.oldBounds) form.append('oldBounds', JSON.stringify(options.oldBounds));

    const response = await fetch('/api/pdf/annotations', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Page operations (extract, rotate, delete, reorder)
   *
   * Backend contract (/api/pdf/pages):
   *   - operation: 'add' | 'delete' | 'move' | 'rotate' | 'copy' | 'resize' | 'extract'
   *   - params: JSON-stringified operation-specific parameters
   */
  pageOperation: async (
    file: File | Blob,
    operation: string,
    params: Record<string, unknown> = {},
  ): Promise<Blob | Record<string, unknown>> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('operation', operation);
    form.append('params', JSON.stringify(params));

    const response = await fetch('/api/pdf/pages', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/pdf')) {
      return handleBlobResponse(response);
    }
    return handleJsonResponse<Record<string, unknown>>(response);
  },

  /**
   * Get or update PDF metadata
   */
  metadata: async (
    file: File | Blob,
    action: 'get' | 'set',
    metadata?: Partial<DocumentMetadata>,
  ): Promise<MetadataResult | Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('action', action);
    if (metadata) form.append('metadata', JSON.stringify(metadata));

    const response = await fetch('/api/pdf/metadata', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    if (action === 'get') {
      return handleJsonResponse<MetadataResult>(response);
    }
    return handleBlobResponse(response);
  },

  /**
   * Flatten PDF layers (annotations, forms)
   */
  flattenPdf: async (file: File | Blob, options: FlattenOptions = {}): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);

    if (options.flattenAnnotations !== undefined) form.append('flattenAnnotations', String(options.flattenAnnotations));
    if (options.flattenForms !== undefined) form.append('flattenForms', String(options.flattenForms));

    const response = await fetch('/api/pdf/flatten', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Apply an ordered list of element operations (add, update, delete) to a PDF
   * and return the modified PDF binary as a Blob.
   */
  applyElements: async (
    file: File | Blob,
    operations: Array<{
      action: 'add' | 'update' | 'delete' | 'reorder';
      pageNumber: number;
      element: Record<string, unknown>;
      oldBounds?: { x: number; y: number; width: number; height: number };
      reorder?: { toFront: boolean };
    }>,
  ): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('operations', JSON.stringify(operations));

    const response = await fetch('/api/pdf/apply-elements', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Convert HTML to PDF
   */
  convertToPdf: async (options: ConvertOptions): Promise<Blob> => {
    const form = new FormData();

    if (options.html) form.append('html', options.html);
    if (options.url) form.append('url', options.url);
    if (options.format) form.append('format', options.format);
    if (options.landscape !== undefined) form.append('landscape', String(options.landscape));
    if (options.pageSize) form.append('pageSize', options.pageSize);
    if (options.margin) form.append('margin', options.margin);

    const response = await fetch('/api/pdf/convert', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    return handleBlobResponse(response);
  },

  /**
   * Full-text search in a PDF via the engine. Returns a list of hits with
   * PDF user-space quads ready for frontend highlighting.
   */
  searchPdf: async (
    file: File | Blob,
    needle: string,
    options: { pages?: number[]; maxHitsPerPage?: number } = {},
  ): Promise<{
    needle: string;
    totalHits: number;
    pagesSearched: number;
    hits: Array<{
      pageNumber: number;
      matchIndex: number;
      quads: number[][];
      bbox: [number, number, number, number];
    }>;
  }> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('needle', needle);
    if (options.pages) form.append('pages', JSON.stringify(options.pages));
    if (options.maxHitsPerPage !== undefined) {
      form.append('maxHitsPerPage', String(options.maxHitsPerPage));
    }

    const response = await fetch('/api/pdf/search', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`Search failed: HTTP ${response.status} ${err}`);
    }
    return response.json();
  },

  /**
   * Stamp a watermark on every page (or selected pages) of a PDF.
   */
  addWatermark: async (
    file: File | Blob,
    options: {
      text: string;
      position?:
        | 'center-diagonal'
        | 'top-left'
        | 'top-right'
        | 'bottom-left'
        | 'bottom-right'
        | 'header'
        | 'footer'
        | 'custom';
      pages?: number[];
      fontSize?: number;
      color?: [number, number, number];
      opacity?: number;
      custom?: { x: number; y: number; rotation: number };
    },
  ): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('text', options.text);
    if (options.position) form.append('position', options.position);
    if (options.pages) form.append('pages', JSON.stringify(options.pages));
    if (options.fontSize !== undefined) form.append('fontSize', String(options.fontSize));
    if (options.color) form.append('color', JSON.stringify(options.color));
    if (options.opacity !== undefined) form.append('opacity', String(options.opacity));
    if (options.custom) form.append('custom', JSON.stringify(options.custom));

    const response = await fetch('/api/pdf/watermark', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });
    return handleBlobResponse(response);
  },

  /**
   * Sign a PDF with a PKCS#7 detached signature (adbe.pkcs7.detached) using
   * a user-provided PKCS#12 (.p12/.pfx) certificate.
   *
   * SECURITY: the certificate and passphrase transit only inside this
   * request body — they are never stored, cached, or logged anywhere.
   *
   * Throws an Error whose `name` is `'InvalidCertificateError'` when the
   * server rejects the certificate/passphrase pair, so callers can show a
   * dedicated i18n message without parsing server strings.
   */
  signPdf: async (
    file: File | Blob,
    p12File: File | Blob,
    passphrase: string,
    options: {
      reason?: string;
      location?: string;
      contactInfo?: string;
      signerName?: string;
    } = {},
  ): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    appendFileToForm(form, p12File, 'p12');
    form.append('passphrase', passphrase);
    if (options.reason) form.append('reason', options.reason);
    if (options.location) form.append('location', options.location);
    if (options.contactInfo) form.append('contactInfo', options.contactInfo);
    if (options.signerName) form.append('signerName', options.signerName);

    const response = await fetch('/api/pdf/sign', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });
    if (!response.ok) {
      const json = (await response
        .json()
        .catch(() => ({}))) as PdfApiResponse & { code?: string };
      const error = new Error(json.error ?? `HTTP ${response.status}`);
      if (json.code === 'INVALID_CERTIFICATE_OR_PASSPHRASE') {
        error.name = 'InvalidCertificateError';
      }
      throw error;
    }
    return response.blob();
  },

  /**
   * Run OCR on each rasterised page (verified by GET /api/pdf/ocr).
   */
  ocrPdf: async (
    file: File | Blob,
    options: {
      pages?: number[];
      lang?: string;
      dpi?: 144 | 200 | 300;
      format?: 'text' | 'hocr';
    } = {},
  ): Promise<{
    pages: Array<{ pageNumber: number; text: string; hocr?: string }>;
    fullText: string;
  }> => {
    const form = new FormData();
    appendFileToForm(form, file);
    if (options.pages) form.append('pages', JSON.stringify(options.pages));
    if (options.lang) form.append('lang', options.lang);
    if (options.dpi) form.append('dpi', String(options.dpi));
    if (options.format) form.append('format', options.format);

    const response = await fetch('/api/pdf/ocr', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`OCR failed: HTTP ${response.status} ${err}`);
    }
    return response.json();
  },

  /**
   * Check if OCR is available on the server. Used by the UI to
   * enable/disable the OCR button.
   */
  isOcrAvailable: async (): Promise<boolean> => {
    const response = await fetch('/api/pdf/ocr', {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data?.available);
  },

  /**
   * Compress a PDF (native normalisation + garbage collection / compression).
   * Returns the compressed binary plus the before/after sizes reported by
   * the route headers (X-Original-Size / X-Compressed-Size).
   */
  compressPdf: async (file: File | Blob): Promise<CompressPdfResult> => {
    const form = new FormData();
    appendFileToForm(form, file);

    const response = await fetch('/api/pdf/compress', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    const blob = await handleBlobResponse(response);
    const originalHeader = Number(response.headers.get('X-Original-Size'));
    const compressedHeader = Number(response.headers.get('X-Compressed-Size'));

    return {
      blob,
      originalSize:
        Number.isFinite(originalHeader) && originalHeader > 0
          ? originalHeader
          : file.size,
      compressedSize:
        Number.isFinite(compressedHeader) && compressedHeader > 0
          ? compressedHeader
          : blob.size,
    };
  },

  /**
   * Run OCR and bake an INVISIBLE text layer into the PDF so it becomes
   * searchable/selectable (output="searchable" on /api/pdf/ocr). Only
   * pages without extractable text are processed unless force=true.
   */
  makeSearchablePdf: async (
    file: File | Blob,
    options: {
      lang?: string;
      dpi?: 144 | 200 | 300;
      force?: boolean;
      /**
       * Bundled OCR scripts (writing systems) to load, e.g. ['alpha'] for
       * Latin/Cyrillic or ['cjk'] for Chinese. Omit to load every bundled
       * model (auto-detection). See OcrScript in @giga-pdf/pdf-engine.
       */
      scripts?: string[];
      /**
       * Opt-in handwriting recognition for Latin scripts. Loads the cursive
       * Latin model in addition to the printed recognizers. Latin only; never
       * auto-detected. Defaults to printed text.
       */
      handwriting?: boolean;
      /**
       * Restrict OCR to a contiguous 1-based page range (inclusive), e.g.
       * `{ from: 3, to: 3 }` for the "current page only" scope. Omit to OCR the
       * whole document (default).
       */
      pageRange?: { from: number; to: number };
    } = {},
  ): Promise<SearchablePdfResult> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('output', 'searchable');
    if (options.lang) form.append('lang', options.lang);
    if (options.dpi) form.append('dpi', String(options.dpi));
    if (options.force) form.append('force', 'true');
    if (options.scripts && options.scripts.length > 0) {
      form.append('scripts', JSON.stringify(options.scripts));
    }
    if (options.handwriting) form.append('handwriting', 'true');
    if (options.pageRange) form.append('pageRange', JSON.stringify(options.pageRange));

    const response = await fetch('/api/pdf/ocr', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    const blob = await handleBlobResponse(response);
    const pagesProcessed = Number(response.headers.get('X-Ocr-Pages-Processed'));
    const wordsAdded = Number(response.headers.get('X-Ocr-Words-Added'));

    return {
      blob,
      pagesProcessed: Number.isFinite(pagesProcessed) ? pagesProcessed : 0,
      wordsAdded: Number.isFinite(wordsAdded) ? wordsAdded : 0,
    };
  },

  /**
   * Run OCR and produce an EDITABLE PDF (output="editable" on /api/pdf/ocr):
   * each scanned text zone is masked with its local background colour and a
   * real, visible OCR text run is laid on top — so the recognized text can be
   * edited in the editor without the scanned image showing through. Only pages
   * without extractable text are processed unless force=true.
   */
  makeEditableOcrPdf: async (
    file: File | Blob,
    options: {
      lang?: string;
      dpi?: 144 | 200 | 300;
      force?: boolean;
      /**
       * Bundled OCR scripts (writing systems) to load, e.g. ['alpha'] for
       * Latin/Cyrillic or ['cjk'] for Chinese. Omit to load every bundled
       * model (auto-detection). See OcrScript in @giga-pdf/pdf-engine.
       */
      scripts?: string[];
      /**
       * Opt-in handwriting recognition for Latin scripts. Loads the cursive
       * Latin model in addition to the printed recognizers. Latin only; never
       * auto-detected. Defaults to printed text.
       */
      handwriting?: boolean;
      /**
       * Restrict OCR to a contiguous 1-based page range (inclusive), e.g.
       * `{ from: 3, to: 3 }` for the "current page only" scope. Omit to OCR the
       * whole document (default).
       */
      pageRange?: { from: number; to: number };
    } = {},
  ): Promise<EditableOcrPdfResult> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('output', 'editable');
    if (options.lang) form.append('lang', options.lang);
    if (options.dpi) form.append('dpi', String(options.dpi));
    if (options.force) form.append('force', 'true');
    if (options.scripts && options.scripts.length > 0) {
      form.append('scripts', JSON.stringify(options.scripts));
    }
    if (options.handwriting) form.append('handwriting', 'true');
    if (options.pageRange) form.append('pageRange', JSON.stringify(options.pageRange));

    const response = await fetch('/api/pdf/ocr', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    const blob = await handleBlobResponse(response);
    const pagesProcessed = Number(response.headers.get('X-Ocr-Pages-Processed'));
    const wordsAdded = Number(response.headers.get('X-Ocr-Words-Added'));
    const masksAdded = Number(response.headers.get('X-Ocr-Masks-Added'));

    return {
      blob,
      pagesProcessed: Number.isFinite(pagesProcessed) ? pagesProcessed : 0,
      wordsAdded: Number.isFinite(wordsAdded) ? wordsAdded : 0,
      masksAdded: Number.isFinite(masksAdded) ? masksAdded : 0,
    };
  },

  /**
   * Convert a PDF to PDF/A (archival format).
   */
  convertToPdfA: async (
    file: File | Blob,
    variant: 'pdfa-1b' | 'pdfa-1a' | 'pdfa-2b' | 'pdfa-2u' | 'pdfa-3b' = 'pdfa-2u',
  ): Promise<Blob> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('variant', variant);

    const response = await fetch('/api/pdf/pdfa', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });
    return handleBlobResponse(response);
  },
};

/**
 * Result of compressPdf — compressed binary + before/after sizes (bytes).
 */
export interface CompressPdfResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
}

/**
 * Result of makeSearchablePdf — PDF with invisible OCR text layer.
 */
export interface SearchablePdfResult {
  blob: Blob;
  pagesProcessed: number;
  wordsAdded: number;
}

/**
 * Result of makeEditableOcrPdf — PDF whose scanned text zones are masked and
 * overlaid with real, editable OCR text.
 */
export interface EditableOcrPdfResult {
  blob: Blob;
  pagesProcessed: number;
  wordsAdded: number;
  /** Number of background masks painted (one per recognized line). */
  masksAdded: number;
}

/**
 * A single element operation passed to applyElements
 */
export interface ApplyElementsOperation {
  action: 'add' | 'update' | 'delete' | 'reorder';
  pageNumber: number;
  element: Record<string, unknown>;
  oldBounds?: { x: number; y: number; width: number; height: number };
  /** For `reorder`: bring the element to front (`true`) or send to back (`false`). */
  reorder?: { toFront: boolean };
}

// Re-export types for consumers
export type {
  OpenPdfOptions,
  OpenPdfResult,
  SavePdfOptions,
  MergePdfOptions,
  SplitPdfOptions,
  SplitPdfResult,
  SplitPart,
  PreviewOptions,
  AllThumbnailsResult,
  ThumbnailData,
  EncryptOptions,
  PermissionsResult,
  FormFieldsResult,
  ElementOperationOptions,
  ConvertOptions,
  MetadataResult,
  FlattenOptions,
};
// CompressPdfResult & SearchablePdfResult are exported above (interface
// declarations) — no re-export needed here.
