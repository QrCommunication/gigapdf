/**
 * PDF Annotations route
 *
 * POST /api/pdf/annotations
 * Adds an annotation (highlight, underline, strikeout, note, link) to a PDF page.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   pageNumber — 1-based page number (required)
 *   element    — JSON AnnotationElement object (required)
 *
 * AnnotationElement schema (subset of @giga-pdf/types):
 * {
 *   annotationType: "highlight" | "underline" | "strikeout" | "strikethrough"
 *                   | "note" | "link" | "squiggly",
 *   bounds: { x, y, width, height },
 *   content?: string,
 *   style: {
 *     color: "#rrggbb",
 *     opacity: number  // 0-1
 *   },
 *   // For link annotations:
 *   url?: string,
 *   targetPage?: number,
 *   targetPosition?: { x, y }
 * }
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { openDocument, saveDocument, addAnnotation } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import type { AnnotationElement } from '@giga-pdf/types';

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
        { success: false, error: 'Missing required field: element (JSON AnnotationElement).' },
        { status: 400 },
      );
    }

    let element: AnnotationElement;
    try {
      element = JSON.parse(elementRaw) as AnnotationElement;
    } catch {
      return NextResponse.json(
        { success: false, error: 'element must be valid JSON.' },
        { status: 400 },
      );
    }

    const validAnnotationTypes = [
      'highlight',
      'underline',
      'strikeout',
      'strikethrough',
      'note',
      'link',
      'squiggly',
    ];
    if (!validAnnotationTypes.includes(element.annotationType)) {
      return NextResponse.json(
        {
          success: false,
          error: `element.annotationType must be one of: ${validAnnotationTypes.join(', ')}.`,
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);

    await addAnnotation(handle, pageNumber, element);

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

    console.error('[api/pdf/annotations]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to add annotation.' },
      { status: 500 },
    );
  }
}
