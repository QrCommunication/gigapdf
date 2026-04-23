/**
 * PDF Page Operations route
 *
 * POST /api/pdf/pages
 * Performs page-level operations (add, delete, move, rotate, copy, resize)
 * on a PDF document.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   operation  — One of: "add" | "delete" | "move" | "rotate" | "copy" | "resize" (required)
 *   params     — JSON object with operation-specific parameters (required)
 *
 * Operation params schemas:
 *   add:    { afterPage?: number, width?: number, height?: number }
 *   delete: { pageNumber: number }
 *   move:   { fromPage: number, toPage: number }
 *   rotate: { pageNumber: number, degrees: 90 | 180 | 270 }
 *   copy:   { pageNumber: number, insertAfter: number }
 *   resize: { pageNumber: number, width: number, height: number }
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import {
  openDocument,
  saveDocument,
  addPage,
  deletePage,
  movePage,
  rotatePage,
  copyPage,
  resizePage,
  extractPages,
} from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

type Operation = 'add' | 'delete' | 'move' | 'rotate' | 'copy' | 'resize' | 'extract';

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const operation = formData.get('operation') as Operation | null;
    const validOperations: Operation[] = [
      'add',
      'delete',
      'move',
      'rotate',
      'copy',
      'resize',
      'extract',
    ];
    if (!operation || !validOperations.includes(operation)) {
      return NextResponse.json(
        {
          success: false,
          error: `Missing or invalid field: operation. Must be one of: ${validOperations.join(', ')}.`,
        },
        { status: 400 },
      );
    }

    const paramsRaw = formData.get('params') as string | null;
    if (!paramsRaw) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: params (JSON)' },
        { status: 400 },
      );
    }

    let params: Record<string, unknown>;
    try {
      params = JSON.parse(paramsRaw) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { success: false, error: 'params must be valid JSON.' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);

    // Operations mutate `handle` in place except `extract`, which produces a
    // fresh document. `resultHandle` tracks which one we save at the end.
    let resultHandle = handle;

    switch (operation) {
      case 'add': {
        const afterPage = params.afterPage as number | undefined;
        addPage(
          handle,
          afterPage !== undefined ? afterPage + 1 : 1,
          params.width as number | undefined,
          params.height as number | undefined,
        );
        break;
      }
      case 'delete': {
        if (typeof params.pageNumber !== 'number') {
          return NextResponse.json(
            { success: false, error: 'delete requires params.pageNumber (number).' },
            { status: 400 },
          );
        }
        deletePage(handle, params.pageNumber as number);
        break;
      }
      case 'move': {
        if (typeof params.fromPage !== 'number' || typeof params.toPage !== 'number') {
          return NextResponse.json(
            { success: false, error: 'move requires params.fromPage and params.toPage (numbers).' },
            { status: 400 },
          );
        }
        await movePage(handle, params.fromPage as number, params.toPage as number);
        break;
      }
      case 'rotate': {
        const allowedDegrees = [90, 180, 270];
        if (
          typeof params.pageNumber !== 'number' ||
          !allowedDegrees.includes(params.degrees as number)
        ) {
          return NextResponse.json(
            {
              success: false,
              error: 'rotate requires params.pageNumber and params.degrees (90 | 180 | 270).',
            },
            { status: 400 },
          );
        }
        rotatePage(handle, params.pageNumber as number, params.degrees as 90 | 180 | 270);
        break;
      }
      case 'copy': {
        if (typeof params.pageNumber !== 'number' || typeof params.insertAfter !== 'number') {
          return NextResponse.json(
            {
              success: false,
              error: 'copy requires params.pageNumber and params.insertAfter (numbers).',
            },
            { status: 400 },
          );
        }
        await copyPage(handle, params.pageNumber as number, undefined, params.insertAfter as number);
        break;
      }
      case 'resize': {
        if (
          typeof params.pageNumber !== 'number' ||
          typeof params.width !== 'number' ||
          typeof params.height !== 'number'
        ) {
          return NextResponse.json(
            {
              success: false,
              error: 'resize requires params.pageNumber, params.width, and params.height (numbers).',
            },
            { status: 400 },
          );
        }
        resizePage(
          handle,
          params.pageNumber as number,
          params.width as number,
          params.height as number,
        );
        break;
      }
      case 'extract': {
        const pageNumbers = params.pageNumbers;
        if (
          !Array.isArray(pageNumbers) ||
          pageNumbers.length === 0 ||
          pageNumbers.some((n) => typeof n !== 'number' || !Number.isInteger(n))
        ) {
          return NextResponse.json(
            {
              success: false,
              error: 'extract requires params.pageNumbers (non-empty integer array).',
            },
            { status: 400 },
          );
        }
        resultHandle = await extractPages(handle, pageNumbers as number[]);
        break;
      }
    }

    const savedBytes = await saveDocument(resultHandle);

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

    serverLogger.error('api.pdf.pages', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to perform page operation.' },
      { status: 500 },
    );
  }
}
