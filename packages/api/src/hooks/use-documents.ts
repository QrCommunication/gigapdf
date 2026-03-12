import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
import { documentService } from '../services/documents';
import { storageKeys } from './use-storage';
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
  details: () => [...documentKeys.all, 'detail'] as const,
  detail: (id: string) => [...documentKeys.details(), id] as const,
  history: (id: string) => [...documentKeys.detail(id), 'history'] as const,
};

/**
 * Hook to list documents with pagination
 * Backend: GET /storage/documents
 */
export const useDocuments = (params?: DocumentListParams) => {
  return useQuery({
    queryKey: [...storageKeys.documents(), params],
    queryFn: () => documentService.list(params),
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Hook to list documents with infinite scroll
 * Backend: GET /storage/documents
 */
export const useInfiniteDocuments = (params?: Omit<DocumentListParams, 'offset'>) => {
  return useInfiniteQuery({
    queryKey: [...storageKeys.documents(), 'infinite', params],
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
 * Backend: GET /documents/{document_id}
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
 * Backend: POST /storage/documents
 */
export const useCreateDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDocumentRequest) => documentService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to update a document
 * Backend: PATCH /storage/documents/{id}
 */
export const useUpdateDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDocumentRequest }) =>
      documentService.update(id, data),
    onSuccess: (data: Document) => {
      queryClient.setQueryData(documentKeys.detail(data.id), data);
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to delete a document
 * Backend: DELETE /documents/{document_id}
 */
export const useDeleteDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => documentService.delete(id),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: documentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to duplicate a document
 * TODO: Backend endpoint not yet implemented
 */
export const useDuplicateDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title?: string }) =>
      documentService.duplicate(id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to share a document
 * Backend: POST /sharing/share
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
 * Hook to remove a share
 * Backend: DELETE /sharing/shares/{id}
 * NOTE: shareId is the sharing record ID, not the userId
 */
export const useRemoveCollaborator = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, shareId }: { documentId: string; shareId: string }) =>
      documentService.removeCollaborator(documentId, shareId),
    onSuccess: (data: Document) => {
      queryClient.setQueryData(documentKeys.detail(data.id), data);
    },
  });
};

/**
 * Hook to update collaborator permission
 * Backend: PATCH /sharing/shares/{id}/permission
 * NOTE: shareId is the sharing record ID, not the userId
 */
export const useUpdateCollaboratorPermission = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      shareId,
      permission,
    }: {
      documentId: string;
      shareId: string;
      permission: 'view' | 'edit';
    }) => documentService.updateCollaboratorPermission(documentId, shareId, permission),
    onSuccess: (data: Document) => {
      queryClient.setQueryData(documentKeys.detail(data.id), data);
    },
  });
};

/**
 * Hook to get document activity history
 * Backend: GET /activity/documents/{document_id}/history
 */
export const useDocumentHistory = (id: string) => {
  return useQuery({
    queryKey: documentKeys.history(id),
    queryFn: () => documentService.getHistory(id),
  });
};

/**
 * Hook to restore document version
 * Backend: POST /storage/documents/{id}/versions
 * TODO: Backend restore endpoint not yet implemented — creates a version snapshot
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
