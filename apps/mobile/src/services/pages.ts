/**
 * Pages Service
 * Handles all page-related operations within documents
 */

import { apiClient, createFormData } from './api';
import {
  ApiResponse,
  Page,
  PagePreview,
  AddPageData,
  ReorderPagesData,
  RotatePageData,
  ExtractPagesData,
  Document,
} from './types';
// Use legacy API for file system operations
import {
  cacheDirectory,
  createDownloadResumable,
} from 'expo-file-system/legacy';

// ============================================================================
// Pages Service
// ============================================================================

export const pagesService = {
  /**
   * Get all pages of a document
   * @param documentId - Document ID
   * @returns Array of pages
   */
  async list(documentId: string): Promise<Page[]> {
    const response = await apiClient.get<Page[]>(`/documents/${documentId}/pages`);
    return response.data!;
  },

  /**
   * Get single page details
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @returns Page details
   */
  async get(documentId: string, pageNumber: number): Promise<Page> {
    const response = await apiClient.get<Page>(
      `/documents/${documentId}/pages/${pageNumber}`
    );
    return response.data!;
  },

  /**
   * Get page preview image
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param width - Optional width for preview
   * @param height - Optional height for preview
   * @returns Page preview data with image URL
   */
  async getPreview(
    documentId: string,
    pageNumber: number,
    width?: number,
    height?: number
  ): Promise<PagePreview> {
    const response = await apiClient.get<PagePreview>(
      `/documents/${documentId}/pages/${pageNumber}/preview`,
      {
        params: {
          width,
          height,
        },
      }
    );
    return response.data!;
  },

  /**
   * Download page preview image to local file
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param width - Optional width for preview
   * @param height - Optional height for preview
   * @returns Local file URI
   */
  async downloadPreview(
    documentId: string,
    pageNumber: number,
    width?: number,
    height?: number
  ): Promise<string> {
    const fileName = `page_${documentId}_${pageNumber}.png`;
    const fileUri = `${cacheDirectory}${fileName}`;

    const params = new URLSearchParams();
    if (width) params.append('width', width.toString());
    if (height) params.append('height', height.toString());

    const url = `${apiClient.getInstance().defaults.baseURL}/documents/${documentId}/pages/${pageNumber}/preview?${params.toString()}`;

    const downloadResumable = createDownloadResumable(
      url,
      fileUri,
      {
        headers: {
          Authorization: `Bearer ${await import('./api').then((m) => m.tokenManager.getAccessToken())}`,
        },
      }
    );

    const result = await downloadResumable.downloadAsync();

    if (!result) {
      throw new Error('Preview download failed');
    }

    return result.uri;
  },

  /**
   * Get page thumbnail
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @returns Thumbnail URL
   */
  async getThumbnail(documentId: string, pageNumber: number): Promise<string> {
    const response = await apiClient.get<{ url: string }>(
      `/documents/${documentId}/pages/${pageNumber}/thumbnail`
    );
    return response.data!.url;
  },

  /**
   * Add new page to document
   * @param documentId - Document ID
   * @param data - Page data including file
   * @param onProgress - Upload progress callback
   * @returns Updated document
   */
  async add(
    documentId: string,
    data: AddPageData,
    onProgress?: (progress: number) => void
  ): Promise<Document> {
    const formData = new FormData();

    // Handle file upload for React Native
    const fileUri = data.file.uri || data.file;
    const fileName = data.file.name || data.file.fileName || 'page.pdf';
    const fileType = data.file.type || data.file.mimeType || 'application/pdf';

    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: fileType,
    } as any);

    if (data.position !== undefined) {
      formData.append('position', data.position.toString());
    }

    const response = await apiClient.uploadFile<Document>(
      `/documents/${documentId}/pages`,
      formData,
      onProgress
    );

    return response.data!;
  },

  /**
   * Delete page from document
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @returns Updated document
   */
  async delete(documentId: string, pageNumber: number): Promise<Document> {
    const response = await apiClient.delete<Document>(
      `/documents/${documentId}/pages/${pageNumber}`
    );
    return response.data!;
  },

  /**
   * Delete multiple pages from document
   * @param documentId - Document ID
   * @param pageNumbers - Array of page numbers to delete
   * @returns Updated document
   */
  async deleteMultiple(documentId: string, pageNumbers: number[]): Promise<Document> {
    const response = await apiClient.post<Document>(
      `/documents/${documentId}/pages/delete-multiple`,
      {
        page_numbers: pageNumbers,
      }
    );
    return response.data!;
  },

  /**
   * Reorder pages in document
   * @param documentId - Document ID
   * @param data - New order of page numbers
   * @returns Updated document
   */
  async reorder(documentId: string, data: ReorderPagesData): Promise<Document> {
    const response = await apiClient.put<Document>(
      `/documents/${documentId}/pages/reorder`,
      data
    );
    return response.data!;
  },

  /**
   * Rotate page
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param data - Rotation data
   * @returns Updated page
   */
  async rotate(
    documentId: string,
    pageNumber: number,
    data: RotatePageData
  ): Promise<Page> {
    const response = await apiClient.put<Page>(
      `/documents/${documentId}/pages/${pageNumber}/rotate`,
      data
    );
    return response.data!;
  },

  /**
   * Rotate multiple pages
   * @param documentId - Document ID
   * @param pageNumbers - Array of page numbers to rotate
   * @param rotation - Rotation in degrees (90, 180, 270, or -90)
   * @returns Updated document
   */
  async rotateMultiple(
    documentId: string,
    pageNumbers: number[],
    rotation: number
  ): Promise<Document> {
    const response = await apiClient.post<Document>(
      `/documents/${documentId}/pages/rotate-multiple`,
      {
        page_numbers: pageNumbers,
        rotation,
      }
    );
    return response.data!;
  },

  /**
   * Extract pages to new document
   * @param documentId - Document ID
   * @param data - Pages to extract and options
   * @returns New document or updated existing document
   */
  async extract(documentId: string, data: ExtractPagesData): Promise<Document> {
    const response = await apiClient.post<Document>(
      `/documents/${documentId}/pages/extract`,
      data
    );
    return response.data!;
  },

  /**
   * Duplicate page within document
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param position - Position where to insert duplicate
   * @returns Updated document
   */
  async duplicate(
    documentId: string,
    pageNumber: number,
    position?: number
  ): Promise<Document> {
    const response = await apiClient.post<Document>(
      `/documents/${documentId}/pages/${pageNumber}/duplicate`,
      {
        position,
      }
    );
    return response.data!;
  },

  /**
   * Move page to different position
   * @param documentId - Document ID
   * @param pageNumber - Current page number
   * @param newPosition - New position (1-based)
   * @returns Updated document
   */
  async move(
    documentId: string,
    pageNumber: number,
    newPosition: number
  ): Promise<Document> {
    const response = await apiClient.post<Document>(
      `/documents/${documentId}/pages/${pageNumber}/move`,
      {
        position: newPosition,
      }
    );
    return response.data!;
  },

  /**
   * Replace page with new content
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param file - New page file
   * @param onProgress - Upload progress callback
   * @returns Updated document
   */
  async replace(
    documentId: string,
    pageNumber: number,
    file: any,
    onProgress?: (progress: number) => void
  ): Promise<Document> {
    const formData = new FormData();

    const fileUri = file.uri || file;
    const fileName = file.name || file.fileName || 'page.pdf';
    const fileType = file.type || file.mimeType || 'application/pdf';

    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: fileType,
    } as any);

    const response = await apiClient.uploadFile<Document>(
      `/documents/${documentId}/pages/${pageNumber}/replace`,
      formData,
      onProgress
    );

    return response.data!;
  },

  /**
   * Crop page to specified dimensions
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param cropData - Crop dimensions
   * @returns Updated page
   */
  async crop(
    documentId: string,
    pageNumber: number,
    cropData: {
      x: number;
      y: number;
      width: number;
      height: number;
    }
  ): Promise<Page> {
    const response = await apiClient.post<Page>(
      `/documents/${documentId}/pages/${pageNumber}/crop`,
      cropData
    );
    return response.data!;
  },

  /**
   * Resize page
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param width - New width
   * @param height - New height
   * @param maintainAspectRatio - Whether to maintain aspect ratio
   * @returns Updated page
   */
  async resize(
    documentId: string,
    pageNumber: number,
    width: number,
    height: number,
    maintainAspectRatio = true
  ): Promise<Page> {
    const response = await apiClient.post<Page>(
      `/documents/${documentId}/pages/${pageNumber}/resize`,
      {
        width,
        height,
        maintain_aspect_ratio: maintainAspectRatio,
      }
    );
    return response.data!;
  },

  /**
   * Extract text from specific page
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @returns Extracted text
   */
  async extractText(documentId: string, pageNumber: number): Promise<string> {
    const response = await apiClient.get<{ text: string }>(
      `/documents/${documentId}/pages/${pageNumber}/text`
    );
    return response.data!.text;
  },

  /**
   * Extract images from page
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @returns Array of image URLs
   */
  async extractImages(documentId: string, pageNumber: number): Promise<string[]> {
    const response = await apiClient.get<{ images: string[] }>(
      `/documents/${documentId}/pages/${pageNumber}/images`
    );
    return response.data!.images;
  },

  /**
   * Get page dimensions
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @returns Page dimensions
   */
  async getDimensions(
    documentId: string,
    pageNumber: number
  ): Promise<{ width: number; height: number; orientation: string }> {
    const response = await apiClient.get<{
      width: number;
      height: number;
      orientation: string;
    }>(`/documents/${documentId}/pages/${pageNumber}/dimensions`);
    return response.data!;
  },

  /**
   * Add blank page to document
   * @param documentId - Document ID
   * @param position - Position where to insert page
   * @param width - Page width (default: A4)
   * @param height - Page height (default: A4)
   * @returns Updated document
   */
  async addBlank(
    documentId: string,
    position?: number,
    width = 595,
    height = 842
  ): Promise<Document> {
    const response = await apiClient.post<Document>(
      `/documents/${documentId}/pages/blank`,
      {
        position,
        width,
        height,
      }
    );
    return response.data!;
  },

  /**
   * Convert page to image
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param format - Image format (png, jpg, webp)
   * @param quality - Image quality (1-100)
   * @param dpi - Resolution in DPI
   * @returns Image URL or download URL
   */
  async convertToImage(
    documentId: string,
    pageNumber: number,
    format: 'png' | 'jpg' | 'webp' = 'png',
    quality = 90,
    dpi = 150
  ): Promise<string> {
    const response = await apiClient.post<{ url: string }>(
      `/documents/${documentId}/pages/${pageNumber}/convert-to-image`,
      {
        format,
        quality,
        dpi,
      }
    );
    return response.data!.url;
  },

  /**
   * Compare two pages
   * @param documentId1 - First document ID
   * @param pageNumber1 - First page number
   * @param documentId2 - Second document ID
   * @param pageNumber2 - Second page number
   * @returns Comparison result with differences
   */
  async compare(
    documentId1: string,
    pageNumber1: number,
    documentId2: string,
    pageNumber2: number
  ): Promise<{
    differences: Array<{ type: string; position: any; description: string }>;
    similarity_score: number;
  }> {
    const response = await apiClient.post<{
      differences: Array<{ type: string; position: any; description: string }>;
      similarity_score: number;
    }>('/pages/compare', {
      page1: { document_id: documentId1, page_number: pageNumber1 },
      page2: { document_id: documentId2, page_number: pageNumber2 },
    });
    return response.data!;
  },

  /**
   * Apply filter to page
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param filter - Filter type (grayscale, sepia, invert, etc.)
   * @returns Updated page
   */
  async applyFilter(
    documentId: string,
    pageNumber: number,
    filter: 'grayscale' | 'sepia' | 'invert' | 'brightness' | 'contrast',
    intensity = 100
  ): Promise<Page> {
    const response = await apiClient.post<Page>(
      `/documents/${documentId}/pages/${pageNumber}/filter`,
      {
        filter,
        intensity,
      }
    );
    return response.data!;
  },
};

export default pagesService;
