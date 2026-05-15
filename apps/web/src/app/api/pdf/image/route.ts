/**
 * PDF Image Element route — single-element wrapper around applyOperations.
 *
 * POST /api/pdf/image
 * Embeds or updates an image element on a PDF page.
 *
 * Form fields (multipart/form-data):
 *   file        — PDF file (required)
 *   imageFile   — PNG or JPEG image to embed (required for "add"; optional for "update")
 *   operation   — "add" | "update" (required)
 *   pageNumber  — 1-based page number (required)
 *   element     — JSON ImageElement object (required)
 *   oldBounds   — JSON Bounds object (required for "update")
 *
 * Implementation delegates to applyOperations (pdf-engine), wiring the
 * uploaded imageFile bytes through a custom extractImageData closure so
 * the helper picks them up at Phase 2. The 2-pass pipeline replaces the
 * legacy mask + updateImage path.
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { applyOperations } from '@giga-pdf/pdf-engine';
import type { ElementOperation } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import type { ImageElement, Bounds } from '@giga-pdf/types';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile, validateImageFile } from '@/lib/request-validation';

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
        { success: false, error: 'Missing required field: element (JSON ImageElement).' },
        { status: 400 },
      );
    }

    let element: ImageElement;
    try {
      element = JSON.parse(elementRaw) as ImageElement;
    } catch {
      return NextResponse.json(
        { success: false, error: 'element must be valid JSON.' },
        { status: 400 },
      );
    }

    // ── Extract imageFile bytes ─────────────────────────────────────────────
    // 'add': image is required. 'update': image is optional (may be a pure
    // bounds/style update on an existing image).
    let imageBytes: Uint8Array | undefined;
    if (operation === 'add') {
      const imageFileValidation = validateImageFile(formData.get('imageFile'));
      if (!imageFileValidation.ok) return imageFileValidation.response;
      imageBytes = new Uint8Array(await imageFileValidation.file.arrayBuffer());
    } else {
      const imageFile = formData.get('imageFile');
      if (imageFile instanceof File) {
        imageBytes = new Uint8Array(await imageFile.arrayBuffer());
      }
    }

    // ── oldBounds for update ────────────────────────────────────────────────
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

    // Inject imageBytes into the pipeline via the extractImageData closure.
    // For 'update' without a new image, return undefined — Phase 2 will then
    // not call addImage (the visual cell stays empty after Phase 1 redaction).
    const result = await applyOperations(inputBuffer, [op], {
      extractImageData: () => imageBytes,
    });

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

    serverLogger.error('api.pdf.image', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to apply image operation.' },
      { status: 500 },
    );
  }
}
