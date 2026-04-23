/**
 * PDF Metadata route
 *
 * POST /api/pdf/metadata
 * Get or set PDF document metadata (title, author, subject, keywords, etc.).
 *
 * Form fields (multipart/form-data):
 *   file     — PDF file (required)
 *   action   — "get" | "set" (required)
 *   metadata — JSON DocumentMetadata object (required for "set")
 *
 * DocumentMetadata schema (subset of @giga-pdf/types):
 * {
 *   title?: string,
 *   author?: string,
 *   subject?: string,
 *   keywords?: string,
 *   creator?: string,
 *   producer?: string,
 *   creationDate?: string,   // ISO 8601
 *   modificationDate?: string
 * }
 *
 * "get" — returns JSON with current metadata.
 * "set" — returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import {
  openDocument,
  saveDocument,
  getMetadata,
  setMetadata,
} from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
import type { DocumentMetadata } from '@giga-pdf/types';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: file' },
        { status: 400 },
      );
    }

    const action = formData.get('action') as string | null;
    if (action !== 'get' && action !== 'set') {
      return NextResponse.json(
        { success: false, error: 'action must be "get" or "set".' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (action === 'get') {
      const handle = await openDocument(buffer);
      const metadata = getMetadata(handle);
      return NextResponse.json({
        success: true,
        data: metadata,
      });
    }

    // action === 'set'
    const metadataRaw = formData.get('metadata') as string | null;
    if (!metadataRaw) {
      return NextResponse.json(
        { success: false, error: 'metadata (JSON) is required for set action.' },
        { status: 400 },
      );
    }

    let metadata: Partial<Pick<DocumentMetadata, 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer'>>;
    try {
      metadata = JSON.parse(metadataRaw) as Partial<Pick<DocumentMetadata, 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer'>>;
    } catch {
      return NextResponse.json(
        { success: false, error: 'metadata must be valid JSON.' },
        { status: 400 },
      );
    }

    const handle = await openDocument(buffer);
    setMetadata(handle, metadata);
    const savedBytes = await saveDocument(handle);

    return new Response(new Uint8Array(savedBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(savedBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    console.error('[api/pdf/metadata]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process metadata operation.' },
      { status: 500 },
    );
  }
}
