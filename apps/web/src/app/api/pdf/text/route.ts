/**
 * PDF Text route — single-element wrapper around applyOperations.
 *
 * POST /api/pdf/text
 * Adds or updates a text element on a PDF page and returns the modified PDF.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   operation  — "add" | "update" (required)
 *   pageNumber — 1-based page number (required)
 *   element    — JSON TextElement object (required)
 *   oldBounds  — JSON Bounds object (required only for "update")
 *
 * Implementation delegates to applyOperations (pdf-engine) so this route
 * benefits from the same 2-pass pipeline as /api/pdf/apply-elements:
 * MuPDF redaction on input → pdf-lib addText on the redacted bytes.
 * No white-rectangle masking.
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { applyOperations } from '@giga-pdf/pdf-engine';
import type { ElementOperation } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import type { TextElement, Bounds } from '@giga-pdf/types';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const operation = formData.get('operation') as string | null;
    if (operation !== 'add' && operation !== 'update') {
      return NextResponse.json(
        { success: false, error: 'operation must be "add" or "update".' },
        { status: 400 },
      );
    }

    const pageNumberRaw = formData.get('pageNumber');
    const pageNumber = Number(pageNumberRaw);
    if (!pageNumberRaw || !Number.isInteger(pageNumber) || pageNumber < 1) {
      return NextResponse.json(
        { success: false, error: 'pageNumber must be a positive integer.' },
        { status: 400 },
      );
    }

    const elementRaw = formData.get('element') as string | null;
    if (!elementRaw) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: element (JSON TextElement).' },
        { status: 400 },
      );
    }

    let element: TextElement;
    try {
      element = JSON.parse(elementRaw) as TextElement;
    } catch {
      return NextResponse.json(
        { success: false, error: 'element must be valid JSON.' },
        { status: 400 },
      );
    }

    let oldBounds: Bounds | undefined;
    if (operation === 'update') {
      const oldBoundsRaw = formData.get('oldBounds') as string | null;
      if (!oldBoundsRaw) {
        return NextResponse.json(
          { success: false, error: 'oldBounds is required for update operation.' },
          { status: 400 },
        );
      }
      try {
        oldBounds = JSON.parse(oldBoundsRaw) as Bounds;
      } catch {
        return NextResponse.json(
          { success: false, error: 'oldBounds must be valid JSON.' },
          { status: 400 },
        );
      }
    }

    const op: ElementOperation = {
      action: operation,
      pageNumber,
      element: element as unknown as Record<string, unknown>,
      oldBounds,
    };

    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);
    const result = await applyOperations(inputBuffer, [op]);

    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(result.bytes.byteLength),
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

    serverLogger.error('api.pdf.text', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to apply text operation.' },
      { status: 500 },
    );
  }
}
