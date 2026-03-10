import { apiClient } from '../client';
import type {
  Subscription,
  Plan,
  Invoice,
  PaymentMethod,
  BillingPortalSession,
  CheckoutSession,
} from '@giga-pdf/types';

/**
 * Billing service for Stripe integration
 */
export const billingService = {
  /**
   * Get current subscription
   */
  getSubscription: async (): Promise<Subscription | null> => {
    const response = await apiClient.get<Subscription | null>('/billing/subscription');
    return response.data;
  },

  /**
   * List available plans
   */
  listPlans: async (): Promise<Plan[]> => {
    const response = await apiClient.get<Plan[]>('/billing/plans');
    return response.data;
  },

  /**
   * Create checkout session
   */
  createCheckoutSession: async (
    planId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutSession> => {
    const response = await apiClient.post<CheckoutSession>('/billing/checkout', {
      plan_id: planId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    return response.data;
  },

  /**
   * Create billing portal session
   */
  createPortalSession: async (returnUrl: string): Promise<BillingPortalSession> => {
    const response = await apiClient.post<BillingPortalSession>('/billing/portal', {
      return_url: returnUrl,
    });
    return response.data;
  },

  /**
   * Update subscription
   */
  updateSubscription: async (planId: string): Promise<Subscription> => {
    const response = await apiClient.patch<Subscription>('/billing/subscription', {
      plan_id: planId,
    });
    return response.data;
  },

  /**
   * Cancel subscription
   */
  cancelSubscription: async (immediately = false): Promise<Subscription> => {
    const response = await apiClient.post<Subscription>('/billing/subscription/cancel', {
      immediately,
    });
    return response.data;
  },

  /**
   * Reactivate subscription
   */
  reactivateSubscription: async (): Promise<Subscription> => {
    const response = await apiClient.post<Subscription>(
      '/billing/subscription/reactivate'
    );
    return response.data;
  },

  /**
   * List invoices
   */
  listInvoices: async (limit = 10): Promise<Invoice[]> => {
    const response = await apiClient.get<Invoice[]>('/billing/invoices', {
      params: { limit },
    });
    return response.data;
  },

  /**
   * Get invoice
   */
  getInvoice: async (invoiceId: string): Promise<Invoice> => {
    const response = await apiClient.get<Invoice>(`/billing/invoices/${invoiceId}`);
    return response.data;
  },

  /**
   * Download invoice PDF
   */
  downloadInvoice: async (invoiceId: string): Promise<Blob> => {
    const response = await apiClient.get<Blob>(
      `/billing/invoices/${invoiceId}/download`,
      {
        responseType: 'blob',
      }
    );
    return response.data;
  },

  /**
   * List payment methods
   */
  listPaymentMethods: async (): Promise<PaymentMethod[]> => {
    const response = await apiClient.get<PaymentMethod[]>('/billing/payment-methods');
    return response.data;
  },

  /**
   * Add payment method
   */
  addPaymentMethod: async (paymentMethodId: string): Promise<PaymentMethod> => {
    const response = await apiClient.post<PaymentMethod>('/billing/payment-methods', {
      payment_method_id: paymentMethodId,
    });
    return response.data;
  },

  /**
   * Remove payment method
   */
  removePaymentMethod: async (paymentMethodId: string): Promise<void> => {
    await apiClient.delete(`/billing/payment-methods/${paymentMethodId}`);
  },

  /**
   * Set default payment method
   */
  setDefaultPaymentMethod: async (paymentMethodId: string): Promise<PaymentMethod> => {
    const response = await apiClient.post<PaymentMethod>(
      `/billing/payment-methods/${paymentMethodId}/default`
    );
    return response.data;
  },

  /**
   * Get usage and billing summary
   */
  getUsageSummary: async (): Promise<{
    current_period_start: string;
    current_period_end: string;
    usage: {
      documents: number;
      storage_gb: number;
      exports: number;
      ocr_pages: number;
    };
    limits: {
      documents: number | null;
      storage_gb: number | null;
      exports: number | null;
      ocr_pages: number | null;
    };
  }> => {
    const response = await apiClient.get<{
      current_period_start: string;
      current_period_end: string;
      usage: {
        documents: number;
        storage_gb: number;
        exports: number;
        ocr_pages: number;
      };
      limits: {
        documents: number | null;
        storage_gb: number | null;
        exports: number | null;
        ocr_pages: number | null;
      };
    }>('/billing/usage');
    return response.data;
  },
};
