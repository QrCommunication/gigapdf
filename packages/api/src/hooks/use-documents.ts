import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
import { documentService } from '../services/documents';
import type {
  Document,
  CreateDocumentRequest,
  UpdateDocumentRequest,
  DocumentListParams,
} from '@giga-pdf/types';

/**
 * Query keys for document-related queries
 */
export const documentKeys = {
  all: ['documents'] as const,
  lists: () => [...documentKeys.all, 'list'] as const,
  list: (params?: DocumentListParams) => [...documentKeys.lists(), params] as const,
  details: () => [...documentKeys.all, 'detail'] as const,
  detail: (id: string) => [...documentKeys.details(), id] as const,
  history: (id: string) => [...documentKeys.detail(id), 'history'] as const,
};

/**
 * Hook to list documents with pagination
 */
export const useDocuments = (params?: DocumentListParams) => {
  return useQuery({
    queryKey: documentKeys.list(params),
    queryFn: () => documentService.list(params),
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Hook to list documents with infinite scroll
 */
export const useInfiniteDocuments = (params?: Omit<DocumentListParams, 'offset'>) => {
  return useInfiniteQuery({
    queryKey: documentKeys.list(params),
    queryFn: ({ pageParam = 0 }) =>
      documentService.list({ ...params, offset: pageParam }),
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((acc, page) => acc + page.items.length, 0);
      const total = lastPage.total ?? lastPage.pagination?.total ?? 0;
      return loadedCount < total ? loadedCount : undefined;
    },
    initialPageParam: 0,
  });
};

/**
 * Hook to get a single document
 */
export const useDocument = (id: string, enabled = true) => {
  return useQuery({
    queryKey: documentKeys.detail(id),
    queryFn: () => documentService.get(id),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Hook to create a document
 */
export const useCreateDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDocumentRequest) => documentService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
};

/**
 * Hook to update a document
 */
export const useUpdateDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDocumentRequest }) =>
      documentService.update(id, data),
    onSuccess: (data: Document) => {
      queryClient.setQueryData(documentKeys.detail(data.id), data);
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
};

/**
 * Hook to delete a document
 */
export const useDeleteDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => documentService.delete(id),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: documentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
};

/**
 * Hook to duplicate a document
 */
export const useDuplicateDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title?: string }) =>
      documentService.duplicate(id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
};

/**
 * Hook to share a document
 */
export const useShareDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      collaborators,
    }: {
      id: string;
      collaborators: { email: string; permission: 'view' | 'edit' }[];
    }) => documentService.share(id, collaborators),
    onSuccess: (data: Document) => {
      queryClient.setQueryData(documentKeys.detail(data.id), data);
    },
  });
};

/**
 * Hook to remove collaborator
 */
export const useRemoveCollaborator = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, userId }: { documentId: string; userId: string }) =>
      documentService.removeCollaborator(documentId, userId),
    onSuccess: (data: Document) => {
      queryClient.setQueryData(documentKeys.detail(data.id), data);
    },
  });
};

/**
 * Hook to update collaborator permission
 */
export const useUpdateCollaboratorPermission = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      userId,
      permission,
    }: {
      documentId: string;
      userId: string;
      permission: 'view' | 'edit';
    }) => documentService.updateCollaboratorPermission(documentId, userId, permission),
    onSuccess: (data: Document) => {
      queryClient.setQueryData(documentKeys.detail(data.id), data);
    },
  });
};

/**
 * Hook to get document history
 */
export const useDocumentHistory = (id: string) => {
  return useQuery({
    queryKey: documentKeys.history(id),
    queryFn: () => documentService.getHistory(id),
  });
};

/**
 * Hook to restore document version
 */
export const useRestoreDocumentVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, versionId }: { documentId: string; versionId: string }) =>
      documentService.restoreVersion(documentId, versionId),
    onSuccess: (data: Document) => {
      queryClient.setQueryData(documentKeys.detail(data.id), data);
      queryClient.invalidateQueries({ queryKey: documentKeys.history(data.id) });
    },
  });
};
