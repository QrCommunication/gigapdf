import 'server-only';

import { serverLogger } from '@/lib/server-logger';

/**
 * Internal URL of the Python FastAPI backend (authoritative for byte storage).
 * Dev: localhost:8000 — Prod: loopback 127.0.0.1:8000 (bypasses nginx for the
 * server-to-server call). Override via PYTHON_BACKEND_URL (server-only).
 */
const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL ??
  (process.env.NODE_ENV === 'production'
    ? 'http://127.0.0.1:8000'
    : 'http://localhost:8000');

const DOWNLOAD_TIMEOUT_MS = 30_000;

export type FetchBytesResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; status: number; error: string };

/**
 * Fetch a session document's PDF bytes from the Python backend, forwarding the
 * caller's auth (Bearer and/or session cookie). The Python session remains the
 * single authority for byte retrieval; the TS engine owns everything derived
 * from those bytes (parse, render, font extraction).
 */
export async function fetchSessionPdfBytes(
  documentId: string,
  auth: { authorization?: string | null; cookie?: string | null },
): Promise<FetchBytesResult> {
  const downloadUrl = `${PYTHON_BACKEND_URL}/api/v1/documents/${encodeURIComponent(documentId)}/download`;

  const headers: Record<string, string> = {};
  if (auth.authorization) headers.Authorization = auth.authorization;
  if (auth.cookie) headers.Cookie = auth.cookie;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(downloadUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (res.status === 404) {
      return {
        ok: false,
        status: 404,
        error: `Document session '${documentId}' not found. It may have expired or never existed.`,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 401, error: 'Authentication rejected by backend.' };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      serverLogger.error('[document-bytes] Unexpected error from Python backend', {
        documentId,
        status: res.status,
        body: body.slice(0, 300),
      });
      return { ok: false, status: 502, error: 'Failed to retrieve PDF from backend.' };
    }

    const arrayBuffer = await res.arrayBuffer();
    return { ok: true, bytes: Buffer.from(arrayBuffer) };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      serverLogger.error('[document-bytes] Python backend timeout', { documentId });
      return { ok: false, status: 504, error: 'Backend timed out while retrieving PDF.' };
    }
    serverLogger.error('[document-bytes] Network error contacting Python backend', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 502, error: 'Failed to connect to backend.' };
  } finally {
    clearTimeout(timeoutId);
  }
}
