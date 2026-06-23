import { useMutation } from '@tanstack/react-query';
import { pdfService } from '../services/pdf';
import type {
  OpenPdfOptions,
  OpenPdfResult,
  SavePdfOptions,
  MergePdfOptions,
  SplitPdfOptions,
  SplitPdfResult,
  PreviewOptions,
  AllThumbnailsResult,
  EncryptOptions,
  PermissionsResult,
  FormFieldsResult,
  ConvertOptions,
  MetadataResult,
  FlattenOptions,
  ApplyElementsOperation,
  ParagraphStyleEdit,
  ListEdit,
} from '../services/pdf';
import type { DocumentMetadata, FormFieldElement } from '@giga-pdf/types';

/**
 * Query keys for PDF operations
 */
export const pdfKeys = {
  all: ['pdf'] as const,
  previews: () => [...pdfKeys.all, 'preview'] as const,
  preview: (id: string, page: number) => [...pdfKeys.previews(), id, page] as const,
  thumbnails: () => [...pdfKeys.all, 'thumbnails'] as const,
  thumbnail: (id: string) => [...pdfKeys.thumbnails(), id] as const,
  forms: () => [...pdfKeys.all, 'forms'] as const,
  formFields: (id: string) => [...pdfKeys.forms(), id] as const,
  permissions: () => [...pdfKeys.all, 'permissions'] as const,
  permission: (id: string) => [...pdfKeys.permissions(), id] as const,
  metadata: () => [...pdfKeys.all, 'metadata'] as const,
  metadataDetail: (id: string) => [...pdfKeys.metadata(), id] as const,
};

// ─── Open / Parse ────────────────────────────────────────────────────────────

/**
 * Hook to open/parse a PDF file
 */
export const useOpenPdf = () => {
  return useMutation({
    mutationFn: ({ file, options }: { file: File | Blob; options?: OpenPdfOptions }) =>
      pdfService.openPdf(file, options),
  });
};

// ─── Save ────────────────────────────────────────────────────────────────────

/**
 * Hook to save/normalize a PDF
 */
export const useSavePdf = () => {
  return useMutation({
    mutationFn: ({ file, options }: { file: File | Blob; options?: SavePdfOptions }) =>
      pdfService.savePdf(file, options),
  });
};

// ─── Merge ───────────────────────────────────────────────────────────────────

/**
 * Hook to merge multiple PDFs
 */
export const useMergePdfs = () => {
  return useMutation({
    mutationFn: ({ files, options }: { files: File[]; options?: MergePdfOptions }) =>
      pdfService.mergePdfs(files, options),
  });
};

// ─── Split ───────────────────────────────────────────────────────────────────

/**
 * Hook to split a PDF
 */
export const useSplitPdf = () => {
  return useMutation({
    mutationFn: ({ file, options }: { file: File | Blob; options: SplitPdfOptions }) =>
      pdfService.splitPdf(file, options),
  });
};

// ─── Preview ─────────────────────────────────────────────────────────────────

/**
 * Hook to render a single page preview (mutation-based for file input)
 */
export const usePreviewPage = () => {
  return useMutation({
    mutationFn: ({ file, options }: { file: File | Blob; options?: PreviewOptions }) =>
      pdfService.previewPage(file, options),
  });
};

/**
 * Hook to render all page thumbnails
 */
export const usePreviewAllThumbnails = () => {
  return useMutation({
    mutationFn: ({
      file,
      options,
    }: {
      file: File | Blob;
      options?: Omit<PreviewOptions, 'mode' | 'pageNumber'>;
    }) => pdfService.previewAllThumbnails(file, options),
  });
};

// ─── Encrypt / Decrypt ──────────────────────────────────────────────────────

/**
 * Hook to encrypt a PDF
 */
export const useEncryptPdf = () => {
  return useMutation({
    mutationFn: ({ file, options }: { file: File | Blob; options: EncryptOptions }) =>
      pdfService.encryptPdf(file, options),
  });
};

/**
 * Hook to decrypt a PDF
 */
export const useDecryptPdf = () => {
  return useMutation({
    mutationFn: ({ file, password }: { file: File | Blob; password: string }) =>
      pdfService.decryptPdf(file, password),
  });
};

/**
 * Hook to get PDF permissions
 */
export const useGetPermissions = () => {
  return useMutation({
    mutationFn: (file: File | Blob) => pdfService.getPermissions(file),
  });
};

/**
 * Hook to set PDF permissions
 */
export const useSetPermissions = () => {
  return useMutation({
    mutationFn: ({
      file,
      ownerPassword,
      permissions,
    }: {
      file: File | Blob;
      ownerPassword: string;
      permissions: Record<string, boolean>;
    }) => pdfService.setPermissions(file, ownerPassword, permissions),
  });
};

// ─── Forms ───────────────────────────────────────────────────────────────────

/**
 * Hook to get form fields from a PDF
 */
export const useGetFormFields = () => {
  return useMutation({
    mutationFn: (file: File | Blob) => pdfService.getFormFields(file),
  });
};

/**
 * Hook to fill form fields
 */
export const useFillFormFields = () => {
  return useMutation({
    mutationFn: ({
      file,
      values,
    }: {
      file: File | Blob;
      values: Record<string, string | boolean | string[]>;
    }) => pdfService.fillFormFields(file, values),
  });
};

/**
 * Hook to add a form field
 */
export const useAddFormField = () => {
  return useMutation({
    mutationFn: ({
      file,
      pageNumber,
      field,
    }: {
      file: File | Blob;
      pageNumber: number;
      field: FormFieldElement;
    }) => pdfService.addFormField(file, pageNumber, field),
  });
};

// ─── Element Operations ──────────────────────────────────────────────────────
//
// The legacy single-element hooks (usePdfTextOperation, usePdfImageOperation,
// usePdfShapeOperation, usePdfAnnotationOperation) were removed: the editor
// now batches every add/update/delete through useApplyElements which goes
// through the canonical 2-pass pipeline (native redaction pass → native add pass). The
// underlying /api/pdf/text and /api/pdf/image routes still exist for external
// integrations and have been migrated to call applyOperations internally too.

// ─── Pages ───────────────────────────────────────────────────────────────────

/**
 * Hook for page operations (extract, rotate, delete, reorder)
 */
export const usePdfPageOperation = () => {
  return useMutation({
    mutationFn: ({
      file,
      operation,
      params,
    }: {
      file: File | Blob;
      operation: string;
      params?: Record<string, unknown>;
    }) => pdfService.pageOperation(file, operation, params),
  });
};

// ─── Metadata ────────────────────────────────────────────────────────────────

/**
 * Hook to get PDF metadata
 */
export const useGetPdfMetadata = () => {
  return useMutation({
    mutationFn: (file: File | Blob) =>
      pdfService.metadata(file, 'get') as Promise<MetadataResult>,
  });
};

/**
 * Hook to set PDF metadata
 */
export const useSetPdfMetadata = () => {
  return useMutation({
    mutationFn: ({ file, metadata }: { file: File | Blob; metadata: Partial<DocumentMetadata> }) =>
      pdfService.metadata(file, 'set', metadata) as Promise<Blob>,
  });
};

// ─── Flatten ─────────────────────────────────────────────────────────────────

/**
 * Hook to flatten PDF layers
 */
export const useFlattenPdf = () => {
  return useMutation({
    mutationFn: ({ file, options }: { file: File | Blob; options?: FlattenOptions }) =>
      pdfService.flattenPdf(file, options),
  });
};

// ─── Convert ─────────────────────────────────────────────────────────────────

/**
 * Hook to convert HTML to PDF
 */
export const useConvertToPdf = () => {
  return useMutation({
    mutationFn: (options: ConvertOptions) => pdfService.convertToPdf(options),
  });
};

// ─── Apply Elements ───────────────────────────────────────────────────────────

/**
 * Hook to apply an ordered batch of element operations (add, update, delete)
 * to a PDF in a single round-trip. Returns the modified PDF as a Blob.
 */
export const useApplyElements = () => {
  return useMutation({
    mutationFn: ({
      file,
      operations,
    }: {
      file: File | Blob;
      operations: ApplyElementsOperation[];
    }) => pdfService.applyElements(file, operations),
  });
};

/**
 * Hook to bake native paragraph-style / list-level formatting into a PDF via
 * the engine's unified model (`setParagraphStyle` / `setList*` model ops keyed
 * by the editor's flat run index). Returns the modified PDF as a Blob.
 */
export const useApplyModelOps = () => {
  return useMutation({
    mutationFn: ({
      file,
      edits,
    }: {
      file: File | Blob;
      edits: { paragraphs?: ParagraphStyleEdit[]; lists?: ListEdit[] };
    }) => pdfService.applyModelOps(file, edits),
  });
};

// ─── Engine-powered features (search, watermark, OCR, PDF/A) ─────────────────

/** Full-text search in a PDF — returns hits with PDF user-space quads. */
export const useSearchPdf = () => {
  return useMutation({
    mutationFn: ({
      file,
      needle,
      options,
    }: {
      file: File | Blob;
      needle: string;
      options?: { pages?: number[]; maxHitsPerPage?: number };
    }) => pdfService.searchPdf(file, needle, options),
  });
};

/** Stamp a watermark on every page (or selected pages). */
export const useAddWatermark = () => {
  return useMutation({
    mutationFn: ({
      file,
      options,
    }: {
      file: File | Blob;
      options: Parameters<typeof pdfService.addWatermark>[1];
    }) => pdfService.addWatermark(file, options),
  });
};

/**
 * Sign a PDF with a PKCS#7 detached signature using a user-provided
 * P12/PFX certificate. The certificate and passphrase only transit in the
 * request body — never stored nor logged.
 */
export const useSignPdf = () => {
  return useMutation({
    mutationFn: ({
      file,
      p12,
      passphrase,
      options,
    }: {
      file: File | Blob;
      p12: File | Blob;
      passphrase: string;
      options?: Parameters<typeof pdfService.signPdf>[3];
    }) => pdfService.signPdf(file, p12, passphrase, options),
  });
};

/** Run OCR on each page of a PDF. */
export const useOcrPdf = () => {
  return useMutation({
    mutationFn: ({
      file,
      options,
    }: {
      file: File | Blob;
      options?: Parameters<typeof pdfService.ocrPdf>[1];
    }) => pdfService.ocrPdf(file, options),
  });
};

/**
 * Bake an invisible OCR text layer into the PDF so it becomes searchable
 * and selectable. Returns the modified PDF Blob + pages/words stats.
 */
export const useMakeSearchablePdf = () => {
  return useMutation({
    mutationFn: ({
      file,
      options,
    }: {
      file: File | Blob;
      options?: Parameters<typeof pdfService.makeSearchablePdf>[1];
    }) => pdfService.makeSearchablePdf(file, options),
  });
};

/**
 * Run OCR and produce an EDITABLE PDF: each scanned text zone is masked with its
 * local background colour and a real, visible OCR text run is laid on top, so the
 * recognized text can be edited in the editor. Returns the modified PDF Blob +
 * pages/words/masks stats.
 */
export const useMakeEditableOcrPdf = () => {
  return useMutation({
    mutationFn: ({
      file,
      options,
    }: {
      file: File | Blob;
      options?: Parameters<typeof pdfService.makeEditableOcrPdf>[1];
    }) => pdfService.makeEditableOcrPdf(file, options),
  });
};

/**
 * Compress a PDF (native normalisation + garbage collection).
 * Resolves with the compressed Blob and the before/after sizes in bytes.
 */
export const useCompressPdf = () => {
  return useMutation({
    mutationFn: ({ file }: { file: File | Blob }) => pdfService.compressPdf(file),
  });
};

/** Check if the server can run OCR. */
export const useIsOcrAvailable = () => {
  return useMutation({
    mutationFn: () => pdfService.isOcrAvailable(),
  });
};

/** Convert a PDF to PDF/A (archival format). */
export const useConvertToPdfA = () => {
  return useMutation({
    mutationFn: ({
      file,
      variant,
    }: {
      file: File | Blob;
      variant?: Parameters<typeof pdfService.convertToPdfA>[1];
    }) => pdfService.convertToPdfA(file, variant),
  });
};

// ─── Download Helper ─────────────────────────────────────────────────────────

/**
 * Utility to trigger browser download from a Blob
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Re-export types for consumer convenience
export type {
  OpenPdfOptions,
  OpenPdfResult,
  SavePdfOptions,
  MergePdfOptions,
  SplitPdfOptions,
  SplitPdfResult,
  PreviewOptions,
  AllThumbnailsResult,
  EncryptOptions,
  PermissionsResult,
  FormFieldsResult,
  ConvertOptions,
  MetadataResult,
  FlattenOptions,
  ApplyElementsOperation,
};
