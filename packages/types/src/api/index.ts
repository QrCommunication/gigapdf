/**
 * API Response and Request Types
 * Matches FastAPI backend response schemas
 */

import type {
  UUID,
  ISODateTime,
  Pagination,
} from "../models/common";
import type { DocumentObject, DocumentMetadata } from "../models/document";
import type { PageObject, PageSummary } from "../models/page";
import type { Element as BaseElement } from "../models/elements";
import type { HistoryEntry } from "../models/history";
import type { JobObject, JobStatus } from "../models/jobs";
import type { PresignedUrlInfo, StorageInfo } from "../models/storage";
import type { QuotaUsage, QuotaLimits, PlanType } from "../models/quota";

// Type aliases for API compatibility - exported for use by consumers
// These add 'id' as an alias for the primary ID field
export type Document = DocumentObject & { id: string };
export type Page = PageObject & { id: string };
export type PageThumbnail = PageSummary;
export type Job = JobObject & { id: string };
export type APIElement = BaseElement & { id: string };

// ============================================================================
// Generic API Response Types
// ============================================================================

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ErrorDetail;
  meta?: ResponseMeta;
}

export interface ErrorDetail {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  field?: string;
}

export interface ResponseMeta {
  requestId: string;
  timestamp: ISODateTime;
  duration?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: Pagination;
  /** Shortcut for pagination.total for API compatibility */
  total?: number;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: "Bearer";
  user: UserInfo;
}

// API response variants with snake_case (matching backend)
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "Bearer";
  user: User;
}

export interface RegisterResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "Bearer";
  user: User;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  tenant_id?: string;
  role: UserRole;
  created_at: string;
  email_verified: boolean;
}

export interface UserInfo {
  id: UUID;
  email: string;
  name: string;
  avatarUrl?: string;
  tenantId: UUID;
  role: UserRole;
  createdAt: ISODateTime;
  emailVerified: boolean;
}

export type UserRole = "user" | "admin" | "super_admin";

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "Bearer";
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirmRequest {
  token: string;
  newPassword: string;
}

// ============================================================================
// Document API Types
// ============================================================================

export interface CreateDocumentRequest {
  name: string;
  folderId?: UUID;
  templateId?: UUID;
}

export interface UpdateDocumentRequest {
  name?: string;
  folderId?: UUID;
  tags?: string[];
}

export interface DocumentListResponse extends PaginatedResponse<DocumentMetadata> {}

export interface DocumentResponse {
  document: Document;
  pages: Page[];
  permissions: APIDocumentPermissions;
}

export interface APIDocumentPermissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canExport: boolean;
}

export interface DocumentShareRequest {
  email: string;
  permission: "view" | "edit" | "admin";
  expiresAt?: ISODateTime;
  message?: string;
}

export interface DocumentShareResponse {
  shareId: UUID;
  shareUrl: string;
  expiresAt?: ISODateTime;
}

export interface DocumentDuplicateRequest {
  name?: string;
  folderId?: UUID;
}

// ============================================================================
// Page API Types
// ============================================================================

export interface AddPageRequest {
  afterPageNumber?: number;
  templateId?: UUID;
  width?: number;
  height?: number;
}

// Alias for backwards compatibility
export type CreatePageRequest = AddPageRequest;

export interface UpdatePageRequest {
  width?: number;
  height?: number;
  rotation?: number;
  background?: PageBackground;
}

export interface PageBackground {
  type: "color" | "image" | "transparent";
  value?: string;
}

export interface ReorderPagesRequest {
  pageOrder: UUID[];
}

export interface PageListResponse {
  pages: Page[];
  thumbnails: PageThumbnail[];
}

// ============================================================================
// Element API Types
// ============================================================================

export interface CreateElementRequest {
  type: BaseElement["type"];
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  properties: Record<string, unknown>;
}

export interface UpdateElementRequest {
  bounds?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  transform?: {
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
    skewX?: number;
    skewY?: number;
  };
  properties?: Record<string, unknown>;
  locked?: boolean;
  visible?: boolean;
}

export interface BatchElementsRequest {
  operations: ElementOperation[];
}

export interface ElementOperation {
  action: "create" | "update" | "delete";
  elementId?: UUID;
  data?: CreateElementRequest | UpdateElementRequest;
}

export interface ElementListResponse {
  elements: APIElement[];
}

// ============================================================================
// Upload API Types
// ============================================================================

export interface UploadInitRequest {
  filename: string;
  contentType: string;
  size: number;
  documentId?: UUID;
}

export interface UploadInitResponse {
  uploadId: UUID;
  presignedUrl: string;
  expiresAt: ISODateTime;
  maxSize: number;
}

export interface UploadCompleteRequest {
  uploadId: UUID;
  etag?: string;
}

export interface UploadCompleteResponse {
  fileId: UUID;
  url: string;
  documentId?: UUID;
}

export interface MultipartUploadInitResponse {
  uploadId: UUID;
  key: string;
  parts: PresignedUrlInfo[];
}

export interface MultipartUploadCompleteRequest {
  uploadId: UUID;
  parts: CompletedPart[];
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

// ============================================================================
// Export API Types
// ============================================================================

export type ExportFormat = "pdf" | "png" | "jpg" | "svg" | "docx";

export interface ExportRequest {
  format: ExportFormat;
  pages?: number[];
  quality?: number;
  dpi?: number;
  includeAnnotations?: boolean;
  flattenLayers?: boolean;
  password?: string;
  watermark?: WatermarkOptions;
}

export interface WatermarkOptions {
  text?: string;
  imageUrl?: string;
  opacity: number;
  position: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "tile";
  rotation?: number;
}

export interface ExportResponse {
  jobId: UUID;
  status: JobStatus;
  estimatedTime?: number;
}

export interface ExportResultResponse {
  downloadUrl: string;
  expiresAt: ISODateTime;
  fileSize: number;
  format: ExportFormat;
}

// ============================================================================
// OCR API Types
// ============================================================================

export type OCRLanguage = "fra" | "eng" | "deu" | "spa" | "ita" | "por" | "nld" | "pol" | "rus" | "ara" | "chi_sim" | "chi_tra" | "jpn" | "kor";

export interface OCRRequest {
  documentId: UUID;
  pages?: number[];
  languages: OCRLanguage[];
  detectLayout?: boolean;
  outputFormat?: "text" | "hocr" | "searchable_pdf";
}

export interface OCRResponse {
  jobId: UUID;
  status: JobStatus;
}

export interface OCRResultResponse {
  pages: OCRPageResult[];
  fullText: string;
  confidence: number;
}

export interface OCRPageResult {
  pageNumber: number;
  text: string;
  blocks: OCRBlock[];
  confidence: number;
}

export interface OCRBlock {
  text: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  type: "paragraph" | "line" | "word";
}

// ============================================================================
// Conversion API Types
// ============================================================================

export type ConversionInputFormat = "docx" | "xlsx" | "pptx" | "html" | "txt" | "md" | "jpg" | "png" | "tiff";
export type ConversionOutputFormat = "pdf";

export interface ConversionRequest {
  inputFormat: ConversionInputFormat;
  outputFormat: ConversionOutputFormat;
  options?: ConversionOptions;
}

export interface ConversionOptions {
  quality?: "draft" | "standard" | "high";
  pageSize?: "a4" | "letter" | "legal" | "auto";
  orientation?: "portrait" | "landscape" | "auto";
  margins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface ConversionResponse {
  jobId: UUID;
  status: JobStatus;
}

// ============================================================================
// Job API Types
// ============================================================================

export interface JobListResponse extends PaginatedResponse<Job> {}

export interface JobStatusResponse {
  job: Job;
  result?: unknown;
}

export interface JobCancelResponse {
  success: boolean;
  job: Job;
}

// ============================================================================
// Storage API Types
// ============================================================================

export interface StorageInfoResponse {
  storage: StorageInfo;
  quota: QuotaUsage;
  limits: QuotaLimits;
}

export interface FileListResponse extends PaginatedResponse<FileInfo> {}

export interface FileInfo {
  id: UUID;
  name: string;
  path: string;
  size: number;
  contentType: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  thumbnailUrl?: string;
}

export interface FileDeleteResponse {
  success: boolean;
  freedSpace: number;
}

// ============================================================================
// Folder API Types
// ============================================================================

export interface CreateFolderRequest {
  name: string;
  parentId?: UUID;
  color?: string;
}

export interface UpdateFolderRequest {
  name?: string;
  parentId?: UUID;
  color?: string;
}

export interface FolderListResponse {
  folders: FolderInfo[];
}

export interface FolderInfo {
  id: UUID;
  name: string;
  parentId?: UUID;
  color?: string;
  documentCount: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ============================================================================
// Template API Types
// ============================================================================

export interface TemplateListResponse extends PaginatedResponse<TemplateInfo> {}

export interface TemplateInfo {
  id: UUID;
  name: string;
  description?: string;
  thumbnailUrl?: string;
  category: string;
  tags: string[];
  isPublic: boolean;
  createdAt: ISODateTime;
}

export interface CreateTemplateRequest {
  name: string;
  description?: string;
  documentId: UUID;
  category: string;
  tags?: string[];
  isPublic?: boolean;
}

// ============================================================================
// History API Types
// ============================================================================

export interface HistoryListResponse extends PaginatedResponse<HistoryEntry> {}

export interface RestoreVersionRequest {
  versionId: UUID;
  createNewVersion?: boolean;
}

export interface RestoreVersionResponse {
  document: Document;
  restoredFromVersion: UUID;
}

// ============================================================================
// Billing API Types
// ============================================================================

export interface SubscriptionInfo {
  id: UUID;
  plan: PlanType;
  status: "active" | "past_due" | "canceled" | "trialing";
  currentPeriodStart: ISODateTime;
  currentPeriodEnd: ISODateTime;
  cancelAtPeriodEnd: boolean;
  trialEnd?: ISODateTime;
}

export interface CreateCheckoutRequest {
  plan: PlanType;
  successUrl: string;
  cancelUrl: string;
  couponCode?: string;
}

export interface CreateCheckoutResponse {
  checkoutUrl: string;
  sessionId: string;
}

export interface BillingPortalResponse {
  portalUrl: string;
}

export interface InvoiceListResponse extends PaginatedResponse<InvoiceInfo> {}

export interface InvoiceInfo {
  id: string;
  number: string;
  amount: number;
  currency: string;
  status: "paid" | "open" | "void" | "uncollectible";
  createdAt: ISODateTime;
  pdfUrl?: string;
}

export interface UsageStatsResponse {
  quota: QuotaUsage;
  limits: QuotaLimits;
  periodStart: ISODateTime;
  periodEnd: ISODateTime;
  history: UsageHistoryPoint[];
}

export interface UsageHistoryPoint {
  date: ISODateTime;
  apiCalls: number;
  storageBytes: number;
  documentsCreated: number;
}

// ============================================================================
// Admin API Types
// ============================================================================

export interface TenantListResponse extends PaginatedResponse<TenantInfo> {}

export interface TenantInfo {
  id: UUID;
  name: string;
  slug: string;
  plan: PlanType;
  status: "active" | "suspended" | "deleted";
  userCount: number;
  documentCount: number;
  storageUsed: number;
  createdAt: ISODateTime;
}

export interface CreateTenantRequest {
  name: string;
  slug: string;
  adminEmail: string;
  plan: PlanType;
}

export interface UpdateTenantRequest {
  name?: string;
  plan?: PlanType;
  status?: "active" | "suspended";
  quotaOverrides?: Partial<QuotaLimits>;
}

export interface SystemStatsResponse {
  totalTenants: number;
  totalUsers: number;
  totalDocuments: number;
  totalStorageBytes: number;
  activeJobs: number;
  systemHealth: SystemHealthInfo;
}

export interface SystemHealthInfo {
  api: ServiceHealth;
  database: ServiceHealth;
  redis: ServiceHealth;
  storage: ServiceHealth;
  celery: ServiceHealth;
}

export interface ServiceHealth {
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs?: number;
  message?: string;
}

// ============================================================================
// Additional Types / Aliases for API Package Compatibility
// ============================================================================

export interface DocumentListParams {
  page?: number;
  perPage?: number;
  offset?: number;
  limit?: number;
  folderId?: string;
  search?: string;
  tags?: string[];
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface ExportJob {
  jobId: string;
  /** Alias for jobId for API compatibility */
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  format: ExportFormat;
  downloadUrl?: string;
  file_name?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface OcrJob {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  result?: OCRResultResponse;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// Alias for OCRRequest (snake_case variant)
export type OcrRequest = OCRRequest;
export type OcrResult = OCRResultResponse;

export interface UploadResponse {
  uploadId: string;
  upload_id: string;
  fileId: string;
  url: string;
  upload_url: string;
  fileName: string;
  contentType: string;
  size: number;
  status: "pending" | "uploading" | "processing" | "completed" | "failed";
  createdAt: string;
}

export interface PresignedUrlResponse {
  url: string;
  upload_id: string;
  upload_url: string;
  fields: Record<string, string>;
  expiresAt: string;
}

// Subscription alias
export type Subscription = SubscriptionInfo;

export interface Plan {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  features: string[];
  limits: {
    storage: number;
    apiCalls: number;
    documents: number;
  };
  isPopular?: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  amount: number;
  currency: string;
  status: "paid" | "open" | "void" | "uncollectible";
  createdAt: string;
  pdfUrl?: string;
}

export interface PaymentMethod {
  id: string;
  type: "card" | "bank_account";
  last4: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
}

// Billing portal session alias
export type BillingPortalSession = BillingPortalResponse;

export interface CheckoutSession {
  sessionId: string;
  url: string;
  expiresAt: string;
}
