import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { billingService } from '../services/billing';

/**
 * Query keys for billing-related queries
 */
export const billingKeys = {
  all: ['billing'] as const,
  subscription: () => [...billingKeys.all, 'subscription'] as const,
  plans: () => [...billingKeys.all, 'plans'] as const,
  invoices: () => [...billingKeys.all, 'invoices'] as const,
  invoice: (invoiceId: string) => [...billingKeys.invoices(), invoiceId] as const,
  paymentMethods: () => [...billingKeys.all, 'payment-methods'] as const,
  usage: () => [...billingKeys.all, 'usage'] as const,
};

/**
 * Hook to get current subscription
 */
export const useSubscription = () => {
  return useQuery({
    queryKey: billingKeys.subscription(),
    queryFn: billingService.getSubscription,
    staleTime: 60 * 1000, // 1 minute
  });
};

/**
 * Hook to list available plans
 */
export const usePlans = () => {
  return useQuery({
    queryKey: billingKeys.plans(),
    queryFn: billingService.listPlans,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

/**
 * Hook to create checkout session
 */
export const useCreateCheckoutSession = () => {
  return useMutation({
    mutationFn: ({
      planId,
      successUrl,
      cancelUrl,
    }: {
      planId: string;
      successUrl: string;
      cancelUrl: string;
    }) => billingService.createCheckoutSession(planId, successUrl, cancelUrl),
  });
};

/**
 * Hook to create billing portal session
 */
export const useCreatePortalSession = () => {
  return useMutation({
    mutationFn: (returnUrl: string) => billingService.createPortalSession(returnUrl),
  });
};

/**
 * Hook to update subscription
 */
export const useUpdateSubscription = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (planId: string) => billingService.updateSubscription(planId),
    onSuccess: (data) => {
      queryClient.setQueryData(billingKeys.subscription(), data);
    },
  });
};

/**
 * Hook to cancel subscription
 */
export const useCancelSubscription = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (immediately?: boolean) => billingService.cancelSubscription(immediately ?? false),
    onSuccess: (data) => {
      queryClient.setQueryData(billingKeys.subscription(), data);
    },
  });
};

/**
 * Hook to reactivate subscription
 */
export const useReactivateSubscription = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: billingService.reactivateSubscription,
    onSuccess: (data) => {
      queryClient.setQueryData(billingKeys.subscription(), data);
    },
  });
};

/**
 * Hook to list invoices
 */
export const useInvoices = (limit = 10) => {
  return useQuery({
    queryKey: [...billingKeys.invoices(), limit],
    queryFn: () => billingService.listInvoices(limit),
    staleTime: 60 * 1000, // 1 minute
  });
};

/**
 * Hook to get a single invoice
 */
export const useInvoice = (invoiceId: string, enabled = true) => {
  return useQuery({
    queryKey: billingKeys.invoice(invoiceId),
    queryFn: () => billingService.getInvoice(invoiceId),
    enabled,
  });
};

/**
 * Hook to download invoice PDF
 */
export const useDownloadInvoice = () => {
  return useMutation({
    mutationFn: (invoiceId: string) => billingService.downloadInvoice(invoiceId),
  });
};

/**
 * Hook to list payment methods
 */
export const usePaymentMethods = () => {
  return useQuery({
    queryKey: billingKeys.paymentMethods(),
    queryFn: billingService.listPaymentMethods,
    staleTime: 60 * 1000, // 1 minute
  });
};

/**
 * Hook to add payment method
 */
export const useAddPaymentMethod = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paymentMethodId: string) =>
      billingService.addPaymentMethod(paymentMethodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.paymentMethods() });
    },
  });
};

/**
 * Hook to remove payment method
 */
export const useRemovePaymentMethod = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paymentMethodId: string) =>
      billingService.removePaymentMethod(paymentMethodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.paymentMethods() });
    },
  });
};

/**
 * Hook to set default payment method
 */
export const useSetDefaultPaymentMethod = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paymentMethodId: string) =>
      billingService.setDefaultPaymentMethod(paymentMethodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.paymentMethods() });
    },
  });
};

/**
 * Hook to get usage and billing summary
 */
export const useUsageSummary = () => {
  return useQuery({
    queryKey: billingKeys.usage(),
    queryFn: billingService.getUsageSummary,
    staleTime: 60 * 1000, // 1 minute
  });
};
