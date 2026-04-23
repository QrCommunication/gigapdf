/**
 * API client for admin panel.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ============ Types ============

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta: {
    request_id: string;
    timestamp: string;
  };
}

// Plans
interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  interval: string;
  stripe_price_id: string | null;
  storage_limit_bytes: number;
  api_calls_limit: number;
  document_limit: number;
  is_tenant_plan: boolean;
  max_members: number;
  linked_tenant_id: string | null;
  features: {
    storageGb: number;
    apiCallsPerMonth: number;
    customBranding?: boolean;
    prioritySupport?: boolean;
    sla?: boolean;
    dedicatedAccount?: boolean;
  } | null;
  is_active: boolean;
  is_popular: boolean;
  display_order: number;
  cta_text: string;
  trial_days: number | null;
  created_at: string;
  updated_at: string;
}

interface CreatePlanData {
  slug: string;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  interval?: string;
  stripe_price_id?: string;
  storage_limit_bytes?: number;
  api_calls_limit?: number;
  document_limit?: number;
  is_tenant_plan?: boolean;
  max_members?: number;
  linked_tenant_id?: string | null;
  features?: Record<string, unknown>;
  is_active?: boolean;
  is_popular?: boolean;
  display_order?: number;
  cta_text?: string;
  trial_days?: number;
}

interface UpdatePlanData extends Partial<CreatePlanData> {}

// Dashboard Stats
interface SystemHealth {
  name: string;
  status: "healthy" | "warning" | "error";
  latency?: string;
}

interface DashboardStats {
  total_users: number;
  total_documents: number;
  total_storage_bytes: number;
  total_storage_formatted: string;
  active_jobs: number;
  completed_jobs_today: number;
  failed_jobs_today: number;
  system_health: SystemHealth[];
}

interface UsageDataPoint {
  month: string;
  documents: number;
  storage_gb: number;
}

interface RevenueDataPoint {
  month: string;
  revenue: number;
  subscribers: number;
}

interface RecentActivity {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  user_id?: string;
}

// Users
interface User {
  id: string;
  email?: string;
  name?: string;
  plan_type: string;
  storage_used_bytes: number;
  storage_limit_bytes: number;
  storage_used_formatted: string;
  storage_limit_formatted: string;
  document_count: number;
  api_calls_used: number;
  api_calls_limit: number;
  status: string;
  created_at?: string;
  updated_at: string;
}

interface UserListResponse {
  users: User[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface UserUpdateData {
  plan_type?: string;
  storage_limit_bytes?: number;
  api_calls_limit?: number;
  document_limit?: number;
  status?: string;
}

// Documents
interface Document {
  id: string;
  name: string;
  owner_id: string;
  page_count: number;
  file_size_bytes: number;
  file_size_formatted: string;
  mime_type: string;
  current_version: number;
  is_deleted: boolean;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

interface DocumentListResponse {
  documents: Document[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface DocumentStats {
  total_documents: number;
  total_size_bytes: number;
  total_size_formatted: string;
  documents_by_type: Record<string, number>;
  avg_page_count: number;
  deleted_count: number;
}

// Jobs
interface Job {
  id: string;
  job_type: string;
  status: string;
  progress: number;
  document_id?: string;
  owner_id: string;
  input_params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error_code?: string;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  duration_seconds?: number;
}

interface JobListResponse {
  jobs: Job[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface JobStats {
  total_jobs: number;
  pending_jobs: number;
  processing_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  cancelled_jobs: number;
  jobs_by_type: Record<string, number>;
  avg_duration_seconds?: number;
}

// Logs
interface LogEntry {
  id: string;
  level: "info" | "warning" | "error" | "success";
  message: string;
  source: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

interface LogListResponse {
  logs: LogEntry[];
  total: number;
  page: number;
  page_size: number;
}

interface LogStats {
  total_logs: number;
  info_count: number;
  warning_count: number;
  error_count: number;
  success_count: number;
  logs_today: number;
  logs_this_week: number;
}

// Settings
interface SystemSettings {
  system_name: string;
  system_url: string;
  support_email: string;
  max_file_size_mb: number;
  max_pages_per_document: number;
  max_documents_per_user: number;
  storage_provider: string;
  storage_bucket?: string;
  storage_region?: string;
  storage_endpoint?: string;
  smtp_host?: string;
  smtp_port: number;
  smtp_user?: string;
  smtp_from?: string;
  smtp_secure: boolean;
  enable_registration: boolean;
  enable_public_sharing: boolean;
  enable_ocr: boolean;
  enable_collaboration: boolean;
  maintenance_mode: boolean;
}

interface SettingsUpdateData extends Partial<SystemSettings> {
  smtp_password?: string;
}

// ============ API Client ============

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "An error occurred" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// Helper to handle both wrapped and unwrapped responses
async function fetchApiData<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetchApi<T | ApiResponse<T>>(endpoint, options);
  // Check if response is wrapped
  if (response && typeof response === 'object' && 'data' in response && 'success' in response) {
    return (response as ApiResponse<T>).data;
  }
  return response as T;
}

// ============ Plans API ============
export const plansApi = {
  list: async (includeInactive = true): Promise<Plan[]> => {
    const response = await fetchApiData<{ plans: Plan[] }>(`/api/v1/plans?include_inactive=${includeInactive}`);
    return response.plans || [];
  },

  get: async (planId: string): Promise<Plan> => {
    // Single plan response is wrapped in {plan: ...} object
    const response = await fetchApiData<Plan | { plan: Plan }>(`/api/v1/plans/${planId}`);
    return 'plan' in response ? response.plan : response;
  },

  create: async (data: CreatePlanData): Promise<Plan> => {
    return fetchApiData<Plan>("/api/v1/plans", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  update: async (planId: string, data: UpdatePlanData): Promise<Plan> => {
    return fetchApiData<Plan>(`/api/v1/plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  delete: async (planId: string): Promise<void> => {
    await fetchApi<{ message: string }>(`/api/v1/plans/${planId}`, {
      method: "DELETE",
    });
  },
};

// ============ Dashboard Stats API ============
export const statsApi = {
  getOverview: async (): Promise<DashboardStats> => {
    return fetchApi<DashboardStats>("/api/v1/admin/stats/overview");
  },

  getUsage: async (months = 6): Promise<UsageDataPoint[]> => {
    return fetchApi<UsageDataPoint[]>(`/api/v1/admin/stats/usage?months=${months}`);
  },

  getRevenue: async (months = 6): Promise<RevenueDataPoint[]> => {
    return fetchApi<RevenueDataPoint[]>(`/api/v1/admin/stats/revenue?months=${months}`);
  },

  getActivity: async (limit = 10): Promise<RecentActivity[]> => {
    return fetchApi<RecentActivity[]>(`/api/v1/admin/stats/activity?limit=${limit}`);
  },
};

// ============ Users API ============
export const usersApi = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    plan_type?: string;
    status?: string;
  }): Promise<UserListResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.page_size) searchParams.set("page_size", params.page_size.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.plan_type) searchParams.set("plan_type", params.plan_type);
    if (params?.status) searchParams.set("status", params.status);

    const query = searchParams.toString();
    return fetchApi<UserListResponse>(`/api/v1/admin/users${query ? `?${query}` : ""}`);
  },

  get: async (userId: string): Promise<User> => {
    return fetchApi<User>(`/api/v1/admin/users/${userId}`);
  },

  update: async (userId: string, data: UserUpdateData): Promise<User> => {
    return fetchApi<User>(`/api/v1/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  delete: async (userId: string): Promise<void> => {
    await fetchApi<{ message: string }>(`/api/v1/admin/users/${userId}`, {
      method: "DELETE",
    });
  },

  getDocuments: async (userId: string, page = 1, pageSize = 20) => {
    return fetchApi<{ documents: Document[]; total: number }>(
      `/api/v1/admin/users/${userId}/documents?page=${page}&page_size=${pageSize}`
    );
  },
};

// ============ Documents API ============
export const documentsApi = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    owner_id?: string;
    include_deleted?: boolean;
  }): Promise<DocumentListResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.page_size) searchParams.set("page_size", params.page_size.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.owner_id) searchParams.set("owner_id", params.owner_id);
    if (params?.include_deleted) searchParams.set("include_deleted", "true");

    const query = searchParams.toString();
    return fetchApi<DocumentListResponse>(`/api/v1/admin/documents${query ? `?${query}` : ""}`);
  },

  getStats: async (): Promise<DocumentStats> => {
    return fetchApi<DocumentStats>("/api/v1/admin/documents/stats");
  },

  get: async (documentId: string): Promise<Document> => {
    return fetchApi<Document>(`/api/v1/admin/documents/${documentId}`);
  },

  getVersions: async (documentId: string) => {
    return fetchApi<{ versions: unknown[]; total: number }>(
      `/api/v1/admin/documents/${documentId}/versions`
    );
  },

  delete: async (documentId: string, permanent = false): Promise<void> => {
    await fetchApi<{ message: string }>(
      `/api/v1/admin/documents/${documentId}?permanent=${permanent}`,
      { method: "DELETE" }
    );
  },

  restore: async (documentId: string): Promise<void> => {
    await fetchApi<{ message: string }>(
      `/api/v1/admin/documents/${documentId}/restore`,
      { method: "POST" }
    );
  },
};

// ============ Jobs API ============
export const jobsApi = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    status?: string;
    job_type?: string;
    owner_id?: string;
  }): Promise<JobListResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.page_size) searchParams.set("page_size", params.page_size.toString());
    if (params?.status) searchParams.set("status", params.status);
    if (params?.job_type) searchParams.set("job_type", params.job_type);
    if (params?.owner_id) searchParams.set("owner_id", params.owner_id);

    const query = searchParams.toString();
    return fetchApi<JobListResponse>(`/api/v1/admin/jobs${query ? `?${query}` : ""}`);
  },

  getStats: async (): Promise<JobStats> => {
    return fetchApi<JobStats>("/api/v1/admin/jobs/stats");
  },

  get: async (jobId: string): Promise<Job> => {
    return fetchApi<Job>(`/api/v1/admin/jobs/${jobId}`);
  },

  cancel: async (jobId: string): Promise<void> => {
    await fetchApi<{ message: string }>(`/api/v1/admin/jobs/${jobId}/cancel`, {
      method: "POST",
    });
  },

  retry: async (jobId: string): Promise<void> => {
    await fetchApi<{ message: string }>(`/api/v1/admin/jobs/${jobId}/retry`, {
      method: "POST",
    });
  },

  delete: async (jobId: string): Promise<void> => {
    await fetchApi<{ message: string }>(`/api/v1/admin/jobs/${jobId}`, {
      method: "DELETE",
    });
  },
};

// ============ Logs API ============
export const logsApi = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    level?: string;
    source?: string;
    user_id?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<LogListResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.page_size) searchParams.set("page_size", params.page_size.toString());
    if (params?.level) searchParams.set("level", params.level);
    if (params?.source) searchParams.set("source", params.source);
    if (params?.user_id) searchParams.set("user_id", params.user_id);
    if (params?.start_date) searchParams.set("start_date", params.start_date);
    if (params?.end_date) searchParams.set("end_date", params.end_date);

    const query = searchParams.toString();
    return fetchApi<LogListResponse>(`/api/v1/admin/logs${query ? `?${query}` : ""}`);
  },

  getStats: async (): Promise<LogStats> => {
    return fetchApi<LogStats>("/api/v1/admin/logs/stats");
  },

  export: async (format: "json" | "csv" = "json") => {
    return fetchApi<unknown>(`/api/v1/admin/logs/export?format=${format}`);
  },
};

// ============ Tenants Types ============
type TenantStatus = "active" | "suspended" | "trial" | "cancelled";
type TenantRole = "owner" | "admin" | "manager" | "member" | "viewer";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo_url?: string;
  email: string;
  phone?: string;
  website?: string;
  status: TenantStatus;
  member_count: number;
  document_count: number;
  storage_used_bytes: number;
  storage_limit_bytes: number;
  storage_used_formatted: string;
  storage_limit_formatted: string;
  storage_percentage: number;
  max_members: number;
  created_at: string;
  updated_at: string;
}

interface TenantListResponse {
  tenants: Tenant[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

interface TenantCreateData {
  name: string;
  slug: string;
  email: string;
  description?: string;
  phone?: string;
  website?: string;
  max_members?: number;
  storage_limit_bytes?: number;
}

interface TenantUpdateData {
  name?: string;
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  logo_url?: string;
  status?: TenantStatus;
  max_members?: number;
  storage_limit_bytes?: number;
  allow_member_invites?: boolean;
  require_2fa?: boolean;
}

interface TenantMember {
  id: string;
  user_id: string;
  user_email?: string;
  role: TenantRole;
  is_active: boolean;
  permissions: string[];
  joined_at: string;
  last_active_at?: string;
}

interface TenantMemberListResponse {
  members: TenantMember[];
  total: number;
  page: number;
  page_size: number;
}

interface TenantInvitation {
  id: string;
  email: string;
  role: TenantRole;
  token: string;
  is_accepted: boolean;
  is_expired?: boolean;
  expires_at: string;
  created_at: string;
}

interface TenantDocument {
  id: string;
  document_id: string;
  document_name: string;
  access_level: string;
  added_by_email?: string;
  added_at: string;
}

interface TenantStats {
  total_tenants: number;
  active_tenants: number;
  trial_tenants: number;
  suspended_tenants: number;
  total_members: number;
  total_storage_bytes: number;
  total_storage_formatted: string;
}

// ============ Tenants API ============
export const tenantsApi = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    status?: TenantStatus;
    search?: string;
  }): Promise<TenantListResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.page_size) searchParams.set("page_size", params.page_size.toString());
    if (params?.status) searchParams.set("status", params.status);
    if (params?.search) searchParams.set("search", params.search);

    const query = searchParams.toString();
    return fetchApi<TenantListResponse>(`/api/v1/admin/tenants${query ? `?${query}` : ""}`);
  },

  get: async (tenantId: string): Promise<Tenant> => {
    return fetchApi<Tenant>(`/api/v1/admin/tenants/${tenantId}`);
  },

  create: async (data: TenantCreateData): Promise<Tenant> => {
    return fetchApi<Tenant>("/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  update: async (tenantId: string, data: TenantUpdateData): Promise<Tenant> => {
    return fetchApi<Tenant>(`/api/v1/admin/tenants/${tenantId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  delete: async (tenantId: string): Promise<void> => {
    await fetchApi<{ success: boolean; message: string }>(`/api/v1/admin/tenants/${tenantId}`, {
      method: "DELETE",
    });
  },

  getStats: async (): Promise<TenantStats> => {
    return fetchApi<TenantStats>("/api/v1/admin/tenants/stats/overview");
  },

  // Members
  listMembers: async (tenantId: string, params?: {
    page?: number;
    page_size?: number;
  }): Promise<TenantMemberListResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.page_size) searchParams.set("page_size", params.page_size.toString());

    const query = searchParams.toString();
    return fetchApi<TenantMemberListResponse>(
      `/api/v1/admin/tenants/${tenantId}/members${query ? `?${query}` : ""}`
    );
  },

  addMember: async (tenantId: string, userId: string, role: TenantRole = "member"): Promise<TenantMember> => {
    return fetchApi<TenantMember>(`/api/v1/admin/tenants/${tenantId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role }),
    });
  },

  updateMember: async (
    tenantId: string,
    memberId: string,
    data: { role?: TenantRole; is_active?: boolean; custom_permissions?: string[] }
  ): Promise<TenantMember> => {
    return fetchApi<TenantMember>(`/api/v1/admin/tenants/${tenantId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  removeMember: async (tenantId: string, memberId: string): Promise<void> => {
    await fetchApi<{ success: boolean; message: string }>(
      `/api/v1/admin/tenants/${tenantId}/members/${memberId}`,
      { method: "DELETE" }
    );
  },

  // Invitations
  listInvitations: async (tenantId: string, includeAccepted = false) => {
    return fetchApi<{ invitations: TenantInvitation[] }>(
      `/api/v1/admin/tenants/${tenantId}/invitations?include_accepted=${includeAccepted}`
    );
  },

  createInvitation: async (
    tenantId: string,
    email: string,
    role: TenantRole = "member",
    invitedById: string,
    expiresInDays = 7
  ): Promise<TenantInvitation> => {
    return fetchApi<TenantInvitation>(
      `/api/v1/admin/tenants/${tenantId}/invitations?invited_by_id=${invitedById}`,
      {
        method: "POST",
        body: JSON.stringify({ email, role, expires_in_days: expiresInDays }),
      }
    );
  },

  cancelInvitation: async (tenantId: string, invitationId: string): Promise<void> => {
    await fetchApi<{ success: boolean; message: string }>(
      `/api/v1/admin/tenants/${tenantId}/invitations/${invitationId}`,
      { method: "DELETE" }
    );
  },

  // Documents
  listDocuments: async (tenantId: string, params?: {
    page?: number;
    page_size?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.page_size) searchParams.set("page_size", params.page_size.toString());

    const query = searchParams.toString();
    return fetchApi<{ documents: TenantDocument[]; total: number; page: number; page_size: number }>(
      `/api/v1/admin/tenants/${tenantId}/documents${query ? `?${query}` : ""}`
    );
  },

  shareDocument: async (
    tenantId: string,
    documentId: string,
    addedById: string,
    accessLevel: "read" | "write" | "admin" = "read"
  ): Promise<TenantDocument> => {
    return fetchApi<TenantDocument>(
      `/api/v1/admin/tenants/${tenantId}/documents?added_by_id=${addedById}`,
      {
        method: "POST",
        body: JSON.stringify({ document_id: documentId, access_level: accessLevel }),
      }
    );
  },

  unshareDocument: async (tenantId: string, documentId: string): Promise<void> => {
    await fetchApi<{ success: boolean; message: string }>(
      `/api/v1/admin/tenants/${tenantId}/documents/${documentId}`,
      { method: "DELETE" }
    );
  },
};

// ============ Infrastructure Types ============
interface CategoryCost {
  name: string;
  cost: number;
  product_count: number;
}

interface ResourceCost {
  product_name: string;
  resource_name: string;
  category: string;
  cost: number;
  unit: string;
  quantity: string;
}

interface CurrentCosts {
  total_eur: number;
  billing_period: string;
  by_category: CategoryCost[];
  resources: ResourceCost[];
}

interface MonthCost {
  period: string;
  total: number;
  by_category: Record<string, number>;
}

interface CostHistory {
  history: MonthCost[];
}

interface MemoryMetrics {
  used_bytes: number;
  total_bytes: number;
  used_gb: number;
  total_gb: number;
  percent: number;
}

interface DiskMetrics {
  used_bytes: number;
  total_bytes: number;
  used_gb: number;
  total_gb: number;
  percent: number;
}

interface S3Metrics {
  objects_count: number;
  total_bytes: number;
  total_mb: number;
}

interface NetworkMetrics {
  rx_bytes: number;
  tx_bytes: number;
  rx_mb: number;
  tx_mb: number;
}

interface CurrentMetrics {
  recorded_at: string;
  cpu_percent: number;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  s3: S3Metrics;
  network?: NetworkMetrics;
}

interface MetricPoint {
  time: string;
  cpu: number;
  memory: number;
  disk: number;
  s3_mb?: number;
}

interface MetricsHistory {
  range: string;
  points: MetricPoint[];
}

// ============ Infrastructure API ============
export const infrastructureApi = {
  // Costs
  getCurrentCosts: async (billingPeriod?: string): Promise<CurrentCosts> => {
    const params = billingPeriod ? `?billing_period=${billingPeriod}` : "";
    return fetchApi<CurrentCosts>(`/api/v1/admin/infrastructure/costs/current${params}`);
  },

  getCostHistory: async (months = 12): Promise<CostHistory> => {
    return fetchApi<CostHistory>(`/api/v1/admin/infrastructure/costs/history?months=${months}`);
  },

  // Metrics
  getCurrentMetrics: async (): Promise<CurrentMetrics> => {
    return fetchApi<CurrentMetrics>("/api/v1/admin/infrastructure/metrics/current");
  },

  getMetricsHistory: async (timeRange: "24h" | "7d" | "30d" = "24h"): Promise<MetricsHistory> => {
    return fetchApi<MetricsHistory>(`/api/v1/admin/infrastructure/metrics/history?time_range=${timeRange}`);
  },

  triggerMetricsCollection: async (): Promise<{ status: string; record_id: number; recorded_at: string }> => {
    return fetchApi<{ status: string; record_id: number; recorded_at: string }>(
      "/api/v1/admin/infrastructure/metrics/collect",
      { method: "POST" }
    );
  },
};

// ============ Settings API ============
export const settingsApi = {
  get: async (): Promise<SystemSettings> => {
    return fetchApi<SystemSettings>("/api/v1/admin/settings");
  },

  update: async (data: SettingsUpdateData): Promise<SystemSettings> => {
    return fetchApi<SystemSettings>("/api/v1/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  testEmail: async (toEmail: string) => {
    return fetchApi<{ success: boolean; message: string }>(
      `/api/v1/admin/settings/test-email?to_email=${encodeURIComponent(toEmail)}`,
      { method: "POST" }
    );
  },

  testStorage: async () => {
    return fetchApi<{ success: boolean; message: string; provider?: string }>(
      "/api/v1/admin/settings/test-storage",
      { method: "POST" }
    );
  },

  getStorageInfo: async () => {
    return fetchApi<{
      configured: boolean;
      provider?: string;
      bucket?: string;
      region?: string;
      object_count?: number;
      total_size_bytes?: number;
      total_size_formatted?: string;
      error?: string;
    }>("/api/v1/admin/settings/storage-info");
  },
};

// Export types
export type {
  Plan,
  CreatePlanData,
  UpdatePlanData,
  DashboardStats,
  SystemHealth,
  UsageDataPoint,
  RevenueDataPoint,
  RecentActivity,
  User,
  UserListResponse,
  UserUpdateData,
  Document,
  DocumentListResponse,
  DocumentStats,
  Job,
  JobListResponse,
  JobStats,
  LogEntry,
  LogListResponse,
  LogStats,
  SystemSettings,
  SettingsUpdateData,
  Tenant,
  TenantListResponse,
  TenantCreateData,
  TenantUpdateData,
  TenantMember,
  TenantMemberListResponse,
  TenantInvitation,
  TenantDocument,
  TenantStats,
  TenantStatus,
  TenantRole,
  // Infrastructure
  CategoryCost,
  ResourceCost,
  CurrentCosts,
  MonthCost,
  CostHistory,
  MemoryMetrics,
  DiskMetrics,
  S3Metrics,
  NetworkMetrics,
  CurrentMetrics,
  MetricPoint,
  MetricsHistory,
};
