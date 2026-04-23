/**
 * PDF Shape Element route
 *
 * POST /api/pdf/shape
 * Draws a shape element (rectangle, ellipse, line, polygon, etc.) onto a PDF page.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   pageNumber — 1-based page number (required)
 *   element    — JSON ShapeElement object (required)
 *
 * ShapeElement schema (subset of @giga-pdf/types):
 * {
 *   shapeType: "rectangle" | "ellipse" | "line" | "triangle" | "polygon" | "arrow",
 *   bounds: { x, y, width, height },
 *   style: {
 *     fillColor: "#rrggbb" | null,
 *     strokeColor: "#rrggbb" | null,
 *     strokeWidth: number,
 *     strokeDashArray: number[],
 *     fillOpacity: number
 *   },
 *   points: [{ x, y }, ...]   // used by polygon / line
 * }
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { openDocument, saveDocument, addShape } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import type { ShapeElement } from '@giga-pdf/types';
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
        { success: false, error: 'Missing required field: element (JSON ShapeElement).' },
        { status: 400 },
      );
    }

    let element: ShapeElement;
    try {
      element = JSON.parse(elementRaw) as ShapeElement;
    } catch {
      return NextResponse.json(
        { success: false, error: 'element must be valid JSON.' },
        { status: 400 },
      );
    }

    const validShapeTypes = ['rectangle', 'ellipse', 'line', 'triangle', 'polygon', 'arrow'];
    if (!validShapeTypes.includes(element.shapeType)) {
      return NextResponse.json(
        {
          success: false,
          error: `element.shapeType must be one of: ${validShapeTypes.join(', ')}.`,
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);

    addShape(handle, pageNumber, element);

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

    console.error('[api/pdf/shape]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to add shape element.' },
      { status: 500 },
    );
  }
}
