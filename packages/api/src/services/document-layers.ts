import { apiClient } from '../client';
import type { LayerObject } from '@giga-pdf/types';

/**
 * Cross-session persistence payload for editor user layers.
 *
 * - `layers`     : the editor-only "Layer Groups" (NOT PDF OCG layers).
 * - `membership` : maps a (deterministic) elementId → the layerId it belongs to.
 *                  Keyed by elementId so it re-attaches after the editor
 *                  re-parses the PDF on open (P1 made elementIds deterministic).
 */
export interface DocumentLayersData {
  layers: LayerObject[];
  membership: Record<string, string>;
}

/**
 * Document layers service — persists editor user layers + element→layer
 * membership against the STORED document id (survives reloads).
 *
 * Backend endpoints: /storage/documents/{storedDocumentId}/layers
 */
export const documentLayersService = {
  /**
   * Fetch saved user layers + membership for a stored document.
   * Returns `{ layers: [], membership: {} }` when none have been saved.
   * Backend: GET /storage/documents/{storedDocumentId}/layers
   */
  getDocumentLayers: async (storedDocumentId: string): Promise<DocumentLayersData> => {
    const response = await apiClient.get<DocumentLayersData>(
      `/storage/documents/${storedDocumentId}/layers`
    );
    return response.data;
  },

  /**
   * Upsert user layers + membership for a stored document.
   * Backend: PUT /storage/documents/{storedDocumentId}/layers
   */
  putDocumentLayers: async (
    storedDocumentId: string,
    data: DocumentLayersData
  ): Promise<DocumentLayersData> => {
    const response = await apiClient.put<DocumentLayersData>(
      `/storage/documents/${storedDocumentId}/layers`,
      data
    );
    return response.data;
  },
};
