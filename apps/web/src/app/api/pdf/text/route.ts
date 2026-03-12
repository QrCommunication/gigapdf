/**
 * PDF Text Element route
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
 * TextElement schema (subset of @giga-pdf/types):
 * {
 *   content: string,
 *   bounds: { x, y, width, height },
 *   style: { fontFamily, fontSize, color, opacity, lineHeight },
 *   transform: { rotation }
 * }
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { openDocument, saveDocument, addText, updateText } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import type { TextElement, Bounds } from '@giga-pdf/types';

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();

    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: file' },
        { status: 400 },
      );
    }

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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);

    if (operation === 'add') {
      await addText(handle, pageNumber, element);
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
      await updateText(handle, pageNumber, oldBounds, element);
    }

    const savedBytes = await saveDocument(handle);

    return new Response(savedBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file.name}"`,
        'Content-Length': String(savedBytes.byteLength),
      },
    });
  } catch (error) {
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

    console.error('[api/pdf/text]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to apply text operation.' },
      { status: 500 },
    );
  }
}
