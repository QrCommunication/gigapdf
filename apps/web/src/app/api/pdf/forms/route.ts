/**
 * PDF Forms route
 *
 * GET  /api/pdf/forms?documentId=<base64pdf>
 *   Not practical for binary data — use POST with action=get instead.
 *
 * POST /api/pdf/forms
 * Read form fields or fill/create form fields in a PDF document.
 *
 * Form fields (multipart/form-data):
 *   file     — PDF file (required)
 *   action   — "get" | "fill" | "create" (required)
 *   values   — JSON object { fieldName: value } (required for "fill")
 *   field    — JSON CreateFormFieldRequest (required for "create")
 *   pageNumber — 1-based page number (required for "create")
 *
 * For "get":
 *   Returns JSON list of form fields with metadata.
 *
 * For "fill":
 *   Fills the specified fields and returns the modified PDF as application/pdf.
 *
 * For "create":
 *   Adds a new form field and returns the modified PDF as application/pdf.
 */

import { NextResponse } from 'next/server';
import {
  openDocument,
  saveDocument,
  getFormFields,
  fillForm,
  addFormField,
} from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import type { FormFieldElement } from '@giga-pdf/types';
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

    const action = formData.get('action') as string | null;
    if (action !== 'get' && action !== 'fill' && action !== 'create') {
      return NextResponse.json(
        { success: false, error: 'action must be "get", "fill", or "create".' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (action === 'get') {
      const fields = await getFormFields(buffer);
      const filled = fields.filter(
        (f: { value: string | boolean | string[] }) => f.value !== '' && f.value !== false && !(Array.isArray(f.value) && f.value.length === 0),
      );
      return NextResponse.json({
        success: true,
        data: {
          fields,
          totalFields: fields.length,
          filledFields: filled.length,
        },
      });
    }

    if (action === 'fill') {
      const valuesRaw = formData.get('values') as string | null;
      if (!valuesRaw) {
        return NextResponse.json(
          { success: false, error: 'values (JSON) is required for fill action.' },
          { status: 400 },
        );
      }

      let values: Record<string, string | boolean | string[]>;
      try {
        values = JSON.parse(valuesRaw) as Record<string, string | boolean | string[]>;
      } catch {
        return NextResponse.json(
          { success: false, error: 'values must be valid JSON.' },
          { status: 400 },
        );
      }

      const { buffer: filledBuffer, results } = await fillForm(buffer, values);

      const failedCount = results.filter((r: { success: boolean }) => !r.success).length;
      const filledCount = results.filter((r: { success: boolean }) => r.success).length;

      // Return results metadata in response headers and modified PDF as body
      const headers = new Headers({
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(filledBuffer.byteLength),
        'X-Fill-Results': JSON.stringify({ filledCount, failedCount }),
      });

      return new Response(new Uint8Array(filledBuffer), { status: 200, headers });
    }

    // action === 'create'
    const pageNumberRaw = formData.get('pageNumber');
    const pageNumber = Number(pageNumberRaw);
    if (!pageNumberRaw || !Number.isInteger(pageNumber) || pageNumber < 1) {
      return NextResponse.json(
        { success: false, error: 'pageNumber must be a positive integer.' },
        { status: 400 },
      );
    }

    const fieldRaw = formData.get('field') as string | null;
    if (!fieldRaw) {
      return NextResponse.json(
        { success: false, error: 'field (JSON) is required for create action.' },
        { status: 400 },
      );
    }

    let fieldDef: FormFieldElement;
    try {
      fieldDef = JSON.parse(fieldRaw) as FormFieldElement;
    } catch {
      return NextResponse.json(
        { success: false, error: 'field must be valid JSON.' },
        { status: 400 },
      );
    }

    if (!fieldDef.fieldType || !fieldDef.fieldName || !fieldDef.bounds) {
      return NextResponse.json(
        { success: false, error: 'field must include fieldType, fieldName, and bounds.' },
        { status: 400 },
      );
    }

    const handle = await openDocument(buffer);
    addFormField(handle, pageNumber, fieldDef);
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

    serverLogger.error('api.pdf.forms', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to process form operation.' },
      { status: 500 },
    );
  }
}
