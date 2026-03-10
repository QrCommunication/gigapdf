import { useState } from "react";
import type { CheckoutOptions } from "../types";

interface UseCheckoutReturn {
  createCheckoutSession: (options: CheckoutOptions) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to create a Stripe Checkout session and redirect.
 * Uses the modern Stripe API where the backend returns the checkout URL.
 */
export function useCheckout(): UseCheckoutReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createCheckoutSession = async (options: CheckoutOptions) => {
    setIsLoading(true);
    setError(null);

    try {
      // Create checkout session on the backend
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(options),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create checkout session");
      }

      const { url } = await response.json();

      if (!url) {
        throw new Error("No checkout URL returned from server");
      }

      // Redirect to Stripe Checkout using the session URL
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
    createCheckoutSession,
    isLoading,
    error,
  };
}
