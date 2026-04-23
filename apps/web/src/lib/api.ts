/**
 * API Client for GigaPDF Backend
 *
 * Handles all communication with the FastAPI backend.
 * Uses Next.js rewrites to proxy requests and avoid mixed content issues
 * when running HTTPS frontend with HTTP backend in development.
 */

import type { DocumentObject } from "@giga-pdf/types";
import { getAuthToken, invalidateAuthToken } from "./auth-token";

export type { DocumentObject };
export { getAuthToken, invalidateAuthToken };

// API base URL - use relative path for same-origin requests
// nginx proxies /api/ to FastAPI backend
const API_BASE_URL = "";


interface APIResponse<T> {
  success: boolean;
  data: T;
  meta: {
    request_id: string;
    timestamp: string;
    processing_time_ms?: number;
  };
}

interface PaginationInfo {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// Document types
export interface StoredDocument {
  stored_document_id: string;
  name: string;
  page_count: number;
  version: number;
  folder_id: string | null;
  tags: string[];
  file_size_bytes?: number;
  created_at: string;
  modified_at: string;
  thumbnail_url: string | null;
}

export interface DocumentListResponse {
  items: StoredDocument[];
  pagination: PaginationInfo;
}

export interface QuotaSummary {
  storage: {
    used_bytes: number;
    limit_bytes: number;
    percentage: number;
  };
  api_calls: {
    used: number;
    limit: number;
    percentage: number;
    resets_at: string;
  };
  documents: {
    count: number;
    limit: number;
  };
  plan: {
    type: string;
    name: string;
    expires_at: string | null;
  };
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: string;
  storage_limit_bytes: number;
  api_calls_limit: number;
  document_limit: number;
  features: Record<string, boolean>;
  is_active: boolean;
  is_popular: boolean;
  display_order: number;
  cta_text: string;
}

export interface Folder {
  folder_id: string;
  name: string;
  parent_id: string | null;
  path: string;
  created_at: string;
}

class APIClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: HeadersInit = {
      ...options.headers,
    };

    // Don't set Content-Type for FormData (browser will set it with boundary)
    if (!(options.body instanceof FormData)) {
      (headers as Record<string, string>)["Content-Type"] = "application/json";
    }

    // Fetch JWT from Better Auth (in-memory cache, no sessionStorage)
    // Python FastAPI backend requires Authorization: Bearer <jwt>
    const token = await getAuthToken();
    if (token) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    }

    let response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    // On 401, invalidate token and retry once (token may have expired)
    if (response.status === 401 && token) {
      invalidateAuthToken();
      const freshToken = await getAuthToken();
      if (freshToken && freshToken !== token) {
        (headers as Record<string, string>)["Authorization"] = `Bearer ${freshToken}`;
        response = await fetch(url, {
          ...options,
          headers,
          credentials: "include",
        });
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || error.message || `HTTP ${response.status}`);
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  // ===== Storage/Documents API =====

  async listDocuments(params: {
    page?: number;
    per_page?: number;
    folder_id?: string | null;
    search?: string;
    tags?: string;
  } = {}): Promise<DocumentListResponse> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", params.page.toString());
    if (params.per_page) searchParams.set("per_page", params.per_page.toString());
    if (params.folder_id) searchParams.set("folder_id", params.folder_id);
    if (params.search) searchParams.set("search", params.search);
    if (params.tags) searchParams.set("tags", params.tags);

    const response = await this.request<APIResponse<DocumentListResponse>>(
      `/api/v1/storage/documents?${searchParams.toString()}`
    );
    return response.data;
  }

  async saveDocument(params: {
    file: Blob;
    name: string;
    folderId?: string;
    tags?: string[];
    versionComment?: string;
  }): Promise<{
    stored_document_id: string;
    name: string;
    page_count: number;
    version_number: number;
    created_at: string;
  }> {
    const fd = new FormData();
    fd.append("file", params.file);
    fd.append("name", params.name);
    if (params.folderId) fd.append("folder_id", params.folderId);
    if (params.tags) fd.append("tags", JSON.stringify(params.tags));
    if (params.versionComment) fd.append("version_comment", params.versionComment);

    // NOTE: no Content-Type header — the browser sets multipart/form-data with boundary automatically
    const response = await this.request<APIResponse<{
      stored_document_id: string;
      name: string;
      page_count: number;
      version_number: number;
      created_at: string;
    }>>("/api/v1/storage/documents", {
      method: "POST",
      body: fd,
    });
    return response.data;
  }

  async createDocumentVersion(
    storedDocumentId: string,
    params: {
      file: Blob;
      comment?: string;
    }
  ): Promise<{ stored_document_id: string; version: number; created_at: string }> {
    const fd = new FormData();
    fd.append("file", params.file);
    if (params.comment) fd.append("comment", params.comment);

    // NOTE: no Content-Type header — the browser sets multipart/form-data with boundary automatically
    const response = await this.request<APIResponse<{
      stored_document_id: string;
      version: number;
      created_at: string;
    }>>(`/api/v1/storage/documents/${storedDocumentId}/versions`, {
      method: "POST",
      body: fd,
    });
    return response.data;
  }

  /**
   * Parse a stored document from S3 via the Next.js BFF route.
   * Returns the full DocumentObject scene graph.
   * Prefer this over calling /api/pdf/parse-from-s3 directly.
   */
  async parseDocumentFromStorage(documentId: string): Promise<DocumentObject> {
    const response = await this.request<{ data: DocumentObject }>("/api/pdf/parse-from-s3", {
      method: "POST",
      body: JSON.stringify({ documentId }),
      headers: { "Content-Type": "application/json" },
    });
    return response.data;
  }

  async loadDocument(storedDocumentId: string): Promise<{
    document_id: string;
    stored_document_id: string;
    name: string;
    page_count: number;
  }> {
    const response = await this.request<APIResponse<{
      document_id: string;
      stored_document_id: string;
      name: string;
      page_count: number;
    }>>(`/api/v1/storage/documents/${storedDocumentId}/load`, {
      method: "POST",
    });
    return response.data;
  }

  async deleteDocument(storedDocumentId: string): Promise<void> {
    await this.request<APIResponse<{ deleted: boolean }>>(
      `/api/v1/storage/documents/${storedDocumentId}`,
      { method: "DELETE" }
    );
  }

  async renameDocument(storedDocumentId: string, name: string): Promise<{
    stored_document_id: string;
    name: string;
    updated_at: string;
  }> {
    const response = await this.request<APIResponse<{
      stored_document_id: string;
      name: string;
      updated_at: string;
    }>>(`/api/v1/storage/documents/${storedDocumentId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    return response.data;
  }

  async exportDocument(
    documentId: string,
    format: "png" | "jpeg" | "webp" | "svg" | "html" | "txt" | "docx" | "xlsx",
    options: {
      page_range?: string;
      dpi?: number;
      quality?: number;
      single_file?: boolean;
    } = {}
  ): Promise<{ job_id: string; status: string }> {
    const params = new URLSearchParams({ format });
    if (options.page_range) params.set("page_range", options.page_range);
    if (options.dpi) params.set("dpi", options.dpi.toString());
    if (options.quality) params.set("quality", options.quality.toString());
    if (options.single_file) params.set("single_file", "true");

    const response = await this.request<APIResponse<{
      job_id: string;
      status: string;
    }>>(`/api/v1/documents/${documentId}/export?${params.toString()}`, {
      method: "POST",
    });
    return response.data;
  }

  async getExportResult(documentId: string, jobId: string): Promise<Blob> {
    const url = `${this.baseUrl}/api/v1/documents/${documentId}/export/${jobId}`;
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`);
    }
    return response.blob();
  }

  async getJobStatus(jobId: string): Promise<{
    id: string;
    status: string;
    progress: number;
    result?: Record<string, unknown>;
    error?: string;
  }> {
    const response = await this.request<APIResponse<{
      id: string;
      status: string;
      progress: number;
      result?: Record<string, unknown>;
      error?: string;
    }>>(`/api/v1/jobs/${jobId}`);
    return response.data;
  }

  async getDocumentVersions(storedDocumentId: string): Promise<{
    stored_document_id: string;
    current_version: number;
    versions: Array<{
      version: number;
      created_at: string;
      created_by: string;
      comment: string | null;
      size_bytes: number;
    }>;
  }> {
    const response = await this.request<APIResponse<{
      stored_document_id: string;
      current_version: number;
      versions: Array<{
        version: number;
        created_at: string;
        created_by: string;
        comment: string | null;
        size_bytes: number;
      }>;
    }>>(`/api/v1/storage/documents/${storedDocumentId}/versions`);
    return response.data;
  }

  // ===== Document Session API =====

  async uploadDocument(file: File, options: {
    password?: string;
    extract_text?: boolean;
    ocr_enabled?: boolean;
    generate_previews?: boolean;
  } = {}): Promise<{
    document_id: string;
    status: string;
    document: {
      document_id: string;
      metadata: {
        title: string;
        page_count: number;
        is_encrypted: boolean;
      };
    };
  }> {
    const formData = new FormData();
    formData.append("file", file);
    if (options.password) formData.append("password", options.password);
    formData.append("extract_text", String(options.extract_text ?? true));
    formData.append("ocr_enabled", String(options.ocr_enabled ?? false));
    formData.append("generate_previews", String(options.generate_previews ?? true));

    const response = await this.request<APIResponse<{
      document_id: string;
      status: string;
      document: {
        document_id: string;
        metadata: {
          title: string;
          page_count: number;
          is_encrypted: boolean;
        };
      };
    }>>("/api/v1/documents/upload", {
      method: "POST",
      body: formData,
    });
    return response.data;
  }

  async getDocument(documentId: string): Promise<{
    document_id: string;
    metadata: Record<string, unknown>;
    pages: Array<Record<string, unknown>>;
  }> {
    const response = await this.request<APIResponse<{
      document_id: string;
      metadata: Record<string, unknown>;
      pages: Array<Record<string, unknown>>;
    }>>(`/api/v1/documents/${documentId}`);
    return response.data;
  }

  getDocumentDownloadUrl(documentId: string): string {
    return `${this.baseUrl}/api/v1/documents/${documentId}/download`;
  }

  async deleteSessionDocument(documentId: string): Promise<void> {
    await this.request(`/api/v1/documents/${documentId}`, {
      method: "DELETE",
    });
  }

  // ===== Elements API =====

  /**
   * Create a new element on a page.
   * The element is rendered directly to the PDF in the backend.
   */
  async createElement(
    documentId: string,
    pageNumber: number,
    element: ElementCreateRequest
  ): Promise<ElementResponse> {
    const response = await this.request<APIResponse<ElementResponse>>(
      `/api/v1/documents/${documentId}/pages/${pageNumber}/elements`,
      {
        method: "POST",
        body: JSON.stringify(element),
      }
    );
    return response.data;
  }

  /**
   * Update an existing element.
   */
  async updateElement(
    documentId: string,
    elementId: string,
    updates: Partial<ElementCreateRequest>
  ): Promise<ElementResponse> {
    const response = await this.request<APIResponse<ElementResponse>>(
      `/api/v1/documents/${documentId}/elements/${elementId}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      }
    );
    return response.data;
  }

  /**
   * Delete an element from the document.
   */
  async deleteElement(documentId: string, elementId: string): Promise<void> {
    await this.request(
      `/api/v1/documents/${documentId}/elements/${elementId}`,
      { method: "DELETE" }
    );
  }

  /**
   * Get all elements on a page.
   */
  async getPageElements(
    documentId: string,
    pageNumber: number,
    params: { type?: string; page?: number; per_page?: number } = {}
  ): Promise<{ elements: ElementResponse[]; pagination: PaginationInfo }> {
    const searchParams = new URLSearchParams();
    if (params.type) searchParams.set("type", params.type);
    if (params.page) searchParams.set("page", params.page.toString());
    if (params.per_page) searchParams.set("per_page", params.per_page.toString());

    const response = await this.request<APIResponse<{
      elements: ElementResponse[];
      pagination: PaginationInfo;
    }>>(`/api/v1/documents/${documentId}/pages/${pageNumber}/elements?${searchParams.toString()}`);
    return response.data;
  }

  /**
   * Batch operations for elements (create, update, delete multiple at once).
   */
  async batchElementOperations(
    documentId: string,
    operations: Array<{
      action: "create" | "update" | "delete";
      page_number?: number;
      element_id?: string;
      data?: Partial<ElementCreateRequest>;
    }>
  ): Promise<{ results: Array<{ success: boolean; element_id?: string; error?: string }>; failed_count: number }> {
    const response = await this.request<APIResponse<{
      results: Array<{ success: boolean; element_id?: string; error?: string }>;
      failed_count: number;
    }>>(`/api/v1/documents/${documentId}/elements/batch`, {
      method: "POST",
      body: JSON.stringify({ operations }),
    });
    return response.data;
  }

  // ===== Quota API =====

  async getQuota(): Promise<QuotaSummary> {
    const response = await this.request<APIResponse<QuotaSummary>>(
      "/api/v1/quota/me"
    );
    return response.data;
  }

  async getPlansFromQuota(): Promise<Record<string, {
    storage_limit_gb: number;
    api_calls_limit: number;
    document_limit: number;
  }>> {
    const response = await this.request<APIResponse<{
      plans: Record<string, {
        storage_limit_gb: number;
        api_calls_limit: number;
        document_limit: number;
      }>;
    }>>("/api/v1/quota/plans");
    return response.data.plans;
  }

  // ===== Plans API (from database) =====

  async getPlans(): Promise<Plan[]> {
    const response = await this.request<APIResponse<{ plans: Plan[] }>>(
      "/api/v1/plans"
    );
    return response.data?.plans || [];
  }

  async getPlan(idOrSlug: string): Promise<Plan> {
    const response = await this.request<APIResponse<{ plan: Plan }>>(
      `/api/v1/plans/${idOrSlug}`
    );
    return response.data.plan;
  }

  // ===== Folders API =====

  async listFolders(): Promise<{ folders: Folder[] }> {
    const response = await this.request<APIResponse<{ folders: Folder[] }>>(
      "/api/v1/storage/folders"
    );
    return response.data;
  }

  async createFolder(name: string, parentId?: string | null): Promise<Folder> {
    const response = await this.request<APIResponse<Folder>>(
      "/api/v1/storage/folders",
      {
        method: "POST",
        body: JSON.stringify({ name, parent_id: parentId }),
      }
    );
    return response.data;
  }

  async deleteFolder(folderId: string, cascade: boolean = false): Promise<void> {
    await this.request(
      `/api/v1/storage/folders/${folderId}?cascade=${cascade}`,
      { method: "DELETE" }
    );
  }

  async moveDocument(documentId: string, folderId: string | null): Promise<{
    stored_document_id: string;
    folder_id: string | null;
    moved: boolean;
  }> {
    const response = await this.request<APIResponse<{
      stored_document_id: string;
      folder_id: string | null;
      moved: boolean;
    }>>(`/api/v1/storage/documents/${documentId}/move`, {
      method: "PATCH",
      body: JSON.stringify({ folder_id: folderId }),
    });
    return response.data;
  }

  async moveFolder(folderId: string, parentId: string | null): Promise<{
    folder_id: string;
    parent_id: string | null;
    path: string;
    moved: boolean;
  }> {
    const response = await this.request<APIResponse<{
      folder_id: string;
      parent_id: string | null;
      path: string;
      moved: boolean;
    }>>(`/api/v1/storage/folders/${folderId}/move`, {
      method: "PATCH",
      body: JSON.stringify({ parent_id: parentId }),
    });
    return response.data;
  }

  async getFolderStats(folderId: string): Promise<{
    folder_id: string;
    total_size_bytes: number;
    document_count: number;
    folder_count: number;
  }> {
    const response = await this.request<APIResponse<{
      folder_id: string;
      total_size_bytes: number;
      document_count: number;
      folder_count: number;
    }>>(`/api/v1/storage/folders/${folderId}/stats`);
    return response.data;
  }

  // ===== Organization/Tenant API =====

  async getMyOrganizations(userId: string): Promise<OrganizationMembership[]> {
    const response = await this.request<APIResponse<OrganizationMembership[]>>(
      `/api/v1/tenant-documents/my-tenants?user_id=${userId}`
    );
    return response.data;
  }

  async createOrganization(data: CreateOrganizationRequest): Promise<Organization> {
    const response = await this.request<APIResponse<Organization>>(
      "/api/v1/admin/tenants",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
    return response.data;
  }

  async getOrganization(id: string): Promise<Organization> {
    const response = await this.request<APIResponse<Organization>>(
      `/api/v1/admin/tenants/${id}`
    );
    return response.data;
  }

  async updateOrganization(id: string, data: Partial<CreateOrganizationRequest>): Promise<Organization> {
    const response = await this.request<APIResponse<Organization>>(
      `/api/v1/admin/tenants/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    );
    return response.data;
  }

  async getOrganizationMembers(id: string): Promise<OrganizationMember[]> {
    const response = await this.request<APIResponse<{ members: OrganizationMember[] }>>(
      `/api/v1/admin/tenants/${id}/members`
    );
    return response.data.members;
  }

  async inviteMember(organizationId: string, email: string, role: string): Promise<OrganizationInvitation> {
    const response = await this.request<APIResponse<OrganizationInvitation>>(
      `/api/v1/admin/tenants/${organizationId}/invitations`,
      {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }
    );
    return response.data;
  }

  async getOrganizationInvitations(id: string): Promise<OrganizationInvitation[]> {
    const response = await this.request<APIResponse<{ invitations: OrganizationInvitation[] }>>(
      `/api/v1/admin/tenants/${id}/invitations`
    );
    return response.data.invitations;
  }

  async cancelInvitation(organizationId: string, invitationId: string): Promise<void> {
    await this.request(
      `/api/v1/admin/tenants/${organizationId}/invitations/${invitationId}`,
      { method: "DELETE" }
    );
  }

  async removeMember(organizationId: string, memberId: string): Promise<void> {
    await this.request(
      `/api/v1/admin/tenants/${organizationId}/members/${memberId}`,
      { method: "DELETE" }
    );
  }

  async updateMemberRole(organizationId: string, memberId: string, role: string): Promise<void> {
    await this.request(
      `/api/v1/admin/tenants/${organizationId}/members/${memberId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }
    );
  }

  async getEffectiveLimits(userId: string): Promise<EffectiveLimits> {
    const response = await this.request<APIResponse<EffectiveLimits>>(
      `/api/v1/quota/effective?user_id=${userId}`
    );
    return response.data;
  }

  // ===== Billing API =====

  async getSubscription(): Promise<Subscription | null> {
    try {
      const response = await this.request<APIResponse<Subscription>>(
        "/api/v1/billing/subscription"
      );
      return response.data;
    } catch {
      return null;
    }
  }

  async updateSubscription(planId: string): Promise<Subscription> {
    const response = await this.request<APIResponse<Subscription>>(
      "/api/v1/billing/subscription",
      {
        method: "PATCH",
        body: JSON.stringify({ plan_id: planId }),
      }
    );
    return response.data;
  }

  async cancelSubscription(immediately: boolean = false): Promise<Subscription> {
    const response = await this.request<APIResponse<Subscription>>(
      "/api/v1/billing/subscription/cancel",
      {
        method: "POST",
        body: JSON.stringify({ immediately }),
      }
    );
    return response.data;
  }

  async reactivateSubscription(): Promise<Subscription> {
    const response = await this.request<APIResponse<Subscription>>(
      "/api/v1/billing/subscription/reactivate",
      { method: "POST" }
    );
    return response.data;
  }

  async createCheckoutSession(
    planId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutSession> {
    const response = await this.request<APIResponse<CheckoutSession>>(
      "/api/v1/billing/checkout",
      {
        method: "POST",
        body: JSON.stringify({
          plan_id: planId,
          success_url: successUrl,
          cancel_url: cancelUrl,
        }),
      }
    );
    return response.data;
  }

  async createBillingPortalSession(returnUrl: string): Promise<BillingPortalSession> {
    const response = await this.request<APIResponse<BillingPortalSession>>(
      "/api/v1/billing/portal",
      {
        method: "POST",
        body: JSON.stringify({ return_url: returnUrl }),
      }
    );
    return response.data;
  }

  async getPaymentMethods(): Promise<PaymentMethod[]> {
    const response = await this.request<APIResponse<PaymentMethod[]>>(
      "/api/v1/billing/payment-methods"
    );
    return response.data;
  }

  async addPaymentMethod(paymentMethodId: string): Promise<PaymentMethod> {
    const response = await this.request<APIResponse<PaymentMethod>>(
      "/api/v1/billing/payment-methods",
      {
        method: "POST",
        body: JSON.stringify({ payment_method_id: paymentMethodId }),
      }
    );
    return response.data;
  }

  async removePaymentMethod(paymentMethodId: string): Promise<void> {
    await this.request(`/api/v1/billing/payment-methods/${paymentMethodId}`, {
      method: "DELETE",
    });
  }

  async setDefaultPaymentMethod(paymentMethodId: string): Promise<PaymentMethod> {
    const response = await this.request<APIResponse<PaymentMethod>>(
      `/api/v1/billing/payment-methods/${paymentMethodId}/default`,
      { method: "POST" }
    );
    return response.data;
  }

  async getInvoices(limit: number = 10): Promise<Invoice[]> {
    const response = await this.request<APIResponse<Invoice[]>>(
      `/api/v1/billing/invoices?limit=${limit}`
    );
    return response.data;
  }

  async startTrial(planId: string): Promise<TrialResponse> {
    const response = await this.request<APIResponse<TrialResponse>>(
      `/api/v1/billing/trial/start`,
      {
        method: "POST",
        body: JSON.stringify({ plan_id: planId }),
      }
    );
    return response.data;
  }

  async getBillingUsage(): Promise<BillingUsage> {
    const response = await this.request<APIResponse<BillingUsage>>(
      "/api/v1/billing/usage"
    );
    return response.data;
  }

  // Tenant document sharing
  async shareDocumentWithOrganization(
    organizationId: string,
    documentId: string,
    accessLevel: "read" | "write",
    userId: string
  ): Promise<SharedDocument> {
    const response = await this.request<APIResponse<SharedDocument>>(
      `/api/v1/tenant-documents/${organizationId}/share?user_id=${userId}`,
      {
        method: "POST",
        body: JSON.stringify({ document_id: documentId, access_level: accessLevel }),
      }
    );
    return response.data;
  }

  async getOrganizationDocuments(
    organizationId: string,
    userId: string,
    page: number = 1,
    pageSize: number = 20
  ): Promise<{ documents: SharedDocument[]; total: number }> {
    const response = await this.request<APIResponse<{ documents: SharedDocument[]; total: number }>>(
      `/api/v1/tenant-documents/${organizationId}/documents?user_id=${userId}&page=${page}&page_size=${pageSize}`
    );
    return response.data;
  }

  async unshareDocument(organizationId: string, documentId: string, userId: string): Promise<void> {
    await this.request(
      `/api/v1/tenant-documents/${organizationId}/documents/${documentId}?user_id=${userId}`,
      { method: "DELETE" }
    );
  }

  // ===== API Keys =====

  async listApiKeys(): Promise<ApiKeyResponse[]> {
    const response = await this.request<APIResponse<ApiKeyResponse[]>>(
      "/api/v1/api-keys"
    );
    return response.data;
  }

  async createApiKey(body: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const response = await this.request<APIResponse<CreateApiKeyResponse>>(
      "/api/v1/api-keys",
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    return response.data;
  }

  async updateApiKey(
    keyId: string,
    body: { name?: string; scopes?: string; allowed_domains?: string; rate_limit?: number; is_active?: boolean }
  ): Promise<ApiKeyResponse> {
    const response = await this.request<APIResponse<ApiKeyResponse>>(
      `/api/v1/api-keys/${keyId}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      }
    );
    return response.data;
  }

  async deleteApiKey(keyId: string): Promise<void> {
    await this.request(`/api/v1/api-keys/${keyId}`, { method: "DELETE" });
  }

  async regeneratePublishableKey(keyId: string): Promise<RegenerateKeyResponse> {
    const response = await this.request<APIResponse<RegenerateKeyResponse>>(
      `/api/v1/api-keys/${keyId}/regenerate-publishable`,
      { method: "POST" }
    );
    return response.data;
  }

  async regenerateSecretKey(keyId: string): Promise<RegenerateKeyResponse> {
    const response = await this.request<APIResponse<RegenerateKeyResponse>>(
      `/api/v1/api-keys/${keyId}/regenerate-secret`,
      { method: "POST" }
    );
    return response.data;
  }

  // ===== Sharing API =====

  /**
   * Share a document with another user by email.
   */
  async shareDocument(params: {
    document_id: string;
    invitee_email: string;
    permission?: "view" | "edit";
    message?: string;
    expires_in_days?: number;
  }): Promise<ShareInvitation> {
    const response = await this.request<APIResponse<ShareInvitation>>(
      "/api/v1/sharing/share",
      {
        method: "POST",
        body: JSON.stringify({
          document_id: params.document_id,
          invitee_email: params.invitee_email,
          permission: params.permission || "edit",
          message: params.message,
          expires_in_days: params.expires_in_days || 7,
        }),
      }
    );
    return response.data;
  }

  /**
   * Get documents shared with the current user.
   */
  async getSharedWithMe(params: {
    page?: number;
    per_page?: number;
    source?: "direct" | "organization" | "all";
  } = {}): Promise<SharedWithMeResponse> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", params.page.toString());
    if (params.per_page) searchParams.set("per_page", params.per_page.toString());
    if (params.source) searchParams.set("source", params.source);

    const response = await this.request<APIResponse<SharedWithMeResponse>>(
      `/api/v1/sharing/shared-with-me?${searchParams.toString()}`
    );
    return response.data;
  }

  /**
   * Get documents that the current user has shared.
   */
  async getSharedByMe(params: {
    page?: number;
    per_page?: number;
  } = {}): Promise<SharedByMeResponse> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", params.page.toString());
    if (params.per_page) searchParams.set("per_page", params.per_page.toString());

    const response = await this.request<APIResponse<SharedByMeResponse>>(
      `/api/v1/sharing/shared-by-me?${searchParams.toString()}`
    );
    return response.data;
  }

  /**
   * Get pending share invitations.
   */
  async getPendingInvitations(): Promise<{ invitations: PendingInvitation[]; count: number }> {
    const response = await this.request<APIResponse<{ invitations: PendingInvitation[]; count: number }>>(
      "/api/v1/sharing/invitations/pending"
    );
    return response.data;
  }

  /**
   * Accept a share invitation.
   */
  async acceptInvitation(token: string): Promise<AcceptedShare> {
    const response = await this.request<APIResponse<AcceptedShare>>(
      `/api/v1/sharing/invitations/${token}/accept`,
      { method: "POST" }
    );
    return response.data;
  }

  /**
   * Decline a share invitation.
   */
  async declineInvitation(token: string): Promise<{ invitation_id: string; status: string }> {
    const response = await this.request<APIResponse<{ invitation_id: string; status: string }>>(
      `/api/v1/sharing/invitations/${token}/decline`,
      { method: "POST" }
    );
    return response.data;
  }

  /**
   * Revoke a document share.
   */
  async revokeShare(shareId: string): Promise<{ share_id: string; status: string }> {
    const response = await this.request<APIResponse<{ share_id: string; status: string }>>(
      `/api/v1/sharing/shares/${shareId}`,
      { method: "DELETE" }
    );
    return response.data;
  }

  /**
   * Update permission for a share.
   */
  async updateSharePermission(
    shareId: string,
    permission: "view" | "edit"
  ): Promise<{ share_id: string; permission: string; old_permission: string }> {
    const response = await this.request<APIResponse<{
      share_id: string;
      permission: string;
      old_permission: string;
    }>>(`/api/v1/sharing/shares/${shareId}/permission`, {
      method: "PATCH",
      body: JSON.stringify({ permission }),
    });
    return response.data;
  }

  /**
   * Get all shares for a document.
   */
  async getDocumentShares(documentId: string): Promise<{ shares: DocumentShareInfo[]; count: number }> {
    const response = await this.request<APIResponse<{ shares: DocumentShareInfo[]; count: number }>>(
      `/api/v1/sharing/documents/${documentId}/shares`
    );
    return response.data;
  }

  /**
   * Create a public link for a document.
   */
  async createPublicLink(
    documentId: string,
    expiresInDays?: number
  ): Promise<PublicLinkResponse> {
    const response = await this.request<APIResponse<PublicLinkResponse>>(
      `/api/v1/sharing/documents/${documentId}/public-link`,
      {
        method: "POST",
        body: JSON.stringify({ expires_in_days: expiresInDays }),
      }
    );
    return response.data;
  }

  /**
   * Revoke the public link for a document.
   */
  async revokePublicLink(documentId: string): Promise<{ status: string; share_id: string }> {
    const response = await this.request<APIResponse<{ status: string; share_id: string }>>(
      `/api/v1/sharing/documents/${documentId}/public-link`,
      { method: "DELETE" }
    );
    return response.data;
  }

  /**
   * Get notifications for the current user.
   */
  async getNotifications(params: {
    page?: number;
    per_page?: number;
    unread_only?: boolean;
  } = {}): Promise<NotificationsResponse> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", params.page.toString());
    if (params.per_page) searchParams.set("per_page", params.per_page.toString());
    if (params.unread_only) searchParams.set("unread_only", "true");

    const response = await this.request<APIResponse<NotificationsResponse>>(
      `/api/v1/sharing/notifications?${searchParams.toString()}`
    );
    return response.data;
  }

  /**
   * Get unread notification count.
   */
  async getUnreadNotificationCount(): Promise<{ unread_count: number }> {
    const response = await this.request<APIResponse<{ unread_count: number }>>(
      "/api/v1/sharing/notifications/unread-count"
    );
    return response.data;
  }

  /**
   * Mark a notification as read.
   */
  async markNotificationRead(notificationId: string): Promise<{ marked_as_read: boolean }> {
    const response = await this.request<APIResponse<{ marked_as_read: boolean }>>(
      `/api/v1/sharing/notifications/${notificationId}/read`,
      { method: "POST" }
    );
    return response.data;
  }

  /**
   * Mark all notifications as read.
   */
  async markAllNotificationsRead(): Promise<{ marked_count: number }> {
    const response = await this.request<APIResponse<{ marked_count: number }>>(
      "/api/v1/sharing/notifications/read-all",
      { method: "POST" }
    );
    return response.data;
  }
}

// Organization types
export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  email: string;
  logo_url?: string;
  status: "active" | "suspended" | "trial" | "cancelled";
  storage_limit_bytes: number;
  storage_used_bytes: number;
  api_calls_limit: number;
  api_calls_used: number;
  document_limit: number;
  document_count: number;
  max_members: number;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMembership {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role: string;
  permissions: string[];
  is_active: boolean;
  joined_at: string;
}

export interface OrganizationMember {
  id: string;
  user_id: string;
  email?: string;
  name?: string;
  role: string;
  is_active: boolean;
  joined_at: string;
  last_active_at?: string;
}

export interface OrganizationInvitation {
  id: string;
  email: string;
  role: string;
  is_accepted: boolean;
  expires_at: string;
  created_at: string;
}

export interface CreateOrganizationRequest {
  name: string;
  slug: string;
  email: string;
  description?: string;
  phone?: string;
  website?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface EffectiveLimits {
  storage: {
    used_bytes: number;
    limit_bytes: number;
    available_bytes: number;
    usage_percentage: number;
  };
  api_calls: {
    used: number;
    limit: number;
    remaining: number;
    usage_percentage: number;
  };
  documents: {
    count: number;
    limit: number;
  };
  plan_type: string;
  is_tenant_based: boolean;
  tenant?: {
    id: string;
    name: string;
    role: string;
  } | null;
}

export interface SharedDocument {
  id: string;
  document_id: string;
  document_name: string;
  access_level: "read" | "write";
  owner_id: string;
  owner_email?: string;
  shared_by_id: string;
  shared_by_email?: string;
  added_at: string;
  file_size_bytes: number;
  page_count: number;
}

// Billing types
export interface Subscription {
  status: string;
  current_plan: string;
  plan_name: string;
  billing_cycle: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  is_in_trial: boolean;
  trial_days_remaining: number;
  has_used_trial: boolean;
  billing_entity_type: "user" | "tenant";
}

export interface CheckoutSession {
  session_id: string;
  url: string;
}

export interface BillingPortalSession {
  url: string;
}

export interface PaymentMethod {
  id: string;
  type: string;
  card: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  } | null;
  is_default: boolean;
  created_at: string;
}

export interface Invoice {
  id: string;
  number: string;
  status: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  created: string;
  due_date: string | null;
  pdf_url: string | null;
  hosted_invoice_url: string | null;
}

export interface TrialResponse {
  message: string;
  plan: string;
  trial_start: string;
  trial_ends: string;
  trial_days: number;
}

export interface BillingUsage {
  current_period_start: string;
  current_period_end: string;
  usage: {
    documents: number;
    storage_gb: number;
    api_calls: number;
  };
  limits: {
    documents: number;
    storage_gb: number;
    api_calls: number;
  };
  billing_entity_type: "user" | "tenant";
  is_in_trial: boolean;
}

// Element types for the Elements API
export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementTransform {
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
}

export interface ElementCreateRequest {
  type: "text" | "image" | "shape" | "annotation" | "form_field";
  bounds: ElementBounds;
  content?: string;
  style?: Record<string, unknown>;
  transform?: ElementTransform;
  layer_id?: string;
  // Type-specific fields
  shape_type?: string;  // All shape types including circle, triangle, arrow, etc.
  annotation_type?: string;  // All annotation types including comment, strikethrough, etc.
  field_type?: "text" | "checkbox" | "radio" | "dropdown" | "listbox" | "signature" | "button";
  field_name?: string;
}

export interface ElementResponse {
  elementId: string;
  type: "text" | "image" | "shape" | "annotation" | "form_field";
  bounds: ElementBounds;
  transform: ElementTransform;
  layerId?: string | null;
  locked: boolean;
  visible: boolean;
  // Type-specific fields
  content?: string;
  style?: Record<string, unknown>;
  shapeType?: string;
  annotationType?: string;
  fieldType?: string;
  fieldName?: string;
  ocrConfidence?: number | null;
  linkUrl?: string | null;
  linkPage?: number | null;
}

// Sharing types
export interface ShareInvitation {
  invitation_id: string;
  token: string;
  invitee_email: string;
  invitee_user_exists: boolean;
  permission: "view" | "edit";
  expires_at: string;
  document_name: string;
}

export interface SharedWithMeDocument {
  id: string;
  name: string;
  page_count: number;
  file_size_bytes: number;
  thumbnail_path: string | null;
  created_at: string;
  updated_at: string;
  share_source: "direct" | "organization";
  share_id?: string;
  tenant_id?: string;
  permission: "view" | "edit";
  shared_at: string;
  owner: {
    user_id: string;
    email: string | null;
  };
}

export interface SharedWithMeResponse {
  documents: SharedWithMeDocument[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface SharedByMeShare {
  share_id: string;
  document: {
    id: string;
    name: string;
    page_count: number;
    thumbnail_path: string | null;
  };
  shared_with: {
    user_id: string | null;
    email: string | null;
  } | null;
  is_public_link: boolean;
  permission: "view" | "edit";
  created_at: string;
  expires_at: string | null;
}

export interface SharedByMeResponse {
  shares: SharedByMeShare[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface PendingInvitation {
  invitation_id: string;
  token: string;
  document: {
    id: string;
    name: string;
    page_count: number;
    thumbnail_path: string | null;
  };
  inviter: {
    user_id: string;
    email: string | null;
  };
  permission: "view" | "edit";
  message: string | null;
  created_at: string;
  expires_at: string;
}

export interface AcceptedShare {
  share_id: string;
  document_id: string;
  document_name: string;
  permission: "view" | "edit";
}

export interface DocumentShareInfo {
  share_id?: string;
  invitation_id?: string;
  shared_with?: {
    user_id: string | null;
    email: string | null;
  } | null;
  invitee_email?: string;
  is_public_link?: boolean;
  share_token?: string;
  permission: "view" | "edit";
  status?: "pending" | "active";
  created_at: string;
  expires_at: string | null;
}

export interface PublicLinkResponse {
  share_id: string;
  token: string;
  permission: "view";
  expires_at: string | null;
  already_existed: boolean;
}

export interface ShareNotification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  document: {
    id: string;
    name: string;
  } | null;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: ShareNotification[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// ===== API Keys types =====

export interface ApiKeyResponse {
  id: string;
  name: string;
  key_prefix: string;
  publishable_key_prefix: string | null;
  scopes: string[];
  allowed_domains: string[] | null;
  rate_limit: number;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface CreateApiKeyRequest {
  name: string;
  scopes?: string;
  allowed_domains?: string;
  rate_limit?: number;
  expires_at?: string;
}

export interface CreateApiKeyResponse {
  key: string;
  publishable_key: string;
  api_key: ApiKeyResponse;
}

export interface RegenerateKeyResponse {
  key: string;
  api_key: ApiKeyResponse;
}

// Singleton instance
export const api = new APIClient();

// Export class for custom instances
export { APIClient };
