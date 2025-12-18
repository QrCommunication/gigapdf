import { useState } from "react";
import type { BillingPortalOptions } from "../types";

interface UseBillingPortalReturn {
  openBillingPortal: (options: BillingPortalOptions) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to open Stripe Customer Portal.
 */
export function useBillingPortal(): UseBillingPortalReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const openBillingPortal = async (options: BillingPortalOptions) => {
    setIsLoading(true);
    setError(null);

    try {
      // Create portal session on the backend
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(options),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create portal session");
      }

      const { url } = await response.json();

      // Redirect to Stripe Customer Portal
      window.location.href = url;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("An unknown error occurred");
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    openBillingPortal,
    isLoading,
    error,
  };
}
