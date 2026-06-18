/**
 * PDF Apply Elements route
 *
 * POST /api/pdf/apply-elements
 * Applies an ordered list of element operations (add, update, delete) to a PDF
 * and returns the modified PDF binary.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   operations — JSON string of ElementOperation[] (required)
 *
 * ElementOperation schema:
 * {
 *   action: 'add' | 'update' | 'delete',
 *   pageNumber: number,           // 1-based
 *   element: Record<string, unknown>,
 *   oldBounds?: { x, y, width, height }  // required for 'update'; used for 'delete'
 * }
 *
 * Supported element types: text, image, shape, annotation, form_field
 *
 * Implementation: delegates to `applyOperations` (pdf-engine) which runs the
 * canonical 2-pass pipeline (native redaction pass on input → native add on the
 * redacted bytes). No more white-rectangle masking on this path.
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { applyOperations } from '@giga-pdf/pdf-engine';
import type { ElementOperation } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import { createFontCacheDbAdapter } from '@/lib/font-cache-db';
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

    const operationsRaw = formData.get('operations') as string | null;
    if (!operationsRaw) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: operations (JSON ElementOperation[])' },
        { status: 400 },
      );
    }

    let operations: ElementOperation[];
    try {
      operations = JSON.parse(operationsRaw) as ElementOperation[];
    } catch {
      return NextResponse.json(
        { success: false, error: 'operations must be valid JSON.' },
        { status: 400 },
      );
    }

    if (!Array.isArray(operations)) {
      return NextResponse.json(
        { success: false, error: 'operations must be a JSON array.' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    const result = await applyOperations(inputBuffer, operations, {
      fontCache: createFontCacheDbAdapter(),
    });

    if (!result.redactionSucceeded && result.redactionTargetsCount > 0) {
      serverLogger.warn('api.pdf.apply-elements: redactions degraded', {
        targets: result.redactionTargetsCount,
        addsApplied: result.addsApplied,
      });
    }

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
    if (error instanceof Error && error.message.startsWith('applyOperations:')) {
      // Validation error from the helper (oldBounds missing, etc.)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    serverLogger.error('api.pdf.apply-elements', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to apply element operations.' },
      { status: 500 },
    );
  }
}
