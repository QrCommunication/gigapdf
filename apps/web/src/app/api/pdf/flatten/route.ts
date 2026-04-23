/**
 * PDF Flatten route
 *
 * POST /api/pdf/flatten
 * Flattens form fields and/or annotations into static PDF content.
 * After flattening, interactive elements become non-editable graphics.
 *
 * Form fields (multipart/form-data):
 *   file        — PDF file (required)
 *   target      — "forms" | "annotations" | "all" (default: "all")
 *   pageNumber  — 1-based page number to flatten only that page (optional)
 *                 omit to flatten entire document
 *
 * Returns the flattened PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import {
  openDocument,
  saveDocument,
  flattenForms,
  flattenAnnotations,
} from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

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

    const target = (formData.get('target') as string | null) ?? 'all';
    if (target !== 'forms' && target !== 'annotations' && target !== 'all') {
      return NextResponse.json(
        { success: false, error: 'target must be "forms", "annotations", or "all".' },
        { status: 400 },
      );
    }

    const pageNumberRaw = formData.get('pageNumber');
    let pageNumber: number | null = null;
    if (pageNumberRaw !== null && pageNumberRaw !== '') {
      pageNumber = Number(pageNumberRaw);
      if (!Number.isInteger(pageNumber) || pageNumber < 1) {
        return NextResponse.json(
          { success: false, error: 'pageNumber must be a positive integer.' },
          { status: 400 },
        );
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);

    if (target === 'forms' || target === 'all') {
      flattenForms(handle, pageNumber);
    }

    if (target === 'annotations' || target === 'all') {
      flattenAnnotations(handle, pageNumber);
    }

    const savedBytes = await saveDocument(handle);

    return new Response(new Uint8Array(savedBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file.name}"`,
        'Content-Length': String(savedBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFPageOutOfRangeError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    console.error('[api/pdf/flatten]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to flatten PDF.' },
      { status: 500 },
    );
  }
}
