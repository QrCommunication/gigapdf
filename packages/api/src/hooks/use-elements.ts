import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { elementService } from '../services/elements';
import type {
  Element,
  CreateElementRequest,
  UpdateElementRequest,
} from '@giga-pdf/types';

/**
 * Query keys for element-related queries
 */
export const elementKeys = {
  all: ['elements'] as const,
  lists: () => [...elementKeys.all, 'list'] as const,
  list: (documentId: string, pageId?: string) =>
    [...elementKeys.lists(), documentId, pageId] as const,
  details: () => [...elementKeys.all, 'detail'] as const,
  detail: (documentId: string, elementId: string) =>
    [...elementKeys.details(), documentId, elementId] as const,
};

/**
 * Hook to list elements for a document
 */
export const useElements = (documentId: string, pageId?: string, enabled = true) => {
  return useQuery({
    queryKey: elementKeys.list(documentId, pageId),
    queryFn: () => elementService.list(documentId, pageId),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Hook to get a single element
 */
export const useElement = (documentId: string, elementId: string, enabled = true) => {
  return useQuery({
    queryKey: elementKeys.detail(documentId, elementId),
    queryFn: () => elementService.get(documentId, elementId),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Hook to create an element
 */
export const useCreateElement = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      data,
    }: {
      documentId: string;
      data: CreateElementRequest;
    }) => elementService.create(documentId, data),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};

/**
 * Hook to update an element
 */
export const useUpdateElement = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      elementId,
      data,
    }: {
      documentId: string;
      elementId: string;
      data: UpdateElementRequest;
    }) => elementService.update(documentId, elementId, data),
    onSuccess: (data: Element, { documentId }) => {
      queryClient.setQueryData(elementKeys.detail(documentId, data.elementId), data);
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};

/**
 * Hook to bulk update elements
 */
export const useBulkUpdateElements = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      updates,
    }: {
      documentId: string;
      updates: Array<{ id: string; data: UpdateElementRequest }>;
    }) => elementService.bulkUpdate(documentId, updates),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};

/**
 * Hook to delete an element
 */
export const useDeleteElement = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, elementId }: { documentId: string; elementId: string }) =>
      elementService.delete(documentId, elementId),
    onSuccess: (_, { documentId, elementId }) => {
      queryClient.removeQueries({ queryKey: elementKeys.detail(documentId, elementId) });
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};

/**
 * Hook to bulk delete elements
 */
export const useBulkDeleteElements = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      elementIds,
    }: {
      documentId: string;
      elementIds: string[];
    }) => elementService.bulkDelete(documentId, elementIds),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};

/**
 * Hook to duplicate an element
 */
export const useDuplicateElement = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, elementId }: { documentId: string; elementId: string }) =>
      elementService.duplicate(documentId, elementId),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};

/**
 * Hook to update element z-index
 */
export const useUpdateElementZIndex = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      elementId,
      zIndex,
    }: {
      documentId: string;
      elementId: string;
      zIndex: number;
    }) => elementService.updateZIndex(documentId, elementId, zIndex),
    onSuccess: (data: Element, { documentId }) => {
      queryClient.setQueryData(elementKeys.detail(documentId, data.elementId), data);
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};

/**
 * Hook to bring element to front
 */
export const useBringElementToFront = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, elementId }: { documentId: string; elementId: string }) =>
      elementService.bringToFront(documentId, elementId),
    onSuccess: (data: Element, { documentId }) => {
      queryClient.setQueryData(elementKeys.detail(documentId, data.elementId), data);
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};

/**
 * Hook to send element to back
 */
export const useSendElementToBack = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, elementId }: { documentId: string; elementId: string }) =>
      elementService.sendToBack(documentId, elementId),
    onSuccess: (data: Element, { documentId }) => {
      queryClient.setQueryData(elementKeys.detail(documentId, data.elementId), data);
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};

/**
 * Hook to group elements
 */
export const useGroupElements = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      elementIds,
    }: {
      documentId: string;
      elementIds: string[];
    }) => elementService.group(documentId, elementIds),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};

/**
 * Hook to ungroup elements
 */
export const useUngroupElements = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, groupId }: { documentId: string; groupId: string }) =>
      elementService.ungroup(documentId, groupId),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: elementKeys.list(documentId) });
    },
  });
};
