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
  ElementOperationOptions,
  ConvertOptions,
  MetadataResult,
  FlattenOptions,
  ApplyElementsOperation,
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

/**
 * Hook for text operations on a PDF
 */
export const usePdfTextOperation = () => {
  return useMutation({
    mutationFn: ({ file, options }: { file: File | Blob; options: ElementOperationOptions }) =>
      pdfService.textOperation(file, options),
  });
};

/**
 * Hook for image operations on a PDF
 */
export const usePdfImageOperation = () => {
  return useMutation({
    mutationFn: ({ file, options }: { file: File | Blob; options: ElementOperationOptions }) =>
      pdfService.imageOperation(file, options),
  });
};

/**
 * Hook for shape operations on a PDF
 */
export const usePdfShapeOperation = () => {
  return useMutation({
    mutationFn: ({ file, options }: { file: File | Blob; options: ElementOperationOptions }) =>
      pdfService.shapeOperation(file, options),
  });
};

/**
 * Hook for annotation operations on a PDF
 */
export const usePdfAnnotationOperation = () => {
  return useMutation({
    mutationFn: ({ file, options }: { file: File | Blob; options: ElementOperationOptions }) =>
      pdfService.annotationOperation(file, options),
  });
};

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
  ElementOperationOptions,
  ConvertOptions,
  MetadataResult,
  FlattenOptions,
  ApplyElementsOperation,
};
