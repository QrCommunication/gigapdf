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
 *   action   — "get" | "fill" | "create" | "addSignatureField" |
 *              "setFieldScript" | "setCalculationOrder" | "removeField" |
 *              "regenerateFieldAppearance" (required)
 *   values   — JSON object { fieldName: value } (required for "fill")
 *   field    — JSON CreateFormFieldRequest (required for "create")
 *   pageNumber — 1-based page number (required for "create"/"addSignatureField")
 *   name     — field name (required for addSignatureField / setFieldScript /
 *              removeField / regenerateFieldAppearance)
 *   rect     — JSON [x0,y0,x1,y1] PDF user space (required for "addSignatureField")
 *   style    — JSON FieldStyle (optional for "addSignatureField")
 *   trigger  — "keystroke" | "format" | "validate" | "calculate"
 *              (required for "setFieldScript")
 *   js       — field-level JavaScript (required for "setFieldScript")
 *   names    — JSON string[] of field names (required for "setCalculationOrder")
 *
 * For "get":
 *   Returns JSON list of form fields with metadata.
 *
 * For "fill":
 *   Fills the specified fields and returns the modified PDF as application/pdf.
 *
 * For "create" / "addSignatureField" / "setFieldScript" / "setCalculationOrder" /
 * "removeField" / "regenerateFieldAppearance":
 *   Mutates the AcroForm and returns the modified PDF as application/pdf. These
 *   field operations call the live GigaPdfDoc (`handle._doc`) directly, mirroring
 *   the page-labels route. A missing target field yields 404; an operation the
 *   engine cannot apply yields 422.
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
import type { FieldStyle } from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

// ── Actions ───────────────────────────────────────────────────────────────────

/** Every POST action this route accepts. */
type FormAction =
  | 'get'
  | 'fill'
  | 'create'
  | 'addSignatureField'
  | 'setFieldScript'
  | 'setCalculationOrder'
  | 'removeField'
  | 'regenerateFieldAppearance';

/**
 * AcroForm field-mutation actions — handled by {@link applyFieldMutation} via the
 * live `GigaPdfDoc` (`handle._doc`), distinct from get/fill/create above.
 */
const FIELD_MUTATION_ACTIONS = new Set<FormAction>([
  'addSignatureField',
  'setFieldScript',
  'setCalculationOrder',
  'removeField',
  'regenerateFieldAppearance',
]);

const FORM_ACTIONS = new Set<FormAction>([
  'get',
  'fill',
  'create',
  ...FIELD_MUTATION_ACTIONS,
]);

/** Field-level JavaScript triggers accepted by `GigaPdfDoc.setFieldScript`. */
const FIELD_SCRIPT_TRIGGERS = new Set([
  'keystroke',
  'format',
  'validate',
  'calculate',
]);
type FieldScriptTrigger = 'keystroke' | 'format' | 'validate' | 'calculate';

// A pathological calculation order (thousands of names) is rejected up front so a
// malicious payload cannot exhaust the engine.
const MAX_CALC_ORDER_NAMES = 5000;
// FieldStyle colours are packed `0xRRGGBB`.
const RGB_MAX = 0xffffff;

type Rect = [number, number, number, number];

function jsonError(message: string, status = 400): Response {
  return NextResponse.json({ success: false, error: message }, { status });
}

function pdfResponse(bytes: Uint8Array, file: File): Response {
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': sanitizeContentDisposition(file.name),
      'Content-Length': String(bytes.byteLength),
    },
  });
}

/** Read a required, non-empty `name` field from the form payload. */
function requireName(formData: FormData): string | { error: string } {
  const name = formData.get('name');
  if (typeof name !== 'string' || name.length === 0) {
    return { error: 'name is required and must be a non-empty string.' };
  }
  return name;
}

/** Parse a `[x0, y0, x1, y1]` widget rect (PDF user space) from untrusted JSON. */
function parseRect(raw: string | null): Rect | { error: string } {
  if (raw === null) return { error: 'rect (JSON [x0,y0,x1,y1]) is required.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'rect must be valid JSON.' };
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) {
    return { error: 'rect must be a JSON array of 4 numbers [x0,y0,x1,y1].' };
  }
  for (const n of parsed) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return { error: 'rect values must be finite numbers.' };
    }
  }
  // Length 4 and all-finite verified above; the tuple cast is sound.
  const rect = parsed as Rect;
  if (rect[2] <= rect[0] || rect[3] <= rect[1]) {
    return { error: 'rect must satisfy x1 > x0 and y1 > y0.' };
  }
  return rect;
}

/** Parse an optional {@link FieldStyle} from untrusted JSON (absent → undefined). */
function parseStyle(
  raw: string | null,
): FieldStyle | undefined | { error: string } {
  if (raw === null || raw === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'style must be valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'style must be a JSON object.' };
  }
  const src = parsed as Record<string, unknown>;
  const style: FieldStyle = {};

  for (const key of ['fontSize', 'borderWidth'] as const) {
    const v = src[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return { error: `style.${key} must be a non-negative number.` };
    }
    style[key] = v;
  }

  if (src.color !== undefined) {
    const v = src.color;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > RGB_MAX) {
      return { error: 'style.color must be an integer 0x000000–0xFFFFFF.' };
    }
    style.color = v;
  }

  for (const key of ['border', 'background'] as const) {
    const v = src[key];
    if (v === undefined) continue;
    if (v === null) {
      style[key] = null;
    } else if (
      typeof v === 'number' &&
      Number.isInteger(v) &&
      v >= 0 &&
      v <= RGB_MAX
    ) {
      style[key] = v;
    } else {
      return { error: `style.${key} must be an integer 0x000000–0xFFFFFF or null.` };
    }
  }

  return style;
}

/** Parse a calculation-order `string[]` of field names from untrusted JSON. */
function parseNames(raw: string | null): string[] | { error: string } {
  if (raw === null) return { error: 'names (JSON string[]) is required.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'names must be valid JSON.' };
  }
  if (!Array.isArray(parsed)) {
    return { error: 'names must be a JSON array of strings.' };
  }
  if (parsed.length > MAX_CALC_ORDER_NAMES) {
    return { error: `names must contain at most ${MAX_CALC_ORDER_NAMES} entries.` };
  }
  const names: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const n = parsed[i];
    if (typeof n !== 'string' || n.length === 0) {
      return { error: `names[${i}] must be a non-empty string.` };
    }
    names.push(n);
  }
  return names;
}

/**
 * Apply one AcroForm field-mutation action to the live document and return the
 * modified PDF (200 application/pdf) — or a 4xx JSON error when validation fails
 * or the engine reports the operation could not be applied (404 unknown field,
 * 422 otherwise). The caller owns opening the document; this never closes it.
 */
async function applyFieldMutation(
  action: FormAction,
  formData: FormData,
  handle: Awaited<ReturnType<typeof openDocument>>,
  file: File,
): Promise<Response> {
  const doc = handle._doc;

  switch (action) {
    case 'addSignatureField': {
      const name = requireName(formData);
      if (typeof name !== 'string') return jsonError(name.error);

      const pageRaw = formData.get('pageNumber');
      const pageNumber = Number(pageRaw);
      if (
        !pageRaw ||
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > doc.pageCount()
      ) {
        return jsonError(
          `pageNumber must be an integer between 1 and ${doc.pageCount()}.`,
        );
      }

      const rect = parseRect(formData.get('rect') as string | null);
      if ('error' in rect) return jsonError(rect.error);

      const style = parseStyle(formData.get('style') as string | null);
      if (style !== undefined && 'error' in style) return jsonError(style.error);

      const ok = doc.addSignatureField(
        pageNumber,
        name,
        rect,
        style ? { style } : undefined,
      );
      if (!ok) return jsonError('Could not add the signature field.', 422);
      break;
    }

    case 'setFieldScript': {
      const name = requireName(formData);
      if (typeof name !== 'string') return jsonError(name.error);

      const trigger = formData.get('trigger');
      if (typeof trigger !== 'string' || !FIELD_SCRIPT_TRIGGERS.has(trigger)) {
        return jsonError(
          `trigger must be one of: ${[...FIELD_SCRIPT_TRIGGERS].join(', ')}.`,
        );
      }

      const js = formData.get('js');
      if (typeof js !== 'string' || js.length === 0) {
        return jsonError('js is required and must be a non-empty string.');
      }

      const ok = doc.setFieldScript(name, trigger as FieldScriptTrigger, js);
      if (!ok) return jsonError(`No form field named "${name}".`, 404);
      break;
    }

    case 'setCalculationOrder': {
      const names = parseNames(formData.get('names') as string | null);
      if ('error' in names) return jsonError(names.error);

      const ok = doc.setCalculationOrder(names);
      if (!ok) return jsonError('Could not set the calculation order.', 422);
      break;
    }

    case 'removeField': {
      const name = requireName(formData);
      if (typeof name !== 'string') return jsonError(name.error);

      const ok = doc.removeField(name);
      if (!ok) return jsonError(`No form field named "${name}".`, 404);
      break;
    }

    case 'regenerateFieldAppearance': {
      const name = requireName(formData);
      if (typeof name !== 'string') return jsonError(name.error);

      const ok = doc.regenerateFieldAppearance(name);
      if (!ok) {
        return jsonError(
          `Could not regenerate appearance for "${name}" (unknown field or non-regenerable kind).`,
          422,
        );
      }
      break;
    }

    default:
      // get / fill / create are handled before this dispatcher runs.
      return jsonError('Unsupported field operation.', 400);
  }

  const savedBytes = await saveDocument(handle);
  return pdfResponse(savedBytes, file);
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const actionRaw = formData.get('action') as string | null;
    if (!actionRaw || !FORM_ACTIONS.has(actionRaw as FormAction)) {
      return NextResponse.json(
        {
          success: false,
          error: `action must be one of: ${[...FORM_ACTIONS].join(', ')}.`,
        },
        { status: 400 },
      );
    }
    const action = actionRaw as FormAction;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // AcroForm field-mutation actions operate on the live GigaPdfDoc.
    if (FIELD_MUTATION_ACTIONS.has(action)) {
      const handle = await openDocument(buffer);
      return applyFieldMutation(action, formData, handle, file);
    }

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
