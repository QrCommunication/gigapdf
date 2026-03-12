import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pageService } from '../services/pages';
import { documentKeys } from './use-documents';
import type { Page, CreatePageRequest } from '@giga-pdf/types';

/**
 * Query keys for page-related queries
 *
 * NOTE: The backend identifies pages by page_number (integer), not a UUID.
 */
export const pageKeys = {
  all: ['pages'] as const,
  details: () => [...pageKeys.all, 'detail'] as const,
  detail: (documentId: string, pageNumber: number) =>
    [...pageKeys.details(), documentId, pageNumber] as const,
  preview: (documentId: string, pageNumber: number) =>
    [...pageKeys.detail(documentId, pageNumber), 'preview'] as const,
};

/**
 * Hook to get a single page by page number
 * Backend: GET /documents/{document_id}/pages/{page_number}
 */
export const usePage = (documentId: string, pageNumber: number, enabled = true) => {
  return useQuery({
    queryKey: pageKeys.detail(documentId, pageNumber),
    queryFn: () => pageService.get(documentId, pageNumber),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Hook to add a new page to a document
 * Backend: POST /documents/{document_id}/pages
 */
export const useCreatePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, data }: { documentId: string; data: CreatePageRequest }) =>
      pageService.create(documentId, data),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
    },
  });
};

/**
 * Hook to delete a page by page number
 * Backend: DELETE /documents/{document_id}/pages/{page_number}
 */
export const useDeletePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, pageNumber }: { documentId: string; pageNumber: number }) =>
      pageService.delete(documentId, pageNumber),
    onSuccess: (_, { documentId, pageNumber }) => {
      queryClient.removeQueries({ queryKey: pageKeys.detail(documentId, pageNumber) });
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
    },
  });
};

/**
 * Hook to reorder pages
 * Backend: PUT /documents/{document_id}/pages/reorder
 */
export const useReorderPages = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, pageOrder }: { documentId: string; pageOrder: number[] }) =>
      pageService.reorder(documentId, pageOrder),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
    },
  });
};

/**
 * Hook to rotate a page
 * Backend: PUT /documents/{document_id}/pages/{page_number}/rotate
 */
export const useRotatePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageNumber,
      angle,
    }: {
      documentId: string;
      pageNumber: number;
      angle: 90 | 180 | 270;
    }) => pageService.rotate(documentId, pageNumber, angle),
    onSuccess: (data: Page, { documentId, pageNumber }) => {
      queryClient.setQueryData(pageKeys.detail(documentId, pageNumber), data);
    },
  });
};

/**
 * Hook to resize a page
 * Backend: PUT /documents/{document_id}/pages/{page_number}/resize
 */
export const useResizePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageNumber,
      dimensions,
    }: {
      documentId: string;
      pageNumber: number;
      dimensions: { width: number; height: number };
    }) => pageService.resize(documentId, pageNumber, dimensions),
    onSuccess: (data: Page, { documentId, pageNumber }) => {
      queryClient.setQueryData(pageKeys.detail(documentId, pageNumber), data);
    },
  });
};

/**
 * Hook to extract pages into a new document
 * Backend: POST /documents/{document_id}/pages/extract
 */
export const useExtractPages = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageNumbers,
    }: {
      documentId: string;
      pageNumbers: number[];
    }) => pageService.extract(documentId, pageNumbers),
    onSuccess: () => {
      // Invalidate document list as a new document is created
      queryClient.invalidateQueries({ queryKey: ['storage', 'documents'] });
    },
  });
};

/**
 * Hook to get page preview
 * Backend: GET /documents/{document_id}/pages/{page_number}/preview
 */
export const usePagePreview = (
  documentId: string,
  pageNumber: number,
  params?: { width?: number; height?: number; format?: string },
  enabled = true
) => {
  return useQuery({
    queryKey: [...pageKeys.preview(documentId, pageNumber), params],
    queryFn: () => pageService.getPreview(documentId, pageNumber, params),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

/**
 * Hook to get a page image by xref
 * Backend: GET /documents/{document_id}/pages/{page_number}/images/{image_xref}
 */
export const usePageImage = (
  documentId: string,
  pageNumber: number,
  imageXref: number,
  enabled = true
) => {
  return useQuery({
    queryKey: [...pageKeys.detail(documentId, pageNumber), 'image', imageXref],
    queryFn: () => pageService.getPageImage(documentId, pageNumber, imageXref),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

/**
 * Hook to duplicate a page
 * TODO: Backend endpoint not yet implemented
 */
export const useDuplicatePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, pageNumber }: { documentId: string; pageNumber: number }) =>
      pageService.duplicate(documentId, pageNumber),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
    },
  });
};

/**
 * Hook to move a page to another document
 * TODO: Backend endpoint not yet implemented
 */
export const useMovePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageNumber,
      targetDocumentId,
      position,
    }: {
      documentId: string;
      pageNumber: number;
      targetDocumentId: string;
      position?: number;
    }) => pageService.move(documentId, pageNumber, targetDocumentId, position),
    onSuccess: (_, { documentId, targetDocumentId }) => {
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(targetDocumentId) });
    },
  });
};
