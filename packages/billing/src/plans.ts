import type { Plan } from "./types";

/**
 * Available subscription plans for GigaPDF.
 */
export const PLANS: Record<string, Plan> = {
  free: {
    id: "free",
    name: "Free",
    description: "Perfect for trying out GigaPDF",
    price: 0,
    currency: "EUR",
    interval: "month",
    features: {
      storageGb: 5,
      apiCallsPerMonth: 1000,
    },
    cta: "Get Started",
  },
  starter: {
    id: "starter",
    name: "Starter",
    description: "For individuals and small teams",
    price: 9,
    currency: "EUR",
    interval: "month",
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID,
    features: {
      storageGb: 25,
      apiCallsPerMonth: 10000,
    },
    popular: true,
    cta: "Start 14-day Trial",
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "For growing businesses and teams",
    price: 29,
    currency: "EUR",
    interval: "month",
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
    features: {
      storageGb: 100,
      apiCallsPerMonth: 100000,
      customBranding: true,
      prioritySupport: true,
    },
    cta: "Start 14-day Trial",
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    description: "For large organizations with custom needs",
    price: 0,
    currency: "EUR",
    interval: "month",
    features: {
      storageGb: Infinity,
      apiCallsPerMonth: Infinity,
      customBranding: true,
      prioritySupport: true,
      sla: true,
      dedicatedAccount: true,
    },
    cta: "Contact Sales",
  },
} as const;

/**
 * Get plan by ID.
 */
export function getPlanById(planId: string): Plan | undefined {
  return PLANS[planId];
}

/**
 * Get all plans as an array.
 */
export function getAllPlans(): Plan[] {
  return Object.values(PLANS);
}

/**
 * Get paid plans only.
 */
export function getPaidPlans(): Plan[] {
  return getAllPlans().filter((plan) => plan.price > 0 && plan.id !== "enterprise");
}

/**
 * Format price for display.
 */
export function formatPrice(price: number, currency: string = "EUR"): string {
  if (price === 0) {
    return "Free";
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
  }).format(price);
}

/**
 * Format storage size for display.
 */
export function formatStorage(gb: number): string {
  if (!isFinite(gb)) {
    return "Unlimited";
  }
  return `${gb} GB`;
}

/**
 * Format API calls for display.
 */
export function formatApiCalls(calls: number): string {
  if (!isFinite(calls)) {
    return "Unlimited";
  }
  if (calls >= 1000000) {
    return `${(calls / 1000000).toFixed(1)}M`;
  }
  if (calls >= 1000) {
    return `${(calls / 1000).toFixed(0)}K`;
  }
  return calls.toString();
}
