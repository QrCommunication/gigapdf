import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storageService } from '../services/storage';

/**
 * Query keys for storage-related queries
 */
export const storageKeys = {
  all: ['storage'] as const,
  documents: () => [...storageKeys.all, 'documents'] as const,
  folders: () => [...storageKeys.all, 'folders'] as const,
  folderStats: (id: string) => [...storageKeys.folders(), id, 'stats'] as const,
  versions: (id: string) => [...storageKeys.documents(), id, 'versions'] as const,
  quota: () => [...storageKeys.all, 'quota'] as const,
  effectiveQuota: () => [...storageKeys.all, 'quota', 'effective'] as const,
  quotaPlans: () => [...storageKeys.all, 'quota', 'plans'] as const,
};

// ─── Documents ───────────────────────────────────────────────────────────────

/**
 * Hook to list stored documents
 * Backend: GET /storage/documents
 */
export const useStorageDocuments = (params?: {
  folder_id?: string;
  limit?: number;
  offset?: number;
}) => {
  return useQuery({
    queryKey: [...storageKeys.documents(), params],
    queryFn: () => storageService.listDocuments(params),
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Hook to create a document record in storage
 * Backend: POST /storage/documents
 */
export const useCreateStorageDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { title?: string; folder_id?: string }) =>
      storageService.createDocument(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to load a document into the processing engine
 * Backend: POST /storage/documents/{id}/load
 */
export const useLoadDocument = () => {
  return useMutation({
    mutationFn: (id: string) => storageService.loadDocument(id),
  });
};

/**
 * Hook to update document metadata in storage
 * Backend: PATCH /storage/documents/{id}
 */
export const useUpdateStorageDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { title?: string; folder_id?: string };
    }) => storageService.updateDocument(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to delete a stored document
 * Backend: DELETE /storage/documents/{id}
 */
export const useDeleteStorageDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => storageService.deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to move a document to a folder
 * Backend: PATCH /storage/documents/{id}/move
 */
export const useMoveDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      storageService.moveDocument(id, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to list document versions
 * Backend: GET /storage/documents/{id}/versions
 */
export const useDocumentVersions = (id: string, enabled = true) => {
  return useQuery({
    queryKey: storageKeys.versions(id),
    queryFn: () => storageService.listVersions(id),
    enabled,
    staleTime: 30 * 1000,
  });
};

/**
 * Hook to create a version snapshot
 * Backend: POST /storage/documents/{id}/versions
 */
export const useCreateVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, label }: { id: string; label?: string }) =>
      storageService.createVersion(id, label),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: storageKeys.versions(id) });
    },
  });
};

// ─── Folders ─────────────────────────────────────────────────────────────────

/**
 * Hook to list folders
 * Backend: GET /storage/folders
 */
export const useFolders = () => {
  return useQuery({
    queryKey: storageKeys.folders(),
    queryFn: storageService.listFolders,
    staleTime: 60 * 1000, // 1 minute
  });
};

/**
 * Hook to create a folder
 * Backend: POST /storage/folders
 */
export const useCreateFolder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; parent_id?: string }) =>
      storageService.createFolder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.folders() });
    },
  });
};

/**
 * Hook to delete a folder
 * Backend: DELETE /storage/folders/{id}
 */
export const useDeleteFolder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => storageService.deleteFolder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.folders() });
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to move a folder
 * Backend: PATCH /storage/folders/{id}/move
 */
export const useMoveFolder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      storageService.moveFolder(id, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.folders() });
    },
  });
};

/**
 * Hook to get folder statistics
 * Backend: GET /storage/folders/{id}/stats
 */
export const useFolderStats = (id: string, enabled = true) => {
  return useQuery({
    queryKey: storageKeys.folderStats(id),
    queryFn: () => storageService.getFolderStats(id),
    enabled,
    staleTime: 60 * 1000,
  });
};

// ─── Quota ───────────────────────────────────────────────────────────────────

/**
 * Hook to get current user's quota
 * Backend: GET /quota/me
 */
export const useStorageQuota = () => {
  return useQuery({
    queryKey: storageKeys.quota(),
    queryFn: storageService.getQuota,
    staleTime: 60 * 1000, // 1 minute
  });
};

/**
 * Hook to get effective quota
 * Backend: GET /quota/effective
 */
export const useEffectiveQuota = () => {
  return useQuery({
    queryKey: storageKeys.effectiveQuota(),
    queryFn: storageService.getEffectiveQuota,
    staleTime: 60 * 1000,
  });
};

/**
 * Hook to get quota plans
 * Backend: GET /quota/plans
 */
export const useQuotaPlans = () => {
  return useQuery({
    queryKey: storageKeys.quotaPlans(),
    queryFn: storageService.getQuotaPlans,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
