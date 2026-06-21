import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  documentLayersService,
  type DocumentLayersData,
} from '../services/document-layers';

/**
 * Query keys for document-layers persistence.
 */
export const documentLayersKeys = {
  all: ['document-layers'] as const,
  byDocument: (storedDocumentId: string) =>
    [...documentLayersKeys.all, storedDocumentId] as const,
};

/**
 * Hook to fetch saved user layers + membership for a stored document.
 * Backend: GET /storage/documents/{storedDocumentId}/layers
 */
export const useDocumentLayers = (storedDocumentId: string | undefined, enabled = true) => {
  return useQuery({
    queryKey: documentLayersKeys.byDocument(storedDocumentId ?? ''),
    queryFn: () => documentLayersService.getDocumentLayers(storedDocumentId!),
    enabled: enabled && !!storedDocumentId,
    staleTime: 5 * 60 * 1000, // 5 minutes — layers change rarely, edit-driven
  });
};

/**
 * Hook to persist (upsert) user layers + membership for a stored document.
 * Backend: PUT /storage/documents/{storedDocumentId}/layers
 */
export const useSaveDocumentLayers = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storedDocumentId,
      data,
    }: {
      storedDocumentId: string;
      data: DocumentLayersData;
    }) => documentLayersService.putDocumentLayers(storedDocumentId, data),
    onSuccess: (data, { storedDocumentId }) => {
      // Seed the cache with the saved snapshot so a later mount reads fresh.
      queryClient.setQueryData(
        documentLayersKeys.byDocument(storedDocumentId),
        data
      );
    },
  });
};
