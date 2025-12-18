import { useQuery } from "@tanstack/react-query";
import type { Invoice } from "../types";

/**
 * Hook to fetch invoice history.
 */
export function useInvoices() {
  return useQuery<Invoice[]>({
    queryKey: ["invoices"],
    queryFn: async () => {
      const response = await fetch("/api/billing/invoices");
      if (!response.ok) {
        throw new Error("Failed to fetch invoices");
      }
      return response.json();
    },
    staleTime: 300000, // 5 minutes
  });
}

/**
 * Hook to fetch a single invoice.
 */
export function useInvoice(invoiceId: string) {
  return useQuery<Invoice>({
    queryKey: ["invoice", invoiceId],
    queryFn: async () => {
      const response = await fetch(`/api/billing/invoices/${invoiceId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch invoice");
      }
      return response.json();
    },
    enabled: !!invoiceId,
  });
}
