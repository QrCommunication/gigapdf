/**
 * Document Types
 * Types pour les documents et dossiers
 */

export interface Document {
  id: string;
  user_id: string;
  folder_id?: string;
  name: string;
  original_name: string;
  file_path: string;
  file_size: number; // in bytes
  mime_type: string;
  extension: string;
  page_count?: number;
  thumbnail_path?: string;
  is_favorite: boolean;
  is_trashed: boolean;
  tags?: string[];
  metadata?: DocumentMetadata;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  folder?: Folder;
  shared?: ShareInfo[];
}

export interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
  creation_date?: string;
  modification_date?: string;
  encrypted?: boolean;
  has_form?: boolean;
  has_signature?: boolean;
}

export interface Folder {
  id: string;
  user_id: string;
  parent_id?: string;
  name: string;
  color?: string;
  icon?: string;
  documents_count: number;
  created_at: string;
  updated_at: string;
  parent?: Folder;
  children?: Folder[];
}

export interface ShareInfo {
  id: string;
  document_id: string;
  shared_with_email?: string;
  shared_with_user_id?: string;
  permission: 'view' | 'edit' | 'download';
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentRequest {
  name: string;
  folder_id?: string;
  file: File | Blob;
  tags?: string[];
}

export interface UpdateDocumentRequest {
  name?: string;
  folder_id?: string;
  is_favorite?: boolean;
  tags?: string[];
}

export interface ShareDocumentRequest {
  email?: string;
  user_id?: string;
  permission: 'view' | 'edit' | 'download';
  expires_at?: string;
  message?: string;
}

export interface CreateFolderRequest {
  name: string;
  parent_id?: string;
  color?: string;
  icon?: string;
}

export interface UpdateFolderRequest {
  name?: string;
  parent_id?: string;
  color?: string;
  icon?: string;
}

export interface MoveDocumentRequest {
  document_ids: string[];
  folder_id?: string;
}

export interface DocumentFilter {
  search?: string;
  folder_id?: string;
  is_favorite?: boolean;
  is_trashed?: boolean;
  tags?: string[];
  sort_by?: 'name' | 'created_at' | 'updated_at' | 'file_size';
  sort_order?: 'asc' | 'desc';
}

export type DocumentAction =
  | 'open'
  | 'share'
  | 'delete'
  | 'rename'
  | 'duplicate'
  | 'favorite'
  | 'move'
  | 'download'
  | 'restore';

/**
 * PDFDocument type for UI components
 * Simplified version of Document for display purposes
 */
export interface PDFDocument {
  id: string;
  name: string;
  uri: string;
  size: number;
  pageCount?: number;
  createdAt: Date;
  modifiedAt: Date;
  thumbnailUri?: string;
  isFavorite?: boolean;
  tags?: string[];
}

/**
 * Convert API Document to UI PDFDocument
 */
export function documentToPDFDocument(doc: Document): PDFDocument {
  return {
    id: doc.id,
    name: doc.name,
    uri: doc.file_path,
    size: doc.file_size,
    pageCount: doc.page_count,
    createdAt: new Date(doc.created_at),
    modifiedAt: new Date(doc.updated_at),
    thumbnailUri: doc.thumbnail_path,
    isFavorite: doc.is_favorite,
    tags: doc.tags,
  };
}
