import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pageService } from '../services/pages';
import { documentKeys } from './use-documents';
import type { Page, CreatePageRequest, UpdatePageRequest } from '@giga-pdf/types';

/**
 * Query keys for page-related queries
 */
export const pageKeys = {
  all: ['pages'] as const,
  lists: () => [...pageKeys.all, 'list'] as const,
  list: (documentId: string) => [...pageKeys.lists(), documentId] as const,
  details: () => [...pageKeys.all, 'detail'] as const,
  detail: (documentId: string, pageId: string) =>
    [...pageKeys.details(), documentId, pageId] as const,
  thumbnail: (documentId: string, pageId: string) =>
    [...pageKeys.detail(documentId, pageId), 'thumbnail'] as const,
};

/**
 * Hook to list pages for a document
 */
export const usePages = (documentId: string, enabled = true) => {
  return useQuery({
    queryKey: pageKeys.list(documentId),
    queryFn: () => pageService.list(documentId),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Hook to get a single page
 */
export const usePage = (documentId: string, pageId: string, enabled = true) => {
  return useQuery({
    queryKey: pageKeys.detail(documentId, pageId),
    queryFn: () => pageService.get(documentId, pageId),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Hook to create a page
 */
export const useCreatePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, data }: { documentId: string; data: CreatePageRequest }) =>
      pageService.create(documentId, data),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: pageKeys.list(documentId) });
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
    },
  });
};

/**
 * Hook to update a page
 */
export const useUpdatePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageId,
      data,
    }: {
      documentId: string;
      pageId: string;
      data: UpdatePageRequest;
    }) => pageService.update(documentId, pageId, data),
    onSuccess: (data: Page, { documentId }) => {
      queryClient.setQueryData(pageKeys.detail(documentId, data.id), data);
      queryClient.invalidateQueries({ queryKey: pageKeys.list(documentId) });
    },
  });
};

/**
 * Hook to delete a page
 */
export const useDeletePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, pageId }: { documentId: string; pageId: string }) =>
      pageService.delete(documentId, pageId),
    onSuccess: (_, { documentId, pageId }) => {
      queryClient.removeQueries({ queryKey: pageKeys.detail(documentId, pageId) });
      queryClient.invalidateQueries({ queryKey: pageKeys.list(documentId) });
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
    },
  });
};

/**
 * Hook to duplicate a page
 */
export const useDuplicatePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, pageId }: { documentId: string; pageId: string }) =>
      pageService.duplicate(documentId, pageId),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: pageKeys.list(documentId) });
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
    },
  });
};

/**
 * Hook to reorder pages
 */
export const useReorderPages = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, pageIds }: { documentId: string; pageIds: string[] }) =>
      pageService.reorder(documentId, pageIds),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: pageKeys.list(documentId) });
    },
  });
};

/**
 * Hook to move a page to another document
 */
export const useMovePage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageId,
      targetDocumentId,
      position,
    }: {
      documentId: string;
      pageId: string;
      targetDocumentId: string;
      position?: number;
    }) => pageService.move(documentId, pageId, targetDocumentId, position),
    onSuccess: (_, { documentId, targetDocumentId }) => {
      queryClient.invalidateQueries({ queryKey: pageKeys.list(documentId) });
      queryClient.invalidateQueries({ queryKey: pageKeys.list(targetDocumentId) });
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(targetDocumentId) });
    },
  });
};

/**
 * Hook to get page thumbnail
 */
export const usePageThumbnail = (
  documentId: string,
  pageId: string,
  width?: number,
  height?: number,
  enabled = true
) => {
  return useQuery({
    queryKey: [...pageKeys.thumbnail(documentId, pageId), width, height],
    queryFn: () => pageService.getThumbnail(documentId, pageId, width, height),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
