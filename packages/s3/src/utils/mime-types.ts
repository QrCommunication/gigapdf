/**
 * MIME type utilities for file validation and content type detection.
 */

/**
 * Supported file types and their MIME types
 */
export const MIME_TYPES = {
  // PDF
  pdf: 'application/pdf',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  // Documents
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  txt: 'text/plain',
  csv: 'text/csv',
  // Archives
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  // Other
  json: 'application/json',
  xml: 'application/xml',
} as const;

/**
 * PDF MIME types
 */
export const PDF_MIME_TYPES = ['application/pdf'] as const;

/**
 * Image MIME types
 */
export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

/**
 * Document MIME types
 */
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

/**
 * Get MIME type from file extension
 */
export function getMimeTypeFromExtension(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (!extension) {
    return 'application/octet-stream';
  }
  return MIME_TYPES[extension as keyof typeof MIME_TYPES] || 'application/octet-stream';
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const entry = Object.entries(MIME_TYPES).find(([, type]) => type === mimeType);
  return entry ? entry[0] : '';
}

/**
 * Validate if file type is allowed
 */
export function isValidFileType(filename: string, allowedTypes?: string[]): boolean {
  const mimeType = getMimeTypeFromExtension(filename);
  if (!allowedTypes || allowedTypes.length === 0) {
    return true;
  }
  return allowedTypes.includes(mimeType);
}

/**
 * Check if file is a PDF
 */
export function isPdfFile(filename: string): boolean {
  const mimeType = getMimeTypeFromExtension(filename);
  return PDF_MIME_TYPES.includes(mimeType as any);
}

/**
 * Check if file is an image
 */
export function isImageFile(filename: string): boolean {
  const mimeType = getMimeTypeFromExtension(filename);
  return IMAGE_MIME_TYPES.includes(mimeType as any);
}

/**
 * Check if file is a document
 */
export function isDocumentFile(filename: string): boolean {
  const mimeType = getMimeTypeFromExtension(filename);
  return DOCUMENT_MIME_TYPES.includes(mimeType as any);
}

/**
 * Validate file type and throw error if invalid
 */
export function validateFileType(filename: string, allowedTypes?: string[]): void {
  if (!isValidFileType(filename, allowedTypes)) {
    const mimeType = getMimeTypeFromExtension(filename);
    throw new Error(
      `Invalid file type: ${mimeType}. Allowed types: ${allowedTypes?.join(', ')}`
    );
  }
}
