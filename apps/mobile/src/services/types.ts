/**
 * API Response Types for GigaPDF Mobile Application
 * Complete type definitions for all API endpoints
 */

// ============================================================================
// Base Types
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number;
    to: number;
  };
  links?: {
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface LoginCredentials {
  email: string;
  password: string;
  remember_me?: boolean;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  password_confirmation?: string; // Not required by Better Auth
  locale?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in: number;
}

/**
 * User model compatible with Better Auth
 */
export interface User {
  id: string;
  name?: string;
  email: string;
  email_verified?: boolean;
  avatar?: string;
  created_at: string;
  updated_at: string;
  role?: 'user' | 'admin' | 'super_admin';
  permissions?: string[];
  locale?: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

/**
 * Better Auth Session structure
 */
export interface BetterAuthSession {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
  };
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    image: string | null;
    createdAt: string;
    updatedAt: string;
    locale?: string;
  };
}

// ============================================================================
// Document Types
// ============================================================================

export enum DocumentStatus {
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
  LOCKED = 'locked',
}

export interface Document {
  id: string;
  user_id: string;
  title: string;
  filename: string;
  original_filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  status: DocumentStatus;
  page_count: number;
  is_locked: boolean;
  metadata?: DocumentMetadata;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface DocumentMetadata {
  author?: string;
  creator?: string;
  producer?: string;
  subject?: string;
  keywords?: string[];
  creation_date?: string;
  modification_date?: string;
  pdf_version?: string;
  is_encrypted?: boolean;
  has_forms?: boolean;
  has_annotations?: boolean;
  page_size?: {
    width: number;
    height: number;
    unit: string;
  };
}

export interface UploadDocumentData {
  file: File | Blob | any; // React Native file object
  title?: string;
  password?: string;
}

export interface UnlockDocumentData {
  password: string;
}

export interface DocumentTextExtraction {
  document_id: string;
  page_count: number;
  pages: Array<{
    page_number: number;
    text: string;
    confidence?: number;
  }>;
  full_text: string;
  extracted_at: string;
}

// ============================================================================
// Page Types
// ============================================================================

export enum PageOrientation {
  PORTRAIT = 'portrait',
  LANDSCAPE = 'landscape',
}

export interface Page {
  id: string;
  document_id: string;
  page_number: number;
  width: number;
  height: number;
  orientation: PageOrientation;
  rotation: number; // 0, 90, 180, 270
  thumbnail_url?: string;
  preview_url?: string;
  metadata?: PageMetadata;
  created_at: string;
  updated_at: string;
}

export interface PageMetadata {
  has_text?: boolean;
  has_images?: boolean;
  has_annotations?: boolean;
  word_count?: number;
  image_count?: number;
}

export interface AddPageData {
  file: File | Blob | any;
  position?: number; // Where to insert the page
}

export interface ReorderPagesData {
  page_numbers: number[]; // New order of page numbers
}

export interface RotatePageData {
  rotation: number; // Degrees: 90, 180, 270, or -90
}

export interface ExtractPagesData {
  page_numbers: number[];
  create_new_document?: boolean;
  new_document_title?: string;
}

export interface PagePreview {
  page_number: number;
  preview_url: string;
  thumbnail_url?: string;
  width: number;
  height: number;
  format: string; // 'png', 'jpg', 'webp'
}

// ============================================================================
// Element Types
// ============================================================================

export enum ElementType {
  TEXT = 'text',
  IMAGE = 'image',
  SIGNATURE = 'signature',
  SHAPE = 'shape',
  CHECKBOX = 'checkbox',
  STAMP = 'stamp',
}

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface ElementBase {
  id: string;
  document_id: string;
  page_number: number;
  type: ElementType;
  position: Position;
  size: Size;
  rotation?: number;
  z_index?: number;
  opacity?: number;
  locked?: boolean;
  created_at: string;
  updated_at: string;
}

export interface TextElement extends ElementBase {
  type: ElementType.TEXT;
  content: string;
  font_family?: string;
  font_size?: number;
  font_weight?: string;
  font_style?: string;
  color?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  line_height?: number;
}

export interface ImageElement extends ElementBase {
  type: ElementType.IMAGE;
  image_url: string;
  original_filename?: string;
  mime_type?: string;
  fit?: 'cover' | 'contain' | 'fill' | 'none';
}

export interface SignatureElement extends ElementBase {
  type: ElementType.SIGNATURE;
  signature_url: string;
  signature_data?: string; // Base64 or SVG data
  signed_by?: string;
  signed_at?: string;
}

export interface ShapeElement extends ElementBase {
  type: ElementType.SHAPE;
  shape_type: 'rectangle' | 'circle' | 'line' | 'arrow' | 'polygon';
  fill_color?: string;
  stroke_color?: string;
  stroke_width?: number;
  points?: Position[]; // For polygon
}

export interface CheckboxElement extends ElementBase {
  type: ElementType.CHECKBOX;
  checked: boolean;
  label?: string;
  required?: boolean;
}

export interface StampElement extends ElementBase {
  type: ElementType.STAMP;
  stamp_type: 'approved' | 'rejected' | 'confidential' | 'draft' | 'custom';
  stamp_text?: string;
  color?: string;
}

export type Element =
  | TextElement
  | ImageElement
  | SignatureElement
  | ShapeElement
  | CheckboxElement
  | StampElement;

export interface CreateElementData {
  type: ElementType;
  page_number: number;
  position: Position;
  size: Size;
  rotation?: number;
  z_index?: number;
  opacity?: number;
  // Type-specific fields
  content?: string; // For text
  font_family?: string;
  font_size?: number;
  color?: string;
  image?: File | Blob | any; // For image/signature
  signature_data?: string;
  shape_type?: string;
  fill_color?: string;
  stroke_color?: string;
  checked?: boolean; // For checkbox
  stamp_type?: string; // For stamp
  [key: string]: any;
}

export interface UpdateElementData {
  position?: Position;
  size?: Size;
  rotation?: number;
  z_index?: number;
  opacity?: number;
  locked?: boolean;
  // Type-specific updates
  content?: string;
  font_size?: number;
  color?: string;
  checked?: boolean;
  [key: string]: any;
}

// ============================================================================
// Annotation Types
// ============================================================================

export enum AnnotationType {
  MARKUP = 'markup',
  NOTE = 'note',
  LINK = 'link',
  HIGHLIGHT = 'highlight',
  UNDERLINE = 'underline',
  STRIKEOUT = 'strikeout',
}

export interface AnnotationBase {
  id: string;
  document_id: string;
  page_number: number;
  type: AnnotationType;
  user_id: string;
  user_name?: string;
  created_at: string;
  updated_at: string;
}

export interface MarkupAnnotation extends AnnotationBase {
  type: AnnotationType.MARKUP | AnnotationType.HIGHLIGHT | AnnotationType.UNDERLINE | AnnotationType.STRIKEOUT;
  color?: string;
  opacity?: number;
  coordinates: Position[];
  text_content?: string; // The text being marked up
}

export interface NoteAnnotation extends AnnotationBase {
  type: AnnotationType.NOTE;
  position: Position;
  content: string;
  color?: string;
  icon?: string;
}

export interface LinkAnnotation extends AnnotationBase {
  type: AnnotationType.LINK;
  position: Position;
  size: Size;
  url: string;
  target?: '_blank' | '_self';
}

export type Annotation = MarkupAnnotation | NoteAnnotation | LinkAnnotation;

export interface CreateMarkupAnnotationData {
  color?: string;
  opacity?: number;
  coordinates: Position[];
  text_content?: string;
}

export interface CreateNoteAnnotationData {
  position: Position;
  content: string;
  color?: string;
  icon?: string;
}

export interface CreateLinkAnnotationData {
  position: Position;
  size: Size;
  url: string;
  target?: '_blank' | '_self';
}

// ============================================================================
// Error Types
// ============================================================================

export interface ApiError {
  message: string;
  status: number;
  code?: string;
  errors?: Record<string, string[]>;
  details?: any;
}

export class ApiException extends Error {
  constructor(
    public message: string,
    public status: number,
    public code?: string,
    public errors?: Record<string, string[]>,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiException';
  }
}

// ============================================================================
// Request Configuration Types
// ============================================================================

export interface RequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, any>;
  timeout?: number;
  signal?: AbortSignal;
}

export interface UploadProgressCallback {
  (progress: number, loaded: number, total: number): void;
}

export interface DownloadProgressCallback {
  (progress: number, loaded: number, total: number): void;
}

// ============================================================================
// Query Parameters Types
// ============================================================================

export interface PaginationParams {
  page?: number;
  per_page?: number;
}

export interface SortParams {
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface FilterParams {
  status?: DocumentStatus;
  search?: string;
  from_date?: string;
  to_date?: string;
}

export interface DocumentListParams extends PaginationParams, SortParams, FilterParams {
  include_deleted?: boolean;
}

// ============================================================================
// WebSocket Types (for real-time updates)
// ============================================================================

export enum WebSocketEventType {
  DOCUMENT_UPDATED = 'document.updated',
  DOCUMENT_DELETED = 'document.deleted',
  PAGE_ADDED = 'page.added',
  PAGE_DELETED = 'page.deleted',
  ELEMENT_CREATED = 'element.created',
  ELEMENT_UPDATED = 'element.updated',
  ELEMENT_DELETED = 'element.deleted',
  ANNOTATION_CREATED = 'annotation.created',
  ANNOTATION_UPDATED = 'annotation.updated',
  ANNOTATION_DELETED = 'annotation.deleted',
}

export interface WebSocketEvent {
  type: WebSocketEventType;
  data: any;
  timestamp: string;
}
