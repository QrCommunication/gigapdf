/**
 * download-document-bytes.ts
 *
 * Fetch the raw PDF bytes of a STORED document so the dashboard can convert it
 * client-side (image / office / text export) instead of round-tripping a backend
 * job.
 *
 * A stored document id is not directly downloadable: the API allocates a fresh,
 * transient *session* document id every time a stored doc is opened. So we
 * `loadDocument(storedId)` → get the session id → hit the session download route
 * with credentials + bearer token (same flow the editor uses to load its PDF
 * binary). The session id is re-allocated on every `load`, so we always re-load
 * right before downloading rather than caching it.
 *
 * No React, no DOM — a plain module function, reusable by the document card and
 * the document table.
 */

import { api, getAuthToken } from "@/lib/api";
import { exportDocumentAs } from "@/components/editor/lib/export-document";
import { exportPagesAsImages } from "@/components/editor/lib/export-pages-as-images";
import { extractDocumentText } from "@/components/editor/lib/extract-text";

/** Formats the dashboard export menu offers for a stored document. */
export type DashboardExportFormat =
  | "png"
  | "jpeg"
  | "webp"
  | "html"
  | "txt"
  | "docx"
  | "xlsx";

/**
 * Download the current PDF bytes of a stored document as a `Uint8Array`.
 *
 * @param storedDocumentId The dashboard-facing (durable) document id.
 * @throws If the document cannot be loaded or the download responds non-2xx.
 */
export async function downloadDocumentBytes(
  storedDocumentId: string,
): Promise<Uint8Array> {
  // Re-load to obtain a fresh session document id (it changes on every load).
  const { document_id: sessionDocumentId } =
    await api.loadDocument(storedDocumentId);

  const downloadUrl = api.getDocumentDownloadUrl(sessionDocumentId);
  const token = await getAuthToken();
  const response = await fetch(downloadUrl, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Convert raw PDF `bytes` into the requested dashboard export `format`, entirely
 * client-side via the GigaPDF SDK. Returns the download `Blob` plus the file
 * extension to suffix the download name with:
 *
 * - `png` / `jpeg` / `webp` → a `.zip` of per-page images
 *   ({@link exportPagesAsImages}).
 * - `docx` / `xlsx` / `html` → the SDK's editable exporter
 *   ({@link exportDocumentAs}).
 * - `txt` → extracted plain text ({@link extractDocumentText}) as a UTF-8 Blob.
 */
export async function convertDocumentBytes(
  bytes: Uint8Array,
  format: DashboardExportFormat,
): Promise<{ blob: Blob; extension: string }> {
  if (format === "png" || format === "jpeg" || format === "webp") {
    const blob = await exportPagesAsImages(bytes, format, {
      dpi: 150,
      quality: 85,
    });
    return { blob, extension: "zip" };
  }
  if (format === "txt") {
    const text = await extractDocumentText(bytes);
    return {
      blob: new Blob([text], { type: "text/plain;charset=utf-8" }),
      extension: "txt",
    };
  }
  // docx | xlsx | html — the SDK lowers the PDF into the editable format.
  const blob = await exportDocumentAs(bytes, format);
  return { blob, extension: format };
}
