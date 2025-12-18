/**
 * Billing-specific types for Stripe integration.
 */

export type PlanId = "free" | "starter" | "pro" | "enterprise";

export interface PlanFeatures {
  storageGb: number;
  apiCallsPerMonth: number;
  customBranding?: boolean;
  prioritySupport?: boolean;
  sla?: boolean;
  dedicatedAccount?: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  stripePriceId?: string;
  features: PlanFeatures;
  popular?: boolean;
  cta: string;
}

export interface SubscriptionStatus {
  status: "active" | "canceled" | "past_due" | "unpaid" | "incomplete" | "trialing" | "none";
  currentPlan: PlanId;
  billingCycle?: "monthly" | "yearly";
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface Invoice {
  id: string;
  number: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: string;
  dueDate?: string;
  pdfUrl?: string;
  hostedInvoiceUrl?: string;
}

export interface UsageMetrics {
  apiCalls: {
    used: number;
    limit: number;
    percentage: number;
  };
  storage: {
    usedGb: number;
    limitGb: number;
    percentage: number;
  };
  periodStart: string;
  periodEnd: string;
}

export interface CheckoutOptions {
  planId: PlanId;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
  trialDays?: number;
}

export interface BillingPortalOptions {
  customerId: string;
  returnUrl: string;
}
