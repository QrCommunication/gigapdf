/**
 * PDF Image Element route
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
 * ImageElement schema (subset of @giga-pdf/types):
 * {
 *   bounds: { x, y, width, height },
 *   style: { opacity },
 *   transform: { rotation, scaleX, scaleY }
 * }
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { openDocument, saveDocument, addImage, updateImage } from '@giga-pdf/pdf-engine';
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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);

    if (operation === 'add') {
      const imageFileValidation = validateImageFile(formData.get('imageFile'));
      if (!imageFileValidation.ok) return imageFileValidation.response;
      const imageFile = imageFileValidation.file;
      const imageArrayBuffer = await imageFile.arrayBuffer();
      const imageData = new Uint8Array(imageArrayBuffer);
      await addImage(handle, pageNumber, element, imageData);
    } else {
      const oldBoundsRaw = formData.get('oldBounds') as string | null;
      if (!oldBoundsRaw) {
        return NextResponse.json(
          { success: false, error: 'oldBounds is required for update operation.' },
          { status: 400 },
        );
      }
      let oldBounds: Bounds;
      try {
        oldBounds = JSON.parse(oldBoundsRaw) as Bounds;
      } catch {
        return NextResponse.json(
          { success: false, error: 'oldBounds must be valid JSON.' },
          { status: 400 },
        );
      }

      // For update, a new image file is optional
      const imageFile = formData.get('imageFile');
      let imageData: Uint8Array | undefined;
      if (imageFile instanceof File) {
        imageData = new Uint8Array(await imageFile.arrayBuffer());
      }

      await updateImage(handle, pageNumber, oldBounds, element, imageData);
    }

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
