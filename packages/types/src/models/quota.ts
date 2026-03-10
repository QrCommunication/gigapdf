/**
 * Quota and billing models.
 */

export type PlanType = "free" | "starter" | "pro" | "enterprise";

export interface StorageQuota {
  usedBytes: number;
  limitBytes: number;
  availableBytes: number;
  usagePercentage: number;
}

export interface ApiQuota {
  used: number;
  limit: number;
  remaining: number;
  usagePercentage: number;
  resetAt: string;
}

export interface DocumentQuota {
  count: number;
  limit: number;
}

export interface PlanInfo {
  type: PlanType;
  expiresAt: string | null;
}

export interface QuotaSummary {
  plan: PlanInfo;
  storage: StorageQuota;
  apiCalls: ApiQuota;
  documents: DocumentQuota;
}

export interface PlanDetails {
  name: string;
  storageLimitGb: number;
  apiCallsLimit: number;
  documentLimit: number;
}

export interface AvailablePlans {
  free: PlanDetails;
  pro: PlanDetails;
  enterprise: PlanDetails;
}

// Aliases for API compatibility
export type QuotaUsage = StorageQuota;
export interface QuotaLimits {
  storage: number;
  apiCalls: number;
  documents: number;
}
