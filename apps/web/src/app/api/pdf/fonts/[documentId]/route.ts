/**
 * Embedded-font list route (engine-backed — replaces the legacy Python
 * pikepdf/fontTools endpoint at GET /api/v1/pdf/fonts/{documentId}).
 *
 * GET /api/pdf/fonts/{documentId}
 *   → { success, data: { documentId, fonts: ExtractedFontMeta[], total } }
 *
 * Bytes come from the Python session (download), fonts are extracted with the
 * gigapdf engine (correct Unicode cmap, no glyph garbling).
 */

import 'server-only';

import { NextResponse } from 'next/server';
import { listDocumentFonts } from '@giga-pdf/pdf-engine';
import { fetchSessionPdfBytes } from '@/lib/document-bytes';
import { serverLogger } from '@/lib/server-logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await params;
  if (!documentId) {
    return NextResponse.json(
      { success: false, error: 'documentId is required.' },
      { status: 400 },
    );
  }

  const fetched = await fetchSessionPdfBytes(documentId, {
    authorization: request.headers.get('Authorization'),
    cookie: request.headers.get('Cookie'),
  });
  if (!fetched.ok) {
    return NextResponse.json(
      { success: false, error: fetched.error },
      { status: fetched.status },
    );
  }

  try {
    const fonts = await listDocumentFonts(fetched.bytes);
    return NextResponse.json({
      success: true,
      data: { documentId, fonts, total: fonts.length },
    });
  } catch (err) {
    serverLogger.error('[api/pdf/fonts] Font list extraction failed', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Could not extract fonts from the document.' },
      { status: 422 },
    );
  }
}
