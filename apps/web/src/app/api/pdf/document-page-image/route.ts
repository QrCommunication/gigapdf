/**
 * Render a single page of a STORED document as an image, for semantic-search
 * result previews (#85).
 *
 * POST /api/pdf/document-page-image
 *
 * Loads the stored document into a backend session, downloads its bytes, renders
 * the requested page via the WASM engine, and returns the PNG. When a `bbox`
 * (in PDF points, the shape returned by /api/v1/search/semantic) is supplied,
 * the matching image-pixel rectangle is returned in response headers so the
 * client can overlay a highlight without re-deriving the rotation-aware math.
 *
 * Request (application/json):
 *   {
 *     storedDocumentId: string,
 *     page: number,                       // 1-based
 *     scale?: number,                     // render scale (default 1.5)
 *     bbox?: { x, y, w, h }               // PDF points (lower-left origin)
 *   }
 *   Authorization: Bearer <JWT>           // forwarded to Python backend
 *
 * Response (200): image/png
 *   X-Image-Width  / X-Image-Height       — rendered pixel dimensions
 *   X-Bbox-Left / X-Bbox-Top / X-Bbox-Width / X-Bbox-Height
 *                                          — highlight rect in image pixels
 *                                            (only when bbox was supplied)
 *
 * Error codes: 400, 401, 404, 422, 500, 502, 504
 */

import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { renderPagesWithDimensions, pdfBoxToImageRect } from '@/lib/pdf-page-render';
import { requireSession } from '@/lib/auth-helpers';
import { serverLogger } from '@/lib/server-logger';

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL ??
  (process.env.NODE_ENV === 'production'
    ? 'http://127.0.0.1:8000'
    : 'http://localhost:8000');

const REQUEST_TIMEOUT_MS = 30_000;

const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const RequestBodySchema = z.object({
  storedDocumentId: z.string().min(1, 'storedDocumentId cannot be empty'),
  page: z.number().int().min(1, 'page must be >= 1'),
  scale: z.number().positive().max(4).optional().default(1.5),
  /** Single highlight (legacy). Prefer `bboxes` for grouped page hits. */
  bbox: BBoxSchema.optional(),
  /** All highlight boxes on the page (one search result = one page, many hits). */
  bboxes: z.array(BBoxSchema).max(200).optional(),
});

export async function POST(request: NextRequest): Promise<Response> {
  // ── 1. Local session (cookie) + forward the Bearer to Python ────────────────
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { success: false, error: 'Authorization header is required (Bearer token).' },
      { status: 401 },
    );
  }

  // ── 2. Validate body ────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }
  const parsed = RequestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid request body.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { storedDocumentId, page, scale, bbox } = parsed.data;

  try {
    // ── 3. Load the stored doc into a backend session ─────────────────────────
    const sessionDocumentId = await loadStoredDocument(storedDocumentId, authHeader);
    if (sessionDocumentId === null) {
      return NextResponse.json(
        { success: false, error: 'Document not found or not accessible.' },
        { status: 404 },
      );
    }

    // ── 4. Download the PDF bytes ──────────────────────────────────────────────
    const pdfBuffer = await downloadSessionPdf(sessionDocumentId, authHeader);

    // ── 5. Render the page via the WASM engine ────────────────────────────────
    const rendered = await renderPagesWithDimensions(
      new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength),
      { page, scale },
    );
    if (!rendered) {
      return NextResponse.json(
        { success: false, error: `Page ${page} is out of range.` },
        { status: 400 },
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'image/png',
      'Content-Length': String(rendered.bytes.byteLength),
      'Cache-Control': 'private, max-age=300',
      'X-Image-Width': String(rendered.imageWidth),
      'X-Image-Height': String(rendered.imageHeight),
    };

    // ── 6. Map every bbox to image pixels (rotation-aware) ────────────────────
    // A search result groups all hits of one page, so we map a LIST of boxes and
    // return them as JSON in `X-Bbox-Rects`. The legacy single `X-Bbox-*` headers
    // are kept (first rect) for older clients.
    const boxes = parsed.data.bboxes ?? (bbox ? [bbox] : []);
    if (boxes.length > 0) {
      const mapDims = {
        imageWidth: rendered.imageWidth,
        imageHeight: rendered.imageHeight,
        pageWidth: rendered.pageWidth,
        pageHeight: rendered.pageHeight,
        rotation: rendered.rotation,
      };
      const rects = boxes
        .map((b) => {
          const r = pdfBoxToImageRect(b, mapDims);
          return {
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })
        .filter((r) => r.width > 0 && r.height > 0);

      const first = rects[0];
      if (first) {
        headers['X-Bbox-Rects'] = JSON.stringify(rects);
        headers['X-Bbox-Left'] = String(first.left);
        headers['X-Bbox-Top'] = String(first.top);
        headers['X-Bbox-Width'] = String(first.width);
        headers['X-Bbox-Height'] = String(first.height);
      }
    }

    return new Response(Buffer.from(rendered.bytes), { status: 200, headers });
  } catch (err: unknown) {
    if (err instanceof BackendAuthError) {
      return NextResponse.json(
        { success: false, error: 'Authentication rejected by backend.' },
        { status: 401 },
      );
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'Backend timed out.' },
        { status: 504 },
      );
    }
    serverLogger.error('api.pdf.document-page-image', { error: err, storedDocumentId, page });
    return NextResponse.json(
      { success: false, error: 'Failed to render page preview.' },
      { status: 500 },
    );
  }
}

/** Load a stored document into a backend session; returns the session id or null (404). */
async function loadStoredDocument(
  storedDocumentId: string,
  authHeader: string,
): Promise<string | null> {
  const url = `${PYTHON_BACKEND_URL}/api/v1/storage/documents/${encodeURIComponent(storedDocumentId)}/load`;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authHeader },
      signal: abort.signal,
    });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      throw new BackendAuthError();
    }
    if (!res.ok) {
      throw new Error(`load returned ${res.status}`);
    }
    const json = (await res.json()) as { data?: { document_id?: string } };
    const sessionId = json.data?.document_id;
    if (!sessionId) throw new Error('load response missing document_id');
    return sessionId;
  } finally {
    clearTimeout(timeout);
  }
}

/** Download the PDF bytes for a backend session document. */
async function downloadSessionPdf(
  sessionDocumentId: string,
  authHeader: string,
): Promise<Buffer> {
  const url = `${PYTHON_BACKEND_URL}/api/v1/documents/${encodeURIComponent(sessionDocumentId)}/download`;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader },
      signal: abort.signal,
    });
    if (!res.ok) {
      throw new Error(`download returned ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

class BackendAuthError extends Error {
  constructor() {
    super('Authentication rejected by backend.');
    this.name = 'BackendAuthError';
  }
}
