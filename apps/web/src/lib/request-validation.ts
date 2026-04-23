/**
 * Request validation helpers for PDF API routes.
 *
 * @remarks
 * All helpers are server-only and enforce a unified 100 MB file size limit
 * across every `/api/pdf/*` route. Import `validatePdfFile` to replace
 * ad-hoc `instanceof File` checks in route handlers.
 */

import 'server-only';
import { NextResponse } from 'next/server';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Unified 100 MB cap enforced on every PDF upload (matches Python backend limit). */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

// ─── Types ────────────────────────────────────────────────────────────────────

/** Discriminated-union result returned by file validation helpers. */
export type FileValidationResult =
  | { ok: true; file: File }
  | { ok: false; response: Response };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validates a `File` extracted from `FormData`.
 *
 * Checks performed (in order):
 * 1. Value is present and is a `File` instance → 400
 * 2. File is not empty (size > 0) → 400
 * 3. File size ≤ `MAX_FILE_SIZE_BYTES` → 413
 * 4. MIME type is `application/pdf` (when `requireMimePdf` is true) → 415
 *
 * @param value - Raw value from `formData.get(fieldName)`.
 * @param options.requireMimePdf - When true, rejects files whose MIME type is
 *   not `application/pdf`. Defaults to false so callers that already perform
 *   extension-based checks are unaffected.
 * @returns `{ ok: true, file }` on success, or `{ ok: false, response }` with
 *   the appropriate error response ready to return from the route handler.
 *
 * @example
 * ```typescript
 * const v = validatePdfFile(formData.get('file'));
 * if (!v.ok) return v.response;
 * const buffer = Buffer.from(await v.file.arrayBuffer());
 * ```
 */
export function validatePdfFile(
  value: FormDataEntryValue | null,
  options: { requireMimePdf?: boolean } = {},
): FileValidationResult {
  if (!value || !(value instanceof File)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'File field missing or invalid.' },
        { status: 400 },
      ),
    };
  }

  if (value.size === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'File is empty.' },
        { status: 400 },
      ),
    };
  }

  if (value.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: `File exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB size limit.`,
        },
        { status: 413 },
      ),
    };
  }

  if (options.requireMimePdf && value.type && value.type !== 'application/pdf') {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Expected Content-Type application/pdf.' },
        { status: 415 },
      ),
    };
  }

  return { ok: true, file: value };
}

/**
 * Validates an image `File` (PNG / JPEG) extracted from `FormData`.
 *
 * Enforces the same 100 MB cap as `validatePdfFile`. Does NOT require a
 * specific MIME type because many clients omit it for image uploads.
 *
 * @param value - Raw value from `formData.get(fieldName)`.
 * @returns `{ ok: true, file }` or `{ ok: false, response }`.
 */
export function validateImageFile(
  value: FormDataEntryValue | null,
): FileValidationResult {
  if (!value || !(value instanceof File)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Image file field missing or invalid.' },
        { status: 400 },
      ),
    };
  }

  if (value.size === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Image file is empty.' },
        { status: 400 },
      ),
    };
  }

  if (value.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: `Image file exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB size limit.`,
        },
        { status: 413 },
      ),
    };
  }

  return { ok: true, file: value };
}
