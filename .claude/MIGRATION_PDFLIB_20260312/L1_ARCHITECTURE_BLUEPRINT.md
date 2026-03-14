# L1 Architecture Blueprint - @giga-pdf/pdf-engine

**SESSION**: MIGRATION_PDFLIB_20260312
**Date**: 2026-03-12
**Status**: PROPOSED
**Auteur**: tech-lead

---

## Table des matieres

1. [Structure du package](#1-structure-du-package)
2. [API Surface publique](#2-api-surface-publique)
3. [Mapping PyMuPDF vers TypeScript](#3-mapping-pymupdf-vers-typescript)
4. [Plan de migration fichier par fichier](#4-plan-de-migration-fichier-par-fichier)
5. [Configuration package.json](#5-configuration-packagejson)
6. [Integration avec Next.js](#6-integration-avec-nextjs)

---

## 1. Structure du package

```
packages/pdf-engine/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── src/
│   ├── index.ts                          # Re-export public API
│   ├── errors.ts                         # Custom error classes
│   ├── constants.ts                      # Shared constants (PDF points, limits, etc.)
│   ├── utils/
│   │   ├── index.ts
│   │   ├── color.ts                      # Hex/RGB/tuple color conversions
│   │   ├── coordinates.ts                # PDF<->Web coordinate transforms
│   │   ├── font-map.ts                   # PDF font name normalization
│   │   └── page-range.ts                 # Page range parser ("1-5,10")
│   ├── engine/
│   │   ├── index.ts                      # Export PDFDocumentHandle, openDocument, etc.
│   │   ├── document-handle.ts            # PDFDocumentHandle class wrapping pdf-lib
│   │   └── page-ops.ts                   # addPage, deletePage, movePage, rotatePage, etc.
│   ├── parse/
│   │   ├── index.ts                      # Export parseDocument, parsePage
│   │   ├── parser.ts                     # Main parser using pdfjs-dist
│   │   ├── text-extractor.ts             # Text block/span extraction
│   │   ├── image-extractor.ts            # Image extraction
│   │   ├── drawing-extractor.ts          # Vector drawing (shapes) extraction
│   │   ├── annotation-extractor.ts       # Annotation extraction
│   │   ├── form-extractor.ts             # Form field (widget) extraction
│   │   ├── bookmark-extractor.ts         # Outline/bookmark extraction
│   │   └── metadata-extractor.ts         # Document metadata extraction
│   ├── render/
│   │   ├── index.ts                      # Export all render operations
│   │   ├── text-renderer.ts              # addText, updateText
│   │   ├── image-renderer.ts             # addImage, updateImage
│   │   ├── shape-renderer.ts             # addShape
│   │   ├── annotation-renderer.ts        # addAnnotation
│   │   ├── form-renderer.ts              # addFormField, updateFormFieldValue
│   │   ├── redaction.ts                  # deleteElementArea (redaction via white rect overlay)
│   │   └── flatten.ts                    # flattenAnnotations, flattenForms
│   ├── merge-split/
│   │   ├── index.ts                      # Export mergePDFs, splitPDF
│   │   ├── merge.ts                      # Merge implementation
│   │   └── split.ts                      # Split implementation
│   ├── forms/
│   │   ├── index.ts                      # Export getFormFields, fillForm, flattenForm
│   │   ├── reader.ts                     # Read form fields from PDF
│   │   ├── filler.ts                     # Fill form field values
│   │   └── flattener.ts                  # Flatten form fields to static content
│   ├── encrypt/
│   │   ├── index.ts                      # Export encrypt/decrypt/permissions
│   │   ├── pdf-encrypt.ts                # PDF-level encryption (user/owner password)
│   │   ├── pdf-decrypt.ts                # PDF-level decryption
│   │   └── permissions.ts                # Read/set PDF permission flags
│   ├── preview/
│   │   ├── index.ts                      # Export renderPage, renderThumbnail, etc.
│   │   ├── renderer.ts                   # Page-to-image using pdfjs-dist + canvas
│   │   ├── thumbnail.ts                  # Thumbnail generation using sharp
│   │   └── pool.ts                       # Canvas worker pool for concurrent renders
│   └── convert/
│       ├── index.ts                      # Export htmlToPDF, urlToPDF
│       ├── html-to-pdf.ts               # HTML->PDF via Playwright
│       └── pool.ts                       # Playwright browser pool management
├── __tests__/
│   ├── engine/
│   │   ├── document-handle.test.ts
│   │   └── page-ops.test.ts
│   ├── parse/
│   │   ├── parser.test.ts
│   │   └── text-extractor.test.ts
│   ├── render/
│   │   └── text-renderer.test.ts
│   ├── merge-split/
│   │   ├── merge.test.ts
│   │   └── split.test.ts
│   ├── forms/
│   │   └── filler.test.ts
│   ├── encrypt/
│   │   └── pdf-encrypt.test.ts
│   ├── preview/
│   │   └── renderer.test.ts
│   ├── convert/
│   │   └── html-to-pdf.test.ts
│   └── fixtures/
│       ├── sample.pdf
│       ├── encrypted.pdf
│       ├── with-forms.pdf
│       └── with-images.pdf
```

### Principes d'organisation

- Chaque sous-module exporte via son `index.ts` local
- Le `src/index.ts` racine re-exporte tout l'API publique
- Les types internes au package (options, handles) sont definis dans chaque module
- Les types du domain (DocumentObject, PageObject, etc.) sont importes de `@giga-pdf/types`
- Aucune dependance circulaire : `parse` ne depend pas de `render`, `engine` est autonome

---

## 2. API Surface publique

### 2.1 Types internes au package

```typescript
// src/errors.ts

export class PDFEngineError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'PDFEngineError';
  }
}

export class PDFParseError extends PDFEngineError {
  constructor(message: string) {
    super(message, 'PDF_PARSE_ERROR');
  }
}

export class PDFCorruptedError extends PDFEngineError {
  constructor(message: string) {
    super(message, 'PDF_CORRUPTED');
  }
}

export class PDFEncryptedError extends PDFEngineError {
  constructor(message = 'Document is encrypted and requires a password') {
    super(message, 'PDF_ENCRYPTED');
  }
}

export class PDFInvalidPasswordError extends PDFEngineError {
  constructor(message = 'Invalid password') {
    super(message, 'PDF_INVALID_PASSWORD');
  }
}

export class PDFPageOutOfRangeError extends PDFEngineError {
  constructor(pageNumber: number, pageCount: number) {
    super(
      `Page ${pageNumber} out of range (1-${pageCount})`,
      'PDF_PAGE_OUT_OF_RANGE'
    );
  }
}
```

```typescript
// src/constants.ts

/** PDF point = 1/72 inch */
export const POINTS_PER_INCH = 72;

/** US Letter default dimensions in points */
export const DEFAULT_PAGE_WIDTH = 612;   // 8.5 inches
export const DEFAULT_PAGE_HEIGHT = 792;  // 11 inches

/** Maximum DPI for preview rendering */
export const MAX_PREVIEW_DPI = 600;

/** Maximum concurrent canvas renders */
export const DEFAULT_CANVAS_POOL_SIZE = 4;

/** Maximum concurrent Playwright instances */
export const DEFAULT_PLAYWRIGHT_POOL_SIZE = 2;

/** Maximum PDF file size in bytes (500 MB) */
export const MAX_PDF_SIZE_BYTES = 500 * 1024 * 1024;
```

### 2.2 Module: engine/

```typescript
// src/engine/index.ts

import type { PDFDocument } from 'pdf-lib';
import type { DocumentMetadata, DocumentPermissions } from '@giga-pdf/types';

/**
 * Opaque handle to an opened PDF document.
 * Encapsulates the pdf-lib PDFDocument and tracks state.
 */
export interface PDFDocumentHandle {
  /** Unique identifier for this document instance */
  readonly id: string;
  /** Number of pages in the document */
  readonly pageCount: number;
  /** Whether the document has been modified since opening */
  readonly isDirty: boolean;
  /** Whether the document was encrypted when opened */
  readonly wasEncrypted: boolean;
  /** Raw pdf-lib document (for advanced usage within the package only) */
  readonly _pdfDoc: PDFDocument;
}

export interface OpenDocumentOptions {
  /** Password for encrypted PDFs */
  password?: string;
}

export interface SaveDocumentOptions {
  /** Garbage collection level (0-4, higher = smaller file, slower) */
  garbage?: 0 | 1 | 2 | 3 | 4;
  /** Use object streams for compression */
  useObjectStreams?: boolean;
  /** Add creation/modification date to metadata */
  updateMetadata?: boolean;
  /** Encryption options (if encrypting on save) */
  encrypt?: {
    userPassword?: string;
    ownerPassword?: string;
    permissions?: Partial<DocumentPermissions>;
  };
}

export interface PageDimensions {
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

/**
 * Open a PDF document from a Buffer or file path.
 *
 * @param source - PDF data as Buffer, or absolute file path string
 * @param options - Optional password for encrypted documents
 * @returns Handle to the opened document
 * @throws PDFParseError if the buffer is not valid PDF
 * @throws PDFCorruptedError if the PDF structure is damaged
 * @throws PDFEncryptedError if encrypted and no password provided
 * @throws PDFInvalidPasswordError if the password is wrong
 */
export declare function openDocument(
  source: Buffer | string,
  options?: OpenDocumentOptions
): Promise<PDFDocumentHandle>;

/**
 * Save the document to a Buffer.
 *
 * @param handle - Document handle from openDocument
 * @param options - Save options (compression, encryption)
 * @returns PDF data as Buffer
 */
export declare function saveDocument(
  handle: PDFDocumentHandle,
  options?: SaveDocumentOptions
): Promise<Buffer>;

/**
 * Close the document and free all associated memory.
 * The handle is invalid after calling this.
 *
 * @param handle - Document handle to close
 */
export declare function closeDocument(handle: PDFDocumentHandle): void;

/**
 * Get document metadata.
 *
 * @param handle - Document handle
 * @returns Metadata object matching @giga-pdf/types DocumentMetadata
 */
export declare function getMetadata(
  handle: PDFDocumentHandle
): DocumentMetadata;

/**
 * Set document metadata fields. Only provided fields are updated.
 *
 * @param handle - Document handle
 * @param metadata - Partial metadata to update
 */
export declare function setMetadata(
  handle: PDFDocumentHandle,
  metadata: Partial<Pick<DocumentMetadata, 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer'>>
): void;

/**
 * Get page dimensions and rotation.
 *
 * @param handle - Document handle
 * @param pageNumber - Page number (1-indexed)
 * @returns Page dimensions in PDF points
 * @throws PDFPageOutOfRangeError
 */
export declare function getPageDimensions(
  handle: PDFDocumentHandle,
  pageNumber: number
): PageDimensions;

/**
 * Add a new blank page to the document.
 *
 * @param handle - Document handle
 * @param position - Position to insert at (1-indexed, clamped to valid range)
 * @param width - Page width in points (default: 612 = US Letter)
 * @param height - Page height in points (default: 792 = US Letter)
 * @returns The new page number
 */
export declare function addPage(
  handle: PDFDocumentHandle,
  position: number,
  width?: number,
  height?: number
): number;

/**
 * Delete a page from the document.
 *
 * @param handle - Document handle
 * @param pageNumber - Page to delete (1-indexed)
 * @throws PDFPageOutOfRangeError
 */
export declare function deletePage(
  handle: PDFDocumentHandle,
  pageNumber: number
): void;

/**
 * Move a page to a different position.
 *
 * @param handle - Document handle
 * @param fromPage - Current page number (1-indexed)
 * @param toPage - Target page number (1-indexed)
 */
export declare function movePage(
  handle: PDFDocumentHandle,
  fromPage: number,
  toPage: number
): void;

/**
 * Rotate a page by a multiple of 90 degrees.
 *
 * @param handle - Document handle
 * @param pageNumber - Page number (1-indexed)
 * @param angle - Rotation angle (must be multiple of 90, normalized to 0-359)
 */
export declare function rotatePage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  angle: number
): void;

/**
 * Copy a page within the same document or from another document.
 *
 * @param sourceHandle - Source document handle
 * @param sourcePageNumber - Source page number (1-indexed)
 * @param targetHandle - Target document handle (defaults to source)
 * @param targetPosition - Insert position in target (1-indexed, defaults to end)
 * @returns New page number in the target document
 */
export declare function copyPage(
  sourceHandle: PDFDocumentHandle,
  sourcePageNumber: number,
  targetHandle?: PDFDocumentHandle,
  targetPosition?: number
): Promise<number>;

/**
 * Resize a page.
 *
 * @param handle - Document handle
 * @param pageNumber - Page number (1-indexed)
 * @param width - New width in points
 * @param height - New height in points
 * @param scaleContent - Whether to scale existing content to fit (default: false)
 */
export declare function resizePage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  width: number,
  height: number,
  scaleContent?: boolean
): void;
```

### 2.3 Module: parse/

```typescript
// src/parse/index.ts

import type {
  DocumentObject,
  PageObject,
  DocumentMetadata,
  BookmarkObject,
  EmbeddedFileObject,
} from '@giga-pdf/types';
import type { LayerObject, Element } from '@giga-pdf/types';

export interface ParseOptions {
  /** Extract text elements (default: true) */
  extractText?: boolean;
  /** Extract image elements - returns position/metadata, not pixel data (default: true) */
  extractImages?: boolean;
  /** Extract vector drawings as ShapeElements (default: true) */
  extractDrawings?: boolean;
  /** Extract annotations (default: true) */
  extractAnnotations?: boolean;
  /** Extract form fields (default: true) */
  extractFormFields?: boolean;
  /** Extract bookmarks/outlines (default: true) */
  extractBookmarks?: boolean;
  /** Generate preview URLs with this base URL prefix (default: null, no previews) */
  baseUrl?: string | null;
  /** Document ID for URL generation (required if baseUrl is set) */
  documentId?: string;
  /** Specific pages to parse (default: all pages) */
  pages?: number[];
}

export interface ParsePageOptions {
  /** Extract text elements (default: true) */
  extractText?: boolean;
  /** Extract image elements (default: true) */
  extractImages?: boolean;
  /** Extract vector drawings (default: true) */
  extractDrawings?: boolean;
  /** Extract annotations (default: true) */
  extractAnnotations?: boolean;
  /** Extract form fields (default: true) */
  extractFormFields?: boolean;
  /** Base URL for image/preview resource endpoints */
  baseUrl?: string | null;
  /** Document ID for URL generation */
  documentId?: string;
}

/**
 * Parse an entire PDF document into a scene graph.
 *
 * Uses pdfjs-dist to extract text, images, shapes, annotations,
 * form fields, bookmarks, layers, and embedded files.
 *
 * All coordinates are in web-standard format (origin top-left, Y down).
 * Values are in PDF points (1 point = 1/72 inch).
 *
 * @param buffer - PDF data as Buffer
 * @param options - What to extract and how
 * @returns Complete DocumentObject scene graph
 * @throws PDFParseError if the PDF cannot be read
 */
export declare function parseDocument(
  buffer: Buffer,
  options?: ParseOptions
): Promise<DocumentObject>;

/**
 * Parse a single page from a PDF document.
 *
 * @param buffer - PDF data as Buffer
 * @param pageNumber - Page number to parse (1-indexed)
 * @param options - Extraction options
 * @returns PageObject with all extracted elements
 * @throws PDFParseError
 * @throws PDFPageOutOfRangeError
 */
export declare function parsePage(
  buffer: Buffer,
  pageNumber: number,
  options?: ParsePageOptions
): Promise<PageObject>;

/**
 * Extract just the metadata from a PDF without parsing pages.
 * Faster than parseDocument when you only need metadata.
 *
 * @param buffer - PDF data as Buffer
 * @returns Document metadata
 */
export declare function parseMetadata(
  buffer: Buffer
): Promise<DocumentMetadata>;

/**
 * Extract bookmarks/outlines from a PDF.
 *
 * @param buffer - PDF data as Buffer
 * @returns Nested bookmark tree
 */
export declare function parseBookmarks(
  buffer: Buffer
): Promise<BookmarkObject[]>;
```

### 2.4 Module: render/

```typescript
// src/render/index.ts

import type { PDFDocumentHandle } from '../engine';
import type {
  TextElement,
  ImageElement,
  ShapeElement,
  AnnotationElement,
  FormFieldElement,
  Bounds,
} from '@giga-pdf/types';

/**
 * Add a text element to a page.
 * Inserts text at the specified position with the given styling.
 *
 * @param handle - Document handle
 * @param pageNumber - Target page (1-indexed)
 * @param element - Text element with content, bounds, and style
 */
export declare function addText(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: TextElement
): void;

/**
 * Update an existing text element on a page.
 * Removes content in the old bounds area (redaction) then inserts new text.
 *
 * @param handle - Document handle
 * @param pageNumber - Target page (1-indexed)
 * @param oldBounds - Original text area to clear
 * @param element - Updated text element
 */
export declare function updateText(
  handle: PDFDocumentHandle,
  pageNumber: number,
  oldBounds: Bounds,
  element: TextElement
): void;

/**
 * Add an image to a page.
 *
 * @param handle - Document handle
 * @param pageNumber - Target page (1-indexed)
 * @param element - Image element with position info
 * @param imageData - Raw image bytes (PNG, JPEG, or other format)
 */
export declare function addImage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: ImageElement,
  imageData: Buffer
): Promise<void>;

/**
 * Update an existing image on a page.
 * Clears old area and optionally inserts new image data.
 *
 * @param handle - Document handle
 * @param pageNumber - Target page (1-indexed)
 * @param oldBounds - Original image area to clear
 * @param element - Updated image element
 * @param imageData - New image data (null to just reposition)
 */
export declare function updateImage(
  handle: PDFDocumentHandle,
  pageNumber: number,
  oldBounds: Bounds,
  element: ImageElement,
  imageData?: Buffer | null
): Promise<void>;

/**
 * Add a shape (rectangle, ellipse, line, polygon, path) to a page.
 *
 * @param handle - Document handle
 * @param pageNumber - Target page (1-indexed)
 * @param element - Shape element with geometry and styling
 */
export declare function addShape(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: ShapeElement
): void;

/**
 * Add an annotation to a page.
 *
 * @param handle - Document handle
 * @param pageNumber - Target page (1-indexed)
 * @param element - Annotation element
 */
export declare function addAnnotation(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: AnnotationElement
): void;

/**
 * Add a form field (widget) to a page.
 *
 * @param handle - Document handle
 * @param pageNumber - Target page (1-indexed)
 * @param element - Form field element
 */
export declare function addFormField(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: FormFieldElement
): void;

/**
 * Update the value of an existing form field.
 *
 * @param handle - Document handle
 * @param fieldName - Field name to update
 * @param value - New value (string for text, boolean for checkbox, string[] for multi-select)
 * @returns true if field was found and updated, false otherwise
 */
export declare function updateFormFieldValue(
  handle: PDFDocumentHandle,
  fieldName: string,
  value: string | boolean | string[]
): boolean;

/**
 * Delete content in a rectangular area (redaction).
 * Draws a white rectangle over the area, effectively hiding the content.
 *
 * Note: Unlike PyMuPDF's add_redact_annot + apply_redactions which removes
 * content from the PDF structure, this approach overlays a white rectangle.
 * For true redaction that removes data, use saveDocument with garbage collection.
 *
 * @param handle - Document handle
 * @param pageNumber - Target page (1-indexed)
 * @param bounds - Area to clear (web coordinates)
 */
export declare function deleteElementArea(
  handle: PDFDocumentHandle,
  pageNumber: number,
  bounds: Bounds
): void;

/**
 * Flatten all annotations on specified pages into the page content stream.
 * After flattening, annotations cannot be edited or removed.
 *
 * @param handle - Document handle
 * @param pageNumber - Specific page (1-indexed) or null for all pages
 */
export declare function flattenAnnotations(
  handle: PDFDocumentHandle,
  pageNumber?: number | null
): void;

/**
 * Flatten all form fields on specified pages into static content.
 * Current field values are rendered as static text/graphics.
 *
 * @param handle - Document handle
 * @param pageNumber - Specific page (1-indexed) or null for all pages
 */
export declare function flattenForms(
  handle: PDFDocumentHandle,
  pageNumber?: number | null
): void;
```

### 2.5 Module: merge-split/

```typescript
// src/merge-split/index.ts

export interface PageRange {
  /** Start page (1-indexed, inclusive) */
  start: number;
  /** End page (1-indexed, inclusive) */
  end: number;
}

export interface MergeOptions {
  /** Page ranges for each input document. null = all pages */
  pageRanges?: (PageRange[] | null)[];
}

export interface SplitOptions {
  /** How to name output documents (index-based) */
  nameTemplate?: string;
}

/**
 * Merge multiple PDF documents into a single document.
 *
 * Documents are merged in the order provided. Page ranges
 * can be specified per document to include only specific pages.
 *
 * @param buffers - Array of PDF Buffers to merge (minimum 2)
 * @param options - Optional page ranges per document
 * @returns Merged PDF as Buffer
 * @throws PDFParseError if any buffer is invalid
 */
export declare function mergePDFs(
  buffers: Buffer[],
  options?: MergeOptions
): Promise<Buffer>;

/**
 * Split a PDF document into multiple documents by page ranges.
 *
 * @param buffer - Source PDF Buffer
 * @param ranges - Array of page ranges defining each output document
 * @returns Array of PDF Buffers, one per range
 * @throws PDFParseError if buffer is invalid
 * @throws PDFPageOutOfRangeError if ranges reference invalid pages
 */
export declare function splitPDF(
  buffer: Buffer,
  ranges: PageRange[]
): Promise<Buffer[]>;

/**
 * Split a PDF document at specific page numbers.
 * Convenience wrapper around splitPDF.
 *
 * Example: splitAt(buffer, [5, 10]) on a 20-page doc produces:
 *   - Pages 1-5
 *   - Pages 6-10
 *   - Pages 11-20
 *
 * @param buffer - Source PDF Buffer
 * @param splitPoints - Page numbers where to split
 * @returns Array of PDF Buffers
 */
export declare function splitAt(
  buffer: Buffer,
  splitPoints: number[]
): Promise<Buffer[]>;
```

### 2.6 Module: forms/

```typescript
// src/forms/index.ts

import type { FormFieldElement, Bounds } from '@giga-pdf/types';

export interface FormFieldInfo {
  fieldName: string;
  fieldType: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'listbox' | 'signature' | 'button';
  value: string | boolean | string[];
  defaultValue: string | boolean | string[];
  pageNumber: number;
  bounds: Bounds;
  options: string[] | null;
  properties: {
    required: boolean;
    readOnly: boolean;
    maxLength: number | null;
    multiline: boolean;
  };
}

export interface FillResult {
  fieldName: string;
  success: boolean;
  oldValue: string | boolean | string[];
  newValue: string | boolean | string[];
  error?: string;
}

/**
 * Get all form fields from a PDF document.
 *
 * @param buffer - PDF data as Buffer
 * @returns Array of form field info objects
 */
export declare function getFormFields(
  buffer: Buffer
): Promise<FormFieldInfo[]>;

/**
 * Fill form fields in a PDF document.
 *
 * @param buffer - PDF data as Buffer
 * @param values - Map of field name to value
 * @returns Object with the modified PDF buffer and per-field results
 */
export declare function fillForm(
  buffer: Buffer,
  values: Record<string, string | boolean | string[]>
): Promise<{ buffer: Buffer; results: FillResult[] }>;

/**
 * Flatten all form fields into static content.
 * Current values are rendered as text/graphics, interactivity is removed.
 *
 * @param buffer - PDF data as Buffer
 * @returns New PDF Buffer with flattened forms
 */
export declare function flattenForm(
  buffer: Buffer
): Promise<Buffer>;
```

### 2.7 Module: encrypt/

```typescript
// src/encrypt/index.ts

import type { DocumentPermissions } from '@giga-pdf/types';

export type EncryptionAlgorithm = 'AES-128' | 'AES-256';

export interface EncryptOptions {
  /** Password required to open the document (user password) */
  userPassword?: string;
  /** Password required to change permissions (owner password) */
  ownerPassword?: string;
  /** Encryption algorithm (default: AES-256) */
  algorithm?: EncryptionAlgorithm;
  /** Document permissions to set */
  permissions?: Partial<DocumentPermissions>;
}

export interface PermissionsResult {
  isEncrypted: boolean;
  permissions: DocumentPermissions;
}

/**
 * Encrypt a PDF document with password protection.
 * At least one of userPassword or ownerPassword must be provided.
 *
 * Uses node-forge for AES encryption, applied via pdf-lib's save options.
 *
 * @param buffer - PDF data as Buffer
 * @param options - Encryption options
 * @returns Encrypted PDF as Buffer
 * @throws PDFEngineError if no password is provided
 */
export declare function encryptPDF(
  buffer: Buffer,
  options: EncryptOptions
): Promise<Buffer>;

/**
 * Decrypt a PDF document (remove password protection).
 *
 * @param buffer - Encrypted PDF data as Buffer
 * @param password - User or owner password
 * @returns Decrypted PDF as Buffer
 * @throws PDFInvalidPasswordError if password is wrong
 * @throws PDFEngineError if document is not encrypted
 */
export declare function decryptPDF(
  buffer: Buffer,
  password: string
): Promise<Buffer>;

/**
 * Get the current permissions and encryption status of a PDF.
 *
 * @param buffer - PDF data as Buffer
 * @param password - Password if the document is encrypted (optional)
 * @returns Encryption status and permission flags
 */
export declare function getPermissions(
  buffer: Buffer,
  password?: string
): Promise<PermissionsResult>;

/**
 * Set permissions on a PDF document.
 * Requires an owner password if the document is encrypted.
 *
 * @param buffer - PDF data as Buffer
 * @param permissions - Permission flags to set
 * @param ownerPassword - Owner password for the document
 * @returns Modified PDF as Buffer
 */
export declare function setPermissions(
  buffer: Buffer,
  permissions: Partial<DocumentPermissions>,
  ownerPassword: string
): Promise<Buffer>;
```

### 2.8 Module: preview/

```typescript
// src/preview/index.ts

export type PreviewFormat = 'png' | 'jpeg' | 'webp';

export interface RenderOptions {
  /** Resolution in DPI (default: 150, max: 600) */
  dpi?: number;
  /** Alternative to DPI: direct scale factor (overrides DPI) */
  scale?: number;
  /** Output format (default: 'png') */
  format?: PreviewFormat;
  /** JPEG/WebP quality 1-100 (default: 85) */
  quality?: number;
  /** Whether to include transparency / alpha channel (default: false) */
  alpha?: boolean;
}

export interface ThumbnailOptions {
  /** Maximum thumbnail width in pixels (default: 200) */
  maxWidth?: number;
  /** Maximum thumbnail height in pixels (default: 300) */
  maxHeight?: number;
  /** Output format (default: 'png') */
  format?: PreviewFormat;
  /** Image quality 1-100 for lossy formats (default: 75) */
  quality?: number;
}

/**
 * Render a single page to an image.
 *
 * Uses pdfjs-dist to render into a node-canvas, then sharp for format conversion.
 * Canvas instances are pooled for memory efficiency.
 *
 * @param buffer - PDF data as Buffer
 * @param pageNumber - Page to render (1-indexed)
 * @param options - Resolution, format, quality
 * @returns Image data as Buffer
 * @throws PDFPageOutOfRangeError
 */
export declare function renderPage(
  buffer: Buffer,
  pageNumber: number,
  options?: RenderOptions
): Promise<Buffer>;

/**
 * Render a page thumbnail with maximum dimensions.
 * Automatically calculates the scale to fit within maxWidth x maxHeight
 * while preserving aspect ratio.
 *
 * @param buffer - PDF data as Buffer
 * @param pageNumber - Page to render (1-indexed)
 * @param options - Max dimensions, format, quality
 * @returns Thumbnail image data as Buffer
 */
export declare function renderThumbnail(
  buffer: Buffer,
  pageNumber: number,
  options?: ThumbnailOptions
): Promise<Buffer>;

/**
 * Render thumbnails for all pages in the document.
 * Processes pages in parallel using the canvas pool.
 *
 * @param buffer - PDF data as Buffer
 * @param options - Max dimensions, format, quality
 * @returns Map of page number to thumbnail Buffer
 */
export declare function renderAllThumbnails(
  buffer: Buffer,
  options?: ThumbnailOptions
): Promise<Map<number, Buffer>>;

/**
 * Extract an embedded image from the PDF by its reference index.
 *
 * @param buffer - PDF data as Buffer
 * @param pageNumber - Page containing the image (1-indexed)
 * @param imageIndex - Index of the image on the page (0-indexed)
 * @param outputFormat - Optional format conversion (null = original format)
 * @returns Object with image data and mime type
 */
export declare function extractImage(
  buffer: Buffer,
  pageNumber: number,
  imageIndex: number,
  outputFormat?: PreviewFormat | null
): Promise<{ data: Buffer; mimeType: string }>;

/**
 * Configure the canvas pool size. Call before first render.
 * Default is 4 concurrent canvases.
 *
 * @param size - Number of canvas instances in the pool
 */
export declare function setCanvasPoolSize(size: number): void;

/**
 * Shut down the canvas pool and free memory.
 * Call during application shutdown.
 */
export declare function destroyCanvasPool(): void;
```

### 2.9 Module: convert/

```typescript
// src/convert/index.ts

export interface ConvertOptions {
  /** Page format (default: 'A4') */
  format?: 'A4' | 'Letter' | 'Legal' | 'Tabloid';
  /** Landscape orientation (default: false) */
  landscape?: boolean;
  /** Page margins in CSS format (default: '20mm') */
  margin?: string | {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  /** Print background colors and images (default: true) */
  printBackground?: boolean;
  /** Scale factor 0.1-2.0 (default: 1) */
  scale?: number;
  /** Custom page width (overrides format) */
  width?: string;
  /** Custom page height (overrides format) */
  height?: string;
  /** Wait for network idle before rendering (default: true) */
  waitForNetworkIdle?: boolean;
  /** Maximum wait time in ms (default: 30000) */
  timeout?: number;
  /** Custom CSS to inject before rendering */
  customCSS?: string;
  /** HTTP headers for URL-based conversion */
  headers?: Record<string, string>;
}

/**
 * Convert an HTML string to PDF.
 *
 * Uses a pooled Playwright browser instance to render the HTML
 * and produce a PDF. The pool is lazily initialized on first call.
 *
 * @param html - HTML content to convert
 * @param options - Page format, margins, orientation, etc.
 * @returns PDF data as Buffer
 */
export declare function htmlToPDF(
  html: string,
  options?: ConvertOptions
): Promise<Buffer>;

/**
 * Convert a web page URL to PDF.
 *
 * Navigates a pooled Playwright browser to the URL, waits for
 * load/network idle, then produces a PDF.
 *
 * @param url - URL to convert (must be http or https)
 * @param options - Page format, margins, headers, timeout, etc.
 * @returns PDF data as Buffer
 * @throws PDFEngineError if URL is invalid or unreachable
 */
export declare function urlToPDF(
  url: string,
  options?: ConvertOptions
): Promise<Buffer>;

/**
 * Configure the Playwright browser pool size.
 * Default is 2 concurrent browser instances.
 *
 * @param size - Number of browser instances in the pool
 */
export declare function setPlaywrightPoolSize(size: number): void;

/**
 * Shut down all Playwright browser instances.
 * Call during application shutdown.
 */
export declare function destroyPlaywrightPool(): Promise<void>;
```

### 2.10 Export racine (src/index.ts)

```typescript
// src/index.ts

// Engine
export {
  openDocument,
  saveDocument,
  closeDocument,
  getMetadata,
  setMetadata,
  getPageDimensions,
  addPage,
  deletePage,
  movePage,
  rotatePage,
  copyPage,
  resizePage,
} from './engine';
export type {
  PDFDocumentHandle,
  OpenDocumentOptions,
  SaveDocumentOptions,
  PageDimensions,
} from './engine';

// Parse
export {
  parseDocument,
  parsePage,
  parseMetadata,
  parseBookmarks,
} from './parse';
export type { ParseOptions, ParsePageOptions } from './parse';

// Render
export {
  addText,
  updateText,
  addImage,
  updateImage,
  addShape,
  addAnnotation,
  addFormField,
  updateFormFieldValue,
  deleteElementArea,
  flattenAnnotations,
  flattenForms,
} from './render';

// Merge/Split
export { mergePDFs, splitPDF, splitAt } from './merge-split';
export type { PageRange, MergeOptions, SplitOptions } from './merge-split';

// Forms
export { getFormFields, fillForm, flattenForm } from './forms';
export type { FormFieldInfo, FillResult } from './forms';

// Encrypt
export { encryptPDF, decryptPDF, getPermissions, setPermissions } from './encrypt';
export type { EncryptOptions, EncryptionAlgorithm, PermissionsResult } from './encrypt';

// Preview
export {
  renderPage,
  renderThumbnail,
  renderAllThumbnails,
  extractImage,
  setCanvasPoolSize,
  destroyCanvasPool,
} from './preview';
export type { RenderOptions, ThumbnailOptions, PreviewFormat } from './preview';

// Convert
export {
  htmlToPDF,
  urlToPDF,
  setPlaywrightPoolSize,
  destroyPlaywrightPool,
} from './convert';
export type { ConvertOptions } from './convert';

// Errors
export {
  PDFEngineError,
  PDFParseError,
  PDFCorruptedError,
  PDFEncryptedError,
  PDFInvalidPasswordError,
  PDFPageOutOfRangeError,
} from './errors';

// Constants
export {
  POINTS_PER_INCH,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_PAGE_HEIGHT,
  MAX_PREVIEW_DPI,
} from './constants';
```

---

## 3. Mapping PyMuPDF vers TypeScript

### 3.1 Tableau complet des operations fitz

| # | Operation fitz (Python) | Fichier Python source | Module TS | Lib TS | Implementation TS |
|---|---|---|---|---|---|
| 1 | `fitz.open(stream=bytes, filetype="pdf")` | `pdf_engine.py:64` | engine | pdf-lib | `PDFDocument.load(buffer, { ignoreEncryption: true })` |
| 2 | `fitz.open(str(path))` | `pdf_engine.py:67` | engine | pdf-lib + fs | `PDFDocument.load(fs.readFileSync(path))` |
| 3 | `fitz.open()` (new empty doc) | `merge_split.py:171` | merge-split | pdf-lib | `PDFDocument.create()` |
| 4 | `doc.is_encrypted` | `pdf_engine.py:79` | engine | pdf-lib | Buffer header check `%PDF-` + pdf-lib load with `ignoreEncryption`, then check `doc.isEncrypted` |
| 5 | `doc.authenticate(password)` | `pdf_engine.py:84` | engine | pdf-lib | `PDFDocument.load(buffer, { password })` - si pas d'exception, auth OK |
| 6 | `doc.page_count` | `pdf_engine.py:90` | engine | pdf-lib | `pdfDoc.getPageCount()` |
| 7 | `doc.tobytes(**options)` | `pdf_engine.py:184` | engine | pdf-lib | `pdfDoc.save({ useObjectStreams })` retourne `Uint8Array` -> `Buffer.from()` |
| 8 | `doc.save(path, **options)` | `pdf_engine.py:180` | engine | pdf-lib + fs | `fs.writeFileSync(path, await pdfDoc.save())` |
| 9 | `doc[page_index]` (get page) | `pdf_engine.py:208` | engine | pdf-lib | `pdfDoc.getPage(pageIndex)` (0-indexed) |
| 10 | `doc.new_page(pno, width, height)` | `pdf_engine.py:236` | engine | pdf-lib | `pdfDoc.insertPage(pageIndex, [width, height])` |
| 11 | `doc.delete_page(page_index)` | `pdf_engine.py:257` | engine | pdf-lib | `pdfDoc.removePage(pageIndex)` |
| 12 | `doc.move_page(from, to)` | `pdf_engine.py:275` | engine | pdf-lib | Pas de methode directe. Copier page vers nouvelle position puis supprimer l'originale. Utiliser `copyPages` + `insertPage` + `removePage`. |
| 13 | `page.set_rotation(angle)` | `pdf_engine.py:293` | engine | pdf-lib | `page.setRotation(degrees(angle))` |
| 14 | `page.rotation` | `pdf_engine.py:293` | engine | pdf-lib | `page.getRotation().angle` |
| 15 | `doc.insert_pdf(src, from_page, to_page, start_at)` | `pdf_engine.py:328-333` | engine, merge-split | pdf-lib | `targetDoc.copyPages(srcDoc, [pageIndices])` puis `targetDoc.insertPage(pos, copiedPage)` |
| 16 | `doc.metadata` | `pdf_engine.py:349` | engine | pdf-lib | `pdfDoc.getTitle()`, `pdfDoc.getAuthor()`, etc. (getters individuels) |
| 17 | `doc.set_metadata(dict)` | `pdf_engine.py:404` | engine | pdf-lib | `pdfDoc.setTitle()`, `pdfDoc.setAuthor()`, etc. (setters individuels) |
| 18 | `page.rect.width / height` | `pdf_engine.py:420-421` | engine | pdf-lib | `page.getSize()` -> `{ width, height }` |
| 19 | `page.set_mediabox(rect)` | `pdf_engine.py:456-462` | engine | pdf-lib | `page.setMediaBox(x, y, width, height)` |
| 20 | `page.get_text("rawdict", flags=flags)` | `parser.py:299-300` | parse | pdfjs-dist | `page.getTextContent({ includeMarkedContent: false })` retourne `TextContent` avec `items: TextItem[]`. Chaque item a `str`, `transform`, `fontName`, `width`, `height`. |
| 21 | `page.get_links()` | `parser.py:394` | parse | pdfjs-dist | `page.getAnnotations()` filtre `type === 'Link'` |
| 22 | `page.get_images()` | `parser.py:411` | parse | pdfjs-dist | `page.getOperatorList()` + filtrer les ops `OPS.paintImageXObject`. Puis `page.objs.get(imgName)` pour les infos. |
| 23 | `page.get_image_rects(xref)` | `parser.py:423` | parse | pdfjs-dist | Position calculee depuis la matrice de transformation dans l'operator list (`OPS.transform` precedant `OPS.paintImageXObject`). |
| 24 | `doc.extract_image(xref)` | `parser.py:418` | parse/preview | pdfjs-dist | `page.objs.get(imgName)` retourne `ImageBitmap` ou `{data, width, height}`. Encoder en PNG/JPEG via sharp. |
| 25 | `page.annots()` | `parser.py:477` | parse | pdfjs-dist | `page.getAnnotations()` retourne `AnnotationData[]` |
| 26 | `annot.type[0]` (annotation type number) | `parser.py:479` | parse | pdfjs-dist | `annotation.annotationType` (enum `AnnotationType`) |
| 27 | `annot.rect` | `parser.py:497` | parse | pdfjs-dist | `annotation.rect` -> `[x1, y1, x2, y2]` |
| 28 | `annot.colors` | `parser.py:506` | parse | pdfjs-dist | `annotation.color` -> `Uint8ClampedArray` RGB |
| 29 | `annot.info` | `parser.py:510` | parse | pdfjs-dist | `annotation.contentsObj?.str`, `annotation.url`, etc. |
| 30 | `page.widgets()` | `parser.py:706` | parse | pdfjs-dist | `page.getAnnotations()` filtre `annotation.subtype === 'Widget'` |
| 31 | `widget.field_type` | `parser.py:719` | parse | pdfjs-dist | `annotation.fieldType` ('Tx', 'Btn', 'Ch', 'Sig') |
| 32 | `widget.field_name` | `parser.py:752` | parse | pdfjs-dist | `annotation.fieldName` |
| 33 | `widget.field_value` | `parser.py:733` | parse | pdfjs-dist | `annotation.fieldValue` |
| 34 | `widget.field_flags` | `parser.py:758-759` | parse | pdfjs-dist | `annotation.fieldFlags` (bitfield) |
| 35 | `widget.choice_values` | `parser.py:740` | parse | pdfjs-dist | `annotation.options` -> `{displayValue, exportValue}[]` |
| 36 | `widget.text_fontsize` | `parser.py:762` | parse | pdfjs-dist | `annotation.defaultAppearanceData?.fontSize` |
| 37 | `page.get_drawings()` | `parser.py:553` | parse | pdfjs-dist | `page.getOperatorList()` + interpreter les ops graphiques (`moveTo`, `lineTo`, `curveTo`, `rectangle`, `fill`, `stroke`, `closePath`). Reconstruction manuelle des paths. |
| 38 | `doc.get_toc(simple=False)` | `parser.py:778` | parse | pdfjs-dist | `pdfDocument.getOutline()` retourne l'arbre de bookmarks |
| 39 | `doc.layer_ui_configs()` | `parser.py:825` | parse | pdfjs-dist | `pdfDocument.getOptionalContentConfig()` |
| 40 | `doc.embfile_names()` / `doc.embfile_info()` | `parser.py:851-863` | parse | pdfjs-dist | `pdfDocument.getAttachments()` -> `Map<string, {filename, content}>` |
| 41 | `page.insert_text(point, text, fontname, fontsize, color, rotate)` | `renderer.py:79-86` | render | pdf-lib | `page.drawText(text, { x, y, size, font, color: rgb(), rotate: degrees() })`. Polices via `pdfDoc.embedFont(StandardFonts.Helvetica)`. |
| 42 | `page.add_redact_annot(rect)` + `page.apply_redactions()` | `renderer.py:121-122` | render | pdf-lib | Pas de redaction native dans pdf-lib. Dessiner un rectangle blanc opaque: `page.drawRectangle({ x, y, width, height, color: rgb(1,1,1), opacity: 1 })`. |
| 43 | `page.insert_image(rect, stream=data)` | `renderer.py:158` | render | pdf-lib | `pdfDoc.embedPng(data)` ou `pdfDoc.embedJpg(data)` puis `page.drawImage(image, { x, y, width, height })`. |
| 44 | `page.new_shape()` + `shape.draw_rect/oval/line` + `shape.finish()` + `shape.commit()` | `renderer.py:227-259` | render | pdf-lib | `page.drawRectangle(opts)`, `page.drawEllipse(opts)`, `page.drawLine(opts)` directement. Chacun accepte `color`, `borderColor`, `borderWidth`, `opacity`, `dashArray`. |
| 45 | `page.add_highlight_annot(rect)` | `renderer.py:295` | render | pdf-lib | Pas de support natif annotations dans pdf-lib. Utiliser un rectangle semi-transparent jaune: `page.drawRectangle({ ..., color: rgb(1,1,0), opacity: 0.3 })`. Ou utiliser `pdf-lib` custom annotation dict injection. |
| 46 | `page.add_underline_annot(rect)` | `renderer.py:297` | render | pdf-lib | Ligne sous le texte: `page.drawLine({ start, end, color, thickness })` |
| 47 | `page.add_strikeout_annot(rect)` | `renderer.py:299` | render | pdf-lib | Ligne au milieu du texte: `page.drawLine(...)` |
| 48 | `page.add_text_annot(point, content)` | `renderer.py:304` | render | pdf-lib | Annotation popup via raw PDF dictionary injection avec `pdfDoc.context.obj({})` |
| 49 | `page.add_freetext_annot(rect, content)` | `renderer.py:306` | render | pdf-lib | `page.drawText(content, { x, y, size, font })` dans le rect |
| 50 | `page.insert_link({kind, from, uri})` | `renderer.py:310-319` | render | pdf-lib | Raw annotation dict: `{ Type: 'Annot', Subtype: 'Link', Rect: [...], A: { Type: 'Action', S: 'URI', URI: PDFString } }` |
| 51 | `fitz.Widget()` + `widget.field_type` + `page.add_widget(widget)` | `renderer.py:370-391` | render | pdf-lib | `pdfDoc.getForm()` -> `form.createTextField(name)`, `form.createCheckBox(name)`, `form.createDropdown(name)`, etc. Puis `.addToPage(page, { x, y, width, height })`. |
| 52 | `widget.field_value = value` + `widget.update()` | `renderer.py:416-420` | render | pdf-lib | `field.setText(value)` pour text, `field.check()` / `field.uncheck()` pour checkbox, `field.select(value)` pour dropdown. |
| 53 | `page.get_pixmap(matrix=mat, alpha=False)` | `preview.py:79` | preview | pdfjs-dist + canvas | `page.getViewport({scale})` -> creer canvas -> `page.render({canvasContext, viewport})`. Resultat via `canvas.toBuffer('image/png')`. |
| 54 | `fitz.Matrix(zoom, zoom)` | `preview.py:72-73` | preview | pdfjs-dist | `page.getViewport({ scale: zoom })` - le scale est equivalent a la matrice de zoom. |
| 55 | `page.get_svg_image()` | `preview.py:180` | preview | pdfjs-dist | `page.getOperatorList()` + SVG serialization. Alternative: rendre en canvas puis vectoriser. Complexe - considerer un rendu raster uniquement pour la v1. |
| 56 | `Image.frombytes("RGB", [w,h], pix.samples)` | `preview.py:82` | preview | sharp | Pas necessaire - canvas produit directement un buffer PNG. sharp pour le resize/format: `sharp(canvasBuffer).resize(w,h).toFormat(fmt).toBuffer()` |
| 57 | `fitz.PDF_PERM_PRINT`, `PERM_COPY`, etc. | `security.py:277-287` | encrypt | node-forge + pdf-lib | pdf-lib expose `PDFDocument`'s encryption via save options: `pdfDoc.save({ userPassword, ownerPassword, permissions: { printing, copying, ... } })`. Les flags de permissions sont mappes via l'objet `permissions` de pdf-lib. |
| 58 | `fitz.PDF_ENCRYPT_AES_256` etc. | `security.py:290-294` | encrypt | pdf-lib | pdf-lib ne supporte pas le choix d'algo a l'ecriture. Utiliser node-forge pour le chiffrement AES-256 sur le buffer brut, ou s'appuyer sur les options de `pdfDoc.save()` qui utilise AES-256 par defaut dans les versions recentes. |
| 59 | `doc.permissions` (bitmask) | `security.py:722-731` | encrypt | pdf-lib | `pdfDoc.catalog.get(PDFName.of('Perms'))` ou parser le trailer dict. Plus simplement: re-ouvrir avec `PDFDocument.load()` et verifier les flags. |
| 60 | `page.get_pixmap(matrix=mat)` pour OCR 300 DPI | `ocr.py:83-84` | preview | pdfjs-dist + canvas | `page.render({canvasContext, viewport: page.getViewport({scale: 300/72})})` |

### 3.2 Notes importantes sur les differences de comportement

**Parsing (pdfjs-dist vs PyMuPDF)**

| Aspect | PyMuPDF (fitz) | pdfjs-dist | Impact |
|--------|---------------|------------|--------|
| Coordonnees texte | `rawdict` retourne `bbox` en coordonnees PDF native (top-left dans PyMuPDF v1.23+) | `TextItem.transform` = matrice 6-element `[a, b, c, d, tx, ty]`. Position = `(tx, pageHeight - ty)` pour web coords | Conversion necessaire dans text-extractor.ts |
| Flags texte | `span.flags` bitmask (bold=16, italic=2, etc.) | Font name contient les indicateurs (e.g. "TimesNewRoman,Bold") | Parser le nom de police pour deduire bold/italic |
| Drawings | `page.get_drawings()` API directe | Pas d'API directe. Il faut interpreter `page.getOperatorList()` et reconstruire les paths a partir des ops graphiques | Implementation significativement plus complexe |
| Widgets | `page.widgets()` API dediee | Les widgets sont des annotations avec `subtype === 'Widget'` dans `page.getAnnotations()` | Filtrage dans form-extractor.ts |
| Images | `page.get_images()` + `doc.extract_image(xref)` | `page.getOperatorList()` + `page.objs.get(imageName)` | Plus complexe, pas de xref direct |

**Rendering (pdf-lib vs PyMuPDF)**

| Aspect | PyMuPDF (fitz) | pdf-lib | Impact |
|--------|---------------|---------|--------|
| Redaction | `add_redact_annot()` + `apply_redactions()` supprime les donnees du PDF | Pas de redaction. On dessine un rect blanc par-dessus. Les donnees restent dans le PDF. | Pour une vraie redaction, sauvegarder avec `garbage >= 3` ou post-traiter |
| Annotations markup | API native `add_highlight_annot()`, etc. | Pas de support natif. Simuler via dessin (rectangle semi-transparent) ou injection raw dict | Perte de semantique annotation vs dessin |
| Polices | `page.insert_text(fontname="helv")` - polices base14 integrees | `pdfDoc.embedFont(StandardFonts.Helvetica)` - polices standard embedees | Comportement equivalent |
| Formes | `page.new_shape()` API chainee | API directe `page.drawRectangle()`, `page.drawEllipse()`, etc. | Plus simple en pdf-lib |

---

## 4. Plan de migration fichier par fichier

### 4.1 Vue d'ensemble

```
FICHIERS PYTHON MIGRES INTEGRALEMENT VERS @giga-pdf/pdf-engine:
  app/core/pdf_engine.py        -> engine/
  app/core/parser.py            -> parse/
  app/core/renderer.py          -> render/
  app/core/preview.py           -> preview/
  app/utils/coordinates.py      -> utils/coordinates.ts

FICHIERS PYTHON DONT LA LOGIQUE EST ABSORBEE:
  app/api/v1/merge_split.py     -> merge-split/ (logique fitz uniquement)
  app/api/v1/forms.py           -> forms/ (logique fitz uniquement)
  app/api/v1/security.py        -> encrypt/ (logique fitz uniquement)
  app/api/v1/export.py          -> Celery task reste Python, mais preview/ remplace le rendu

FICHIERS PYTHON QUI RESTENT EN PYTHON:
  app/core/ocr.py               -> Reste en Python (Tesseract via pytesseract)
  app/services/encryption_service.py -> Reste en Python (chiffrement documents at rest, pas PDF)
  app/tasks/export_tasks.py     -> Reste en Python (Celery worker)
  app/tasks/ocr_tasks.py        -> Reste en Python (Celery worker)
  app/api/websocket.py          -> Reste en Python (FastAPI WebSockets)
  Tous les fichiers services/, repositories/, middleware/, models/ -> Restent en Python
```

### 4.2 Migration detaillee

#### Fichier 1: `app/core/pdf_engine.py` -> `packages/pdf-engine/src/engine/`

| Element Python | Destination TS | Notes |
|---|---|---|
| `PDFEngine.__init__()` + `_documents dict` | Non migre - le pattern "document store" sera gere au niveau Next.js API routes (Map en memoire ou Redis) | L'engine TS est stateless, on retourne des handles |
| `PDFEngine.open_document()` | `engine/document-handle.ts` -> `openDocument()` | pdf-lib `PDFDocument.load()` + generation UUID |
| `PDFEngine.get_document()` | Non necessaire - le handle EST le document | |
| `PDFEngine.close_document()` | `engine/document-handle.ts` -> `closeDocument()` | Liberer les references, GC fait le reste |
| `PDFEngine.save_document()` | `engine/document-handle.ts` -> `saveDocument()` | `pdfDoc.save(options)` |
| `PDFEngine.get_page()` | Inline dans chaque operation via `handle._pdfDoc.getPage(n-1)` | |
| `PDFEngine.add_page()` | `engine/page-ops.ts` -> `addPage()` | `pdfDoc.insertPage(index, [w, h])` |
| `PDFEngine.delete_page()` | `engine/page-ops.ts` -> `deletePage()` | `pdfDoc.removePage(index)` |
| `PDFEngine.move_page()` | `engine/page-ops.ts` -> `movePage()` | copyPages + insertPage + removePage |
| `PDFEngine.rotate_page()` | `engine/page-ops.ts` -> `rotatePage()` | `page.setRotation(degrees(angle))` |
| `PDFEngine.copy_page()` | `engine/page-ops.ts` -> `copyPage()` | `pdfDoc.copyPages(srcDoc, [idx])` |
| `PDFEngine.get_metadata()` | `engine/document-handle.ts` -> `getMetadata()` | getters individuels pdf-lib |
| `PDFEngine.set_metadata()` | `engine/document-handle.ts` -> `setMetadata()` | setters individuels pdf-lib |
| `PDFEngine.get_page_dimensions()` | `engine/document-handle.ts` -> `getPageDimensions()` | `page.getSize()` + `page.getRotation()` |
| `PDFEngine.resize_page()` | `engine/page-ops.ts` -> `resizePage()` | `page.setMediaBox(0, 0, w, h)` |
| `PDFEngine.clear_all()` | Non necessaire - pas de store global | |

**Dependances**: aucune sur d'autres modules du package
**Risques**: Le pattern `movePage` n'est pas natif dans pdf-lib, necessite copie+suppression avec gestion des index qui bougent.
**Ordre d'execution**: 1 (premier module a implementer)

---

#### Fichier 2: `app/core/parser.py` -> `packages/pdf-engine/src/parse/`

| Element Python | Destination TS | Notes |
|---|---|---|
| `PDFParser.__init__(document_id, base_url)` | Parametres dans `ParseOptions` | Pas de classe, fonctions pures |
| `PDFParser.parse_document()` | `parse/parser.ts` -> `parseDocument()` | pdfjs-dist `getDocument()` puis iteration pages |
| `PDFParser.parse_page()` | `parse/parser.ts` -> `parsePage()` via sous-extracteurs | |
| `PDFParser._parse_metadata()` | `parse/metadata-extractor.ts` | `pdfDocument.getMetadata()` |
| `PDFParser._extract_text_elements()` | `parse/text-extractor.ts` | `page.getTextContent()` - mapping TextItem vers TextElement |
| `PDFParser._get_page_links()` | `parse/text-extractor.ts` (interne) | `page.getAnnotations()` filtre Link |
| `PDFParser._extract_image_elements()` | `parse/image-extractor.ts` | operator list parsing |
| `PDFParser._extract_drawings()` | `parse/drawing-extractor.ts` | operator list parsing (plus complexe) |
| `PDFParser._detect_corner_radius()` | `parse/drawing-extractor.ts` (interne) | Meme logique de detection Bezier |
| `PDFParser._extract_annotations()` | `parse/annotation-extractor.ts` | `page.getAnnotations()` filtre non-Widget |
| `PDFParser._extract_form_fields()` | `parse/form-extractor.ts` | `page.getAnnotations()` filtre Widget |
| `PDFParser._parse_bookmarks()` | `parse/bookmark-extractor.ts` | `pdfDocument.getOutline()` |
| `PDFParser._parse_layers()` | `parse/metadata-extractor.ts` | `pdfDocument.getOptionalContentConfig()` |
| `PDFParser._parse_embedded_files()` | `parse/metadata-extractor.ts` | `pdfDocument.getAttachments()` |
| `PDFParser._int_to_hex_color()` | `utils/color.ts` | |
| `PDFParser._tuple_to_hex_color()` | `utils/color.ts` | |
| `PDFParser._normalize_font_name()` | `utils/font-map.ts` | |

**Dependances**: `@giga-pdf/types` pour tous les types de sortie
**Risques**:
- L'extraction de drawings via operator list est significativement plus complexe qu'avec PyMuPDF. Il faut interpreter les operateurs PDF (moveTo, lineTo, curveTo, rectangle, fill, stroke, etc.) et reconstruire les paths. Prevoir 2-3x plus de code.
- Les `TextItem.transform` de pdfjs-dist utilisent une matrice 6-element, pas un simple bbox. La conversion en Bounds necessite un calcul matriciel.
- pdfjs-dist fonctionne en mode worker par defaut. En Node.js server-side, il faut desactiver le worker ou utiliser `GlobalWorkerOptions.workerSrc` avec un polyfill.
**Ordre d'execution**: 2 (depend de utils/)

---

#### Fichier 3: `app/core/renderer.py` -> `packages/pdf-engine/src/render/`

| Element Python | Destination TS | Notes |
|---|---|---|
| `PDFRenderer.__init__(doc)` | Pas de classe - chaque fonction recoit un `PDFDocumentHandle` | |
| `PDFRenderer.add_text()` | `render/text-renderer.ts` -> `addText()` | `page.drawText()` avec font embeddee |
| `PDFRenderer.update_text()` | `render/text-renderer.ts` -> `updateText()` | Redaction (rect blanc) + addText |
| `PDFRenderer.add_image()` | `render/image-renderer.ts` -> `addImage()` | `pdfDoc.embedPng/Jpg()` + `page.drawImage()` |
| `PDFRenderer.update_image()` | `render/image-renderer.ts` -> `updateImage()` | Redaction + addImage |
| `PDFRenderer.add_shape()` | `render/shape-renderer.ts` -> `addShape()` | `page.drawRectangle/Ellipse/Line()` |
| `PDFRenderer.add_annotation()` | `render/annotation-renderer.ts` -> `addAnnotation()` | Simulation via dessin ou raw dict injection |
| `PDFRenderer.add_form_field()` | `render/form-renderer.ts` -> `addFormField()` | `pdfDoc.getForm().createTextField()` etc. |
| `PDFRenderer.update_form_field_value()` | `render/form-renderer.ts` -> `updateFormFieldValue()` | `field.setText()` / `field.check()` etc. |
| `PDFRenderer.delete_element_area()` | `render/redaction.ts` -> `deleteElementArea()` | Rectangle blanc opaque |
| `PDFRenderer.flatten_annotations()` | `render/flatten.ts` -> `flattenAnnotations()` | `pdfDoc.getForm().flatten()` pour les champs; pour les annotations: update appearance stream |
| `PDFRenderer.flatten_forms()` | `render/flatten.ts` -> `flattenForms()` | `form.flatten()` |
| `PDFRenderer._hex_to_rgb()` | `utils/color.ts` | |
| `PDFRenderer._get_pdf_font()` | `utils/font-map.ts` | |

**Dependances**: `engine/` pour PDFDocumentHandle, `utils/` pour conversions
**Risques**:
- La simulation d'annotations (highlight, underline, strikeout) par dessin perd la semantique PDF native. Les annotations ne seront plus detectables comme telles par d'autres lecteurs PDF.
- Pour les vrais annotations PDF, il faudra injecter des dictionnaires PDF bruts via `pdfDoc.context.obj({})` - plus complexe mais preservant l'interop.
**Ordre d'execution**: 3 (depend de engine/ et utils/)

---

#### Fichier 4: `app/core/preview.py` -> `packages/pdf-engine/src/preview/`

| Element Python | Destination TS | Notes |
|---|---|---|
| `PreviewGenerator.__init__(doc)` | Pas de classe - fonctions avec buffer en entree | |
| `PreviewGenerator.render_page()` | `preview/renderer.ts` -> `renderPage()` | pdfjs-dist `page.render()` dans canvas du pool + sharp pour conversion format |
| `PreviewGenerator.render_thumbnail()` | `preview/thumbnail.ts` -> `renderThumbnail()` | Rendu basse resolution + sharp resize |
| `PreviewGenerator.render_all_thumbnails()` | `preview/thumbnail.ts` -> `renderAllThumbnails()` | Parallelise via pool |
| `PreviewGenerator._render_svg()` | Non migre en v1 | Complexe, faible priorite |
| `PreviewGenerator.extract_page_image()` | `preview/renderer.ts` -> `extractImage()` | Extraction via pdfjs-dist operator list |
| `PreviewGenerator.get_page_text_image()` | Non migre - reste en Python pour OCR | L'OCR reste cote FastAPI/Celery |

**Dependances**: `pdfjs-dist`, `canvas`, `sharp`
**Risques**:
- node-canvas (package `canvas`) requiert des binaires natifs (Cairo, Pango, librsvg). L'installation peut etre problematique sur certains OS. Prevoir un fallback ou documenter les prerequisites.
- Le pool de canvas doit gerer correctement la memoire. Un canvas 300 DPI d'une page A4 = ~8.7 MP = ~35 MB en RGBA. Avec 4 canvases en pool = ~140 MB de RAM dediee.
- pdfjs-dist en Node.js necessite un polyfill pour `DOMMatrix` et `Path2D`. Le package `canvas` les fournit generalement.
**Ordre d'execution**: 4 (depend de parse/ pour pdfjs-dist setup)

---

#### Fichier 5: `app/utils/coordinates.py` -> `packages/pdf-engine/src/utils/coordinates.ts`

| Element Python | Destination TS |
|---|---|
| `Point` (NamedTuple) | Import de `@giga-pdf/types` `Point` |
| `Rect` (NamedTuple) | Import de `@giga-pdf/types` `Bounds` |
| `pdf_to_web()` | `pdfToWeb(x, y, pageHeight): Point` |
| `web_to_pdf()` | `webToPdf(x, y, pageHeight): Point` |
| `pdf_rect_to_web()` | `pdfRectToWeb(x0, y0, x1, y1, pageHeight): Bounds` |
| `web_rect_to_pdf()` | `webRectToPdf(bounds, pageHeight): { x0, y0, x1, y1 }` |
| `apply_rotation()` | `applyRotation(x, y, rotation, pageWidth, pageHeight): Point` |
| `unapply_rotation()` | `unapplyRotation(x, y, rotation, pageWidth, pageHeight): Point` |

**Dependances**: `@giga-pdf/types`
**Risques**: Aucun - fonctions pures, conversion directe.
**Ordre d'execution**: 0 (aucune dependance, implementer en premier)

---

#### Fichier 6: `app/api/v1/merge_split.py` -> logique absorbee dans `merge-split/`

Seule la logique fitz est migree. Le routage HTTP, la validation, la gestion des sessions restent en Python (puis seront migrees vers Next.js API routes).

| Element Python | Destination TS |
|---|---|
| `fitz.open()` + `insert_pdf(from_page, to_page)` dans `merge_documents` | `merge-split/merge.ts` -> `mergePDFs()` |
| `fitz.open()` + `insert_pdf(from_page, to_page)` dans `split_document` | `merge-split/split.ts` -> `splitPDF()` + `splitAt()` |
| `parse_page_range()` | `utils/page-range.ts` |

**Ordre d'execution**: 5 (depend de engine/)

---

#### Fichier 7: `app/api/v1/security.py` -> logique absorbee dans `encrypt/`

| Element Python | Destination TS |
|---|---|
| Construction `perm` bitmask + `encryption_map` | `encrypt/pdf-encrypt.ts` -> `encryptPDF()` |
| `doc.authenticate(password)` + suppression encryption | `encrypt/pdf-decrypt.ts` -> `decryptPDF()` |
| Lecture `doc.permissions` + flags | `encrypt/permissions.ts` -> `getPermissions()` |

**Ordre d'execution**: 6 (depend de engine/)

---

#### Fichier 8: `app/api/v1/forms.py` -> logique absorbee dans `forms/`

| Element Python | Destination TS |
|---|---|
| Listing widgets sur toutes les pages | `forms/reader.ts` -> `getFormFields()` |
| Mise a jour des valeurs widget | `forms/filler.ts` -> `fillForm()` |
| Flatten des widgets | `forms/flattener.ts` -> `flattenForm()` |

**Ordre d'execution**: 7 (depend de engine/ et parse/)

---

#### Fichier 9: HTML/URL -> PDF (nouvelle fonctionnalite)

Pas de fichier Python correspondant. Nouvelle fonctionnalite utilisant Playwright.

**Ordre d'execution**: 8 (independant, peut etre parallelise)

### 4.3 Ordre d'implementation recommande

```
Phase 1 - Fondations (semaine 1)
  [0] utils/ (coordinates, color, font-map, page-range)
  [1] engine/ (openDocument, saveDocument, page operations)
  [2] errors.ts + constants.ts

Phase 2 - Parsing (semaine 2)
  [3] parse/metadata-extractor.ts
  [4] parse/text-extractor.ts
  [5] parse/image-extractor.ts
  [6] parse/annotation-extractor.ts
  [7] parse/form-extractor.ts
  [8] parse/bookmark-extractor.ts
  [9] parse/drawing-extractor.ts (le plus complexe)
  [10] parse/parser.ts (orchestrateur)

Phase 3 - Rendu (semaine 3)
  [11] render/text-renderer.ts
  [12] render/image-renderer.ts
  [13] render/shape-renderer.ts
  [14] render/redaction.ts
  [15] render/form-renderer.ts
  [16] render/annotation-renderer.ts
  [17] render/flatten.ts

Phase 4 - Modules complementaires (semaine 4)
  [18] merge-split/ (merge.ts, split.ts)
  [19] forms/ (reader.ts, filler.ts, flattener.ts)
  [20] encrypt/ (pdf-encrypt.ts, pdf-decrypt.ts, permissions.ts)

Phase 5 - Preview et Convert (semaine 5)
  [21] preview/pool.ts (canvas pool)
  [22] preview/renderer.ts
  [23] preview/thumbnail.ts
  [24] convert/pool.ts (playwright pool)
  [25] convert/html-to-pdf.ts
```

---

## 5. Configuration package.json

```json
{
  "name": "@giga-pdf/pdf-engine",
  "version": "0.1.0",
  "private": true,
  "description": "Core PDF manipulation engine for GigaPDF - parse, render, merge, split, encrypt, preview, convert",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    },
    "./engine": {
      "types": "./dist/engine/index.d.ts",
      "import": "./dist/engine/index.mjs",
      "require": "./dist/engine/index.js"
    },
    "./parse": {
      "types": "./dist/parse/index.d.ts",
      "import": "./dist/parse/index.mjs",
      "require": "./dist/parse/index.js"
    },
    "./render": {
      "types": "./dist/render/index.d.ts",
      "import": "./dist/render/index.mjs",
      "require": "./dist/render/index.js"
    },
    "./merge-split": {
      "types": "./dist/merge-split/index.d.ts",
      "import": "./dist/merge-split/index.mjs",
      "require": "./dist/merge-split/index.js"
    },
    "./forms": {
      "types": "./dist/forms/index.d.ts",
      "import": "./dist/forms/index.mjs",
      "require": "./dist/forms/index.js"
    },
    "./encrypt": {
      "types": "./dist/encrypt/index.d.ts",
      "import": "./dist/encrypt/index.mjs",
      "require": "./dist/encrypt/index.js"
    },
    "./preview": {
      "types": "./dist/preview/index.d.ts",
      "import": "./dist/preview/index.mjs",
      "require": "./dist/preview/index.js"
    },
    "./convert": {
      "types": "./dist/convert/index.d.ts",
      "import": "./dist/convert/index.mjs",
      "require": "./dist/convert/index.js"
    }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts",
    "type-check": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "pdf-lib": "^1.17.1",
    "pdfjs-dist": "^4.10.38",
    "canvas": "^3.1.0",
    "sharp": "^0.33.5",
    "node-forge": "^1.3.1",
    "playwright": "^1.50.1"
  },
  "peerDependencies": {
    "@giga-pdf/types": "workspace:*"
  },
  "devDependencies": {
    "@giga-pdf/eslint-config": "workspace:*",
    "@giga-pdf/typescript-config": "workspace:*",
    "@types/node-forge": "^1.3.11",
    "tsup": "^8.5.1",
    "typescript": "^5.9.3",
    "vitest": "^3.0.9"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### tsup.config.ts

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/engine/index.ts',
    'src/parse/index.ts',
    'src/render/index.ts',
    'src/merge-split/index.ts',
    'src/forms/index.ts',
    'src/encrypt/index.ts',
    'src/preview/index.ts',
    'src/convert/index.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  external: [
    'canvas',       // Native addon, must not be bundled
    'sharp',        // Native addon, must not be bundled
    'playwright',   // Binary, must not be bundled
  ],
  noExternal: [
    'pdf-lib',      // Pure JS, safe to bundle
    'node-forge',   // Pure JS, safe to bundle
  ],
});
```

### tsconfig.json

```json
{
  "extends": "@giga-pdf/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    testTimeout: 30000, // PDF operations can be slow
  },
});
```

---

## 6. Integration avec Next.js

### 6.1 Architecture API Routes

```
apps/web/src/app/api/pdf/
├── upload/
│   └── route.ts                    # POST - Upload PDF, parse, return scene graph
├── [documentId]/
│   ├── route.ts                    # GET - Get document info / DELETE - Close document
│   ├── save/
│   │   └── route.ts               # POST - Save document, return Buffer or upload to S3
│   ├── metadata/
│   │   └── route.ts               # GET / PATCH - Document metadata
│   ├── pages/
│   │   ├── route.ts               # POST - Add page
│   │   └── [pageNumber]/
│   │       ├── route.ts           # DELETE - Delete page / PATCH - Rotate/resize
│   │       ├── preview/
│   │       │   └── route.ts       # GET - Render page preview image
│   │       ├── thumbnail/
│   │       │   └── route.ts       # GET - Render thumbnail
│   │       ├── elements/
│   │       │   └── route.ts       # POST - Add element (text/image/shape/annotation)
│   │       └── images/
│   │           └── [imageIndex]/
│   │               └── route.ts   # GET - Extract embedded image
│   ├── parse/
│   │   └── route.ts               # GET - Re-parse document to scene graph
│   ├── merge/
│   │   └── route.ts               # POST - Merge with other documents
│   ├── split/
│   │   └── route.ts               # POST - Split document
│   ├── forms/
│   │   ├── route.ts               # GET - List form fields
│   │   ├── fill/
│   │   │   └── route.ts           # PUT - Fill form fields
│   │   └── flatten/
│   │       └── route.ts           # POST - Flatten forms
│   ├── security/
│   │   ├── encrypt/
│   │   │   └── route.ts           # POST - Encrypt document
│   │   ├── decrypt/
│   │   │   └── route.ts           # POST - Decrypt document
│   │   └── permissions/
│   │       └── route.ts           # GET / PUT - Permissions
│   └── export/
│       └── route.ts               # POST - Export to format
├── convert/
│   ├── html/
│   │   └── route.ts               # POST - HTML to PDF
│   └── url/
│       └── route.ts               # POST - URL to PDF
```

### 6.2 Gestion des documents en memoire

```typescript
// apps/web/src/lib/pdf/document-store.ts

import type { PDFDocumentHandle } from '@giga-pdf/pdf-engine';
import type { DocumentObject } from '@giga-pdf/types';

interface DocumentSession {
  handle: PDFDocumentHandle;
  sceneGraph: DocumentObject;
  originalBuffer: Buffer;
  ownerId: string | null;
  filename: string;
  fileSize: number;
  createdAt: Date;
  lastAccessedAt: Date;
}

/**
 * In-memory document store for active editing sessions.
 *
 * For production with multiple Next.js instances, this should be
 * replaced with a Redis-backed store where the PDF buffer is kept
 * in S3 and only metadata in Redis.
 */
class DocumentStore {
  private sessions = new Map<string, DocumentSession>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private maxSessionAgeMs = 30 * 60 * 1000) { // 30 min default
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  set(documentId: string, session: DocumentSession): void {
    this.sessions.set(documentId, session);
  }

  get(documentId: string): DocumentSession | undefined {
    const session = this.sessions.get(documentId);
    if (session) {
      session.lastAccessedAt = new Date();
    }
    return session;
  }

  delete(documentId: string): void {
    const session = this.sessions.get(documentId);
    if (session) {
      // closeDocument is sync and frees the handle
      // The GC will collect the pdf-lib PDFDocument
      this.sessions.delete(documentId);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastAccessedAt.getTime() > this.maxSessionAgeMs) {
        this.delete(id);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    for (const id of this.sessions.keys()) {
      this.delete(id);
    }
  }
}

// Singleton - survit aux hot reloads en dev grace a globalThis
const globalForStore = globalThis as unknown as { documentStore: DocumentStore };
export const documentStore = globalForStore.documentStore ?? new DocumentStore();
if (process.env.NODE_ENV !== 'production') {
  globalForStore.documentStore = documentStore;
}
```

### 6.3 Exemple d'API Route: Upload

```typescript
// apps/web/src/app/api/pdf/upload/route.ts

import { NextRequest, NextResponse } from 'next/server';
import {
  openDocument,
  parseDocument,
} from '@giga-pdf/pdf-engine';
import { documentStore } from '@/lib/pdf/document-store';
import { auth } from '@/lib/auth'; // Better Auth

export const runtime = 'nodejs'; // Required for Buffer operations
export const maxDuration = 60;   // 60s timeout for large files

export async function POST(request: NextRequest) {
  // Auth check
  const session = await auth.api.getSession({ headers: request.headers });

  // Parse multipart form data
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const password = formData.get('password') as string | null;

  if (!file) {
    return NextResponse.json(
      { success: false, error: 'No file provided' },
      { status: 400 }
    );
  }

  // Convert File to Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    // Open with pdf-lib via @giga-pdf/pdf-engine
    const handle = await openDocument(buffer, {
      password: password ?? undefined,
    });

    // Parse to scene graph with pdfjs-dist via @giga-pdf/pdf-engine
    const sceneGraph = await parseDocument(buffer, {
      extractText: true,
      extractImages: true,
      extractDrawings: true,
      extractAnnotations: true,
      extractFormFields: true,
      extractBookmarks: true,
      baseUrl: '/api/pdf',
      documentId: handle.id,
    });

    // Store in memory
    documentStore.set(handle.id, {
      handle,
      sceneGraph,
      originalBuffer: buffer,
      ownerId: session?.user?.id ?? null,
      filename: file.name,
      fileSize: buffer.length,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      data: {
        documentId: handle.id,
        sceneGraph,
      },
    });
  } catch (error) {
    // Map engine errors to HTTP status codes
    if (error instanceof Error) {
      const statusMap: Record<string, number> = {
        PDF_PARSE_ERROR: 400,
        PDF_CORRUPTED: 400,
        PDF_ENCRYPTED: 401,
        PDF_INVALID_PASSWORD: 401,
      };
      const code = (error as any).code;
      const status = statusMap[code] ?? 500;

      return NextResponse.json(
        { success: false, error: error.message, code },
        { status }
      );
    }
    throw error;
  }
}
```

### 6.4 Exemple d'API Route: Preview (streaming)

```typescript
// apps/web/src/app/api/pdf/[documentId]/pages/[pageNumber]/preview/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { renderPage } from '@giga-pdf/pdf-engine';
import { documentStore } from '@/lib/pdf/document-store';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string; pageNumber: string }> }
) {
  const { documentId, pageNumber: pageNumberStr } = await params;
  const pageNumber = parseInt(pageNumberStr, 10);

  const session = documentStore.get(documentId);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Document not found' },
      { status: 404 }
    );
  }

  // Parse query params
  const searchParams = request.nextUrl.searchParams;
  const dpi = Math.min(parseInt(searchParams.get('dpi') ?? '150', 10), 600);
  const format = (searchParams.get('format') ?? 'png') as 'png' | 'jpeg' | 'webp';
  const quality = parseInt(searchParams.get('quality') ?? '85', 10);

  try {
    const imageBuffer = await renderPage(
      session.originalBuffer,
      pageNumber,
      { dpi, format, quality }
    );

    const contentTypeMap = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
    };

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentTypeMap[format],
        'Content-Length': imageBuffer.length.toString(),
        'Cache-Control': 'private, max-age=300', // 5 min cache
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    );
  }
}
```

### 6.5 Gestion des buffers volumineux

**Probleme**: Les PDF peuvent atteindre des centaines de MB. Charger tout en memoire dans l'API Route Next.js est risque.

**Strategie en 3 niveaux**:

1. **Petits fichiers (< 10 MB)**: Buffer en memoire, traitement synchrone dans l'API Route. C'est le cas le plus courant.

2. **Fichiers moyens (10-100 MB)**: Buffer en memoire mais avec streaming de la reponse:
   ```typescript
   // Utiliser ReadableStream pour la reponse
   const stream = new ReadableStream({
     start(controller) {
       controller.enqueue(pdfBuffer);
       controller.close();
     },
   });
   return new NextResponse(stream, { headers: { ... } });
   ```

3. **Gros fichiers (> 100 MB)**: Upload vers S3, traitement differe:
   ```
   Client -> Upload to S3 (presigned URL) -> Notify API -> Job queue
   Job worker: Download from S3 -> Process -> Upload result to S3 -> Notify
   Client: Poll job status -> Download from S3 (presigned URL)
   ```
   Ce workflow utilise le pattern job existant de FastAPI/Celery. A terme, le worker sera un processus Node.js au lieu de Celery.

### 6.6 Connection S3

```typescript
// apps/web/src/lib/pdf/s3.ts
// Reutilise le package @giga-pdf/s3 existant dans le monorepo

import { S3Client } from '@giga-pdf/s3';

export async function uploadPDF(
  buffer: Buffer,
  key: string
): Promise<string> {
  const s3 = new S3Client();
  return s3.upload(buffer, key, 'application/pdf');
}

export async function downloadPDF(key: string): Promise<Buffer> {
  const s3 = new S3Client();
  return s3.download(key);
}

export async function getPresignedUploadUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const s3 = new S3Client();
  return s3.getPresignedUploadUrl(key, expiresIn);
}

export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const s3 = new S3Client();
  return s3.getPresignedDownloadUrl(key, expiresIn);
}
```

### 6.7 Utilisation depuis apps/admin

L'app admin (apps/admin/) importe `@giga-pdf/pdf-engine` de la meme maniere dans ses API Routes. La structure de routes sera miroir ou un sous-ensemble de celle de web:

```
apps/admin/src/app/api/pdf/
├── [documentId]/
│   ├── route.ts
│   ├── pages/[pageNumber]/preview/route.ts
│   └── ...
```

### 6.8 Utilisation depuis le mobile (apps/mobile/)

L'app mobile React Native n'importe PAS `@giga-pdf/pdf-engine` directement (c'est un package Node.js server-side). Le mobile appelle les API Routes Next.js via HTTP:

```typescript
// apps/mobile/src/api/pdf.ts
const API_URL = process.env.EXPO_PUBLIC_API_URL;

export async function uploadPDF(file: File): Promise<DocumentResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_URL}/api/pdf/upload`, {
    method: 'POST',
    body: formData,
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function getPagePreview(
  documentId: string,
  pageNumber: number,
  dpi = 150
): Promise<string> {
  // Returns the URL directly, mobile displays via Image component
  return `${API_URL}/api/pdf/${documentId}/pages/${pageNumber}/preview?dpi=${dpi}`;
}
```

---

## Annexe A: Gestion memoire et pools

### Pool de Canvas (preview/)

```typescript
// src/preview/pool.ts

import { createCanvas, type Canvas } from 'canvas';

interface CanvasPoolItem {
  canvas: Canvas;
  ctx: CanvasRenderingContext2D;
  inUse: boolean;
}

class CanvasPool {
  private pool: CanvasPoolItem[] = [];
  private waitQueue: Array<(item: CanvasPoolItem) => void> = [];
  private maxSize: number;

  constructor(maxSize = 4) {
    this.maxSize = maxSize;
  }

  async acquire(width: number, height: number): Promise<CanvasPoolItem> {
    // Try to find a free canvas
    const free = this.pool.find(item => !item.inUse);
    if (free) {
      free.inUse = true;
      // Resize if needed
      if (free.canvas.width !== width || free.canvas.height !== height) {
        free.canvas.width = width;
        free.canvas.height = height;
      }
      return free;
    }

    // Create new if under limit
    if (this.pool.length < this.maxSize) {
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const item: CanvasPoolItem = { canvas, ctx, inUse: true };
      this.pool.push(item);
      return item;
    }

    // Wait for one to become available
    return new Promise(resolve => {
      this.waitQueue.push(resolve);
    });
  }

  release(item: CanvasPoolItem): void {
    item.inUse = false;
    // Clear canvas to free pixel memory reference
    item.ctx.clearRect(0, 0, item.canvas.width, item.canvas.height);

    // Fulfill waiting request if any
    const waiter = this.waitQueue.shift();
    if (waiter) {
      item.inUse = true;
      waiter(item);
    }
  }

  destroy(): void {
    this.pool = [];
    this.waitQueue = [];
  }

  setMaxSize(size: number): void {
    this.maxSize = size;
  }
}

export const canvasPool = new CanvasPool();
```

### Pool Playwright (convert/)

```typescript
// src/convert/pool.ts

import type { Browser, BrowserContext } from 'playwright';

class PlaywrightPool {
  private browser: Browser | null = null;
  private contexts: BrowserContext[] = [];
  private available: BrowserContext[] = [];
  private waitQueue: Array<(ctx: BrowserContext) => void> = [];
  private maxSize: number;

  constructor(maxSize = 2) {
    this.maxSize = maxSize;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      const { chromium } = await import('playwright');
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
    }
    return this.browser;
  }

  async acquire(): Promise<BrowserContext> {
    // Return available context
    const free = this.available.pop();
    if (free) return free;

    // Create new if under limit
    if (this.contexts.length < this.maxSize) {
      const browser = await this.ensureBrowser();
      const ctx = await browser.newContext();
      this.contexts.push(ctx);
      return ctx;
    }

    // Wait
    return new Promise(resolve => {
      this.waitQueue.push(resolve);
    });
  }

  release(ctx: BrowserContext): void {
    const waiter = this.waitQueue.shift();
    if (waiter) {
      waiter(ctx);
    } else {
      this.available.push(ctx);
    }
  }

  async destroy(): Promise<void> {
    for (const ctx of this.contexts) {
      await ctx.close().catch(() => {});
    }
    this.contexts = [];
    this.available = [];
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  setMaxSize(size: number): void {
    this.maxSize = size;
  }
}

export const playwrightPool = new PlaywrightPool();
```

---

## Annexe B: Initialisation pdfjs-dist en Node.js

pdfjs-dist en environnement Node.js necessite une configuration specifique:

```typescript
// src/parse/pdfjs-setup.ts

import * as pdfjsLib from 'pdfjs-dist';

// Disable web worker in Node.js (runs synchronously in main thread)
// In production, consider using worker_threads for heavy documents
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

// Node.js canvas factory for pdfjs-dist rendering
// Required when using page.render() for preview generation
import { createCanvas } from 'canvas';

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }

  reset(canvasAndContext: { canvas: any; context: any }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: { canvas: any; context: any }) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

export const nodeCanvasFactory = new NodeCanvasFactory();

/**
 * Load a PDF document with pdfjs-dist.
 * Centralized setup ensures correct Node.js configuration.
 */
export async function loadPdfjsDocument(
  buffer: Buffer,
  password?: string
) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    password,
    // Use node-canvas for rendering
    canvasFactory: nodeCanvasFactory as any,
    // Enable cMap for CJK fonts
    cMapUrl: undefined,
    cMapPacked: true,
    // Disable range requests (we have the full buffer)
    disableRange: true,
    disableStream: true,
  });

  return loadingTask.promise;
}
```

---

## Annexe C: Matrice de risques

| Risque | Probabilite | Impact | Mitigation |
|--------|------------|--------|------------|
| Drawing extraction via operator list trop complexe | Haute | Moyen | Implementer un sous-ensemble (rectangles, lignes) en v1. Les paths complexes seront ajoutes iterativement. |
| node-canvas binaires natifs : problemes d'installation CI/CD | Moyenne | Haut | Utiliser les images Docker pre-buildees avec Cairo. Documenter les pre-requis OS. Alternative: `@napi-rs/canvas` (pure Rust binding). |
| Fuite memoire canvas pool sous charge | Moyenne | Haut | Monitoring de la taille du pool + cleanup force apres N rendus. Limiter la resolution max a 300 DPI par defaut. |
| pdfjs-dist worker_threads pour les gros PDF | Basse | Moyen | v1 sans workers. v2: utiliser `worker_threads` avec `SharedArrayBuffer` pour les PDF > 50 pages. |
| pdf-lib ne supporte pas les annotations PDF natives | Haute | Moyen | v1: simuler les annotations par du dessin. v2: injection de dictionnaires PDF bruts pour preserverr la semantique. |
| Playwright pool crash sous charge | Basse | Moyen | Heartbeat check + recreation automatique du browser. Timeout strict de 30s par conversion. |
| Incompatibilite de coordonnees pdfjs-dist vs PyMuPDF | Moyenne | Haut | Tests exhaustifs avec les memes PDFs de reference. Comparer les resultats pixel par pixel pour les previews. |
| Taille du bundle trop grande pour Next.js | Basse | Faible | Les packages natifs (canvas, sharp, playwright) sont external dans tsup. pdf-lib et node-forge sont ~200KB bundles, acceptable. |
