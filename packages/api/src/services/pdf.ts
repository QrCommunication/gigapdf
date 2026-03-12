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
   */
  pageOperation: async (
    file: File | Blob,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<Blob | Record<string, unknown>> => {
    const form = new FormData();
    appendFileToForm(form, file);
    form.append('action', action);
    for (const [key, value] of Object.entries(params)) {
      form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    }

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
      action: 'add' | 'update' | 'delete';
      pageNumber: number;
      element: Record<string, unknown>;
      oldBounds?: { x: number; y: number; width: number; height: number };
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
};

/**
 * A single element operation passed to applyElements
 */
export interface ApplyElementsOperation {
  action: 'add' | 'update' | 'delete';
  pageNumber: number;
  element: Record<string, unknown>;
  oldBounds?: { x: number; y: number; width: number; height: number };
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
