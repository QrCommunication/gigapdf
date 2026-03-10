/**
 * PDF Operations Types
 * Types pour les opérations PDF
 */

export interface MergePDFRequest {
  document_ids: string[];
  output_name: string;
  folder_id?: string;
}

export interface SplitPDFRequest {
  document_id: string;
  split_type: 'pages' | 'ranges' | 'bookmarks';
  pages?: number[]; // Pour split_type = 'pages'
  ranges?: PageRange[]; // Pour split_type = 'ranges'
  output_prefix?: string;
  folder_id?: string;
}

export interface PageRange {
  start: number;
  end: number;
  name?: string;
}

export interface CompressPDFRequest {
  document_id: string;
  quality: 'low' | 'medium' | 'high';
  output_name?: string;
  folder_id?: string;
}

export interface ConvertToPDFRequest {
  document_id: string;
  output_name?: string;
  folder_id?: string;
  options?: ConvertOptions;
}

export interface ConvertFromPDFRequest {
  document_id: string;
  format: 'jpg' | 'png' | 'word' | 'excel' | 'ppt' | 'txt' | 'html';
  output_name?: string;
  folder_id?: string;
  options?: ConvertOptions;
}

export interface ConvertOptions {
  dpi?: number;
  quality?: number;
  page_range?: PageRange;
  color_mode?: 'rgb' | 'grayscale' | 'monochrome';
}

export interface RotatePDFRequest {
  document_id: string;
  rotation: 90 | 180 | 270;
  pages?: number[]; // Si vide, toutes les pages
  output_name?: string;
  folder_id?: string;
}

export interface ExtractPagesRequest {
  document_id: string;
  pages: number[];
  output_name?: string;
  folder_id?: string;
}

export interface AddWatermarkRequest {
  document_id: string;
  watermark_type: 'text' | 'image';
  text?: string;
  image_url?: string;
  position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity?: number; // 0-100
  rotation?: number;
  font_size?: number;
  font_color?: string;
  output_name?: string;
  folder_id?: string;
}

export interface ProtectPDFRequest {
  document_id: string;
  password: string;
  permissions?: PDFPermissions;
  output_name?: string;
  folder_id?: string;
}

export interface PDFPermissions {
  allow_printing: boolean;
  allow_copying: boolean;
  allow_modification: boolean;
  allow_annotation: boolean;
  allow_form_filling: boolean;
}

export interface UnlockPDFRequest {
  document_id: string;
  password: string;
  output_name?: string;
  folder_id?: string;
}

export interface OCRRequest {
  document_id: string;
  language: string; // ISO 639-1 code (en, fr, es, etc.)
  output_name?: string;
  folder_id?: string;
}

export interface SignPDFRequest {
  document_id: string;
  signature_type: 'draw' | 'text' | 'image';
  signature_data: string; // Base64 pour image/draw, texte pour text
  position: SignaturePosition;
  pages: number[]; // Pages à signer
  output_name?: string;
  folder_id?: string;
}

export interface SignaturePosition {
  x: number; // Position X en pourcentage
  y: number; // Position Y en pourcentage
  width: number; // Largeur en pourcentage
  height: number; // Hauteur en pourcentage
}

export interface FormFillRequest {
  document_id: string;
  fields: Record<string, string>; // field_name => value
  output_name?: string;
  folder_id?: string;
  flatten?: boolean; // Convertir les champs en contenu fixe
}

export interface PDFOperation {
  id: string;
  user_id: string;
  operation_type: PDFOperationType;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number; // 0-100
  input_documents: string[]; // IDs des documents d'entrée
  output_document_id?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export type PDFOperationType =
  | 'merge'
  | 'split'
  | 'compress'
  | 'convert_to_pdf'
  | 'convert_from_pdf'
  | 'rotate'
  | 'extract_pages'
  | 'watermark'
  | 'protect'
  | 'unlock'
  | 'ocr'
  | 'sign'
  | 'form_fill';

export interface PDFTool {
  id: PDFOperationType;
  name: string;
  description: string;
  icon: string;
  category: 'organize' | 'optimize' | 'convert' | 'secure' | 'edit';
}
