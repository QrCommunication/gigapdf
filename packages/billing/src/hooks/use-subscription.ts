import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SubscriptionStatus } from "../types";

/**
 * Hook to fetch current subscription status.
 */
export function useSubscription() {
  return useQuery<SubscriptionStatus>({
    queryKey: ["subscription"],
    queryFn: async () => {
      const response = await fetch("/api/billing/subscription");
      if (!response.ok) {
        throw new Error("Failed to fetch subscription");
      }
      return response.json();
    },
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to cancel subscription.
 */
export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/billing/subscription/cancel", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to cancel subscription");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    },
  });
}

/**
 * Hook to resume subscription.
 */
export function useResumeSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/billing/subscription/resume", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to resume subscription");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    },
  });
}
