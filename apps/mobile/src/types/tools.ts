/**
 * PDF Tools types for GigaPDF
 * Based on the real GigaPDF API capabilities
 */

import { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * PDF Tool definition
 */
export interface PDFTool {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  color: string;
  route: string;
  isNew?: boolean;
  isPremium?: boolean;
  apiEndpoint?: string; // Related API endpoint
}

/**
 * Tool Category
 */
export interface ToolCategory {
  id: string;
  name: string;
  description?: string;
  icon?: IconName;
  tools: PDFTool[];
}

/**
 * Element types supported by the API
 */
export type ElementType =
  | 'text'
  | 'image'
  | 'shape'
  | 'signature'
  | 'stamp'
  | 'drawing';

/**
 * Annotation types supported by the API
 */
export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'note'
  | 'link';

/**
 * Form field types
 */
export type FormFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'signature';

/**
 * Page operation types
 */
export type PageOperation =
  | 'rotate'
  | 'resize'
  | 'extract'
  | 'reorder'
  | 'delete';

/**
 * Tool action parameters
 */
export interface ToolActionParams {
  documentId: string;
  pageNumber?: number;
  elementId?: string;
  [key: string]: any;
}

/**
 * Tool result
 */
export interface ToolResult {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}
