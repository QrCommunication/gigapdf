import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storageService } from '../services/storage';

/**
 * Query keys for storage-related queries
 */
export const storageKeys = {
  all: ['storage'] as const,
  info: () => [...storageKeys.all, 'info'] as const,
  quota: () => [...storageKeys.all, 'quota'] as const,
  usage: () => [...storageKeys.all, 'usage'] as const,
  largest: () => [...storageKeys.all, 'largest'] as const,
};

/**
 * Hook to get storage information
 */
export const useStorageInfo = () => {
  return useQuery({
    queryKey: storageKeys.info(),
    queryFn: storageService.getStorageInfo,
    staleTime: 60 * 1000, // 1 minute
  });
};

/**
 * Hook to get storage quota
 */
export const useStorageQuota = () => {
  return useQuery({
    queryKey: storageKeys.quota(),
    queryFn: storageService.getQuota,
    staleTime: 60 * 1000, // 1 minute
  });
};

/**
 * Hook to get storage usage by type
 */
export const useStorageUsage = () => {
  return useQuery({
    queryKey: storageKeys.usage(),
    queryFn: storageService.getUsageByType,
    staleTime: 60 * 1000, // 1 minute
  });
};

/**
 * Hook to clean up temporary files
 */
export const useCleanupTemp = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: storageService.cleanupTemp,
    onSuccess: () => {
      // Invalidate storage queries after cleanup
      queryClient.invalidateQueries({ queryKey: storageKeys.all });
    },
  });
};

/**
 * Hook to get largest files
 */
export const useLargestFiles = (limit = 10) => {
  return useQuery({
    queryKey: [...storageKeys.largest(), limit],
    queryFn: () => storageService.getLargestFiles(limit),
    staleTime: 60 * 1000, // 1 minute
  });
};
