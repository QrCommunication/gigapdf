/**
 * PDF → Images route.
 *
 * POST /api/pdf/to-image
 * Rasterises EVERY page of a PDF to a PNG image and returns them as a single ZIP
 * archive (`page-001.png`, `page-002.png`, …, zero-padded so entries sort).
 *
 * Form fields (multipart/form-data):
 *   file   — PDF file (required)
 *   scale  — Render scale factor (default 2; 1 ≈ 72 DPI, 2 ≈ 144 DPI). Clamped
 *            to [0.1, 6] to bound output size.
 *
 * Output format: ZIP (application/zip). `fflate` is a dependency of apps/web, so
 * a ZIP of PNGs is always produced — one round-trip download for the whole
 * document, rather than a base64 JSON blob (which would inflate the payload ~33%
 * and force the client to reassemble files). Entries are STORE-d (level 0): PNG
 * is already compressed, so re-deflating only burns CPU.
 *
 * Returns:
 *   200 — application/zip binary (Content-Disposition attachment)
 *
 * Errors:
 *   400 — invalid/missing PDF, or a non-positive / out-of-range scale
 *   413 — file exceeds the size cap (handled by validatePdfFile)
 *   422 — PDF is corrupted
 *   500 — unexpected internal error (no stack trace exposed)
 */

import { NextResponse } from 'next/server';
import { openDocument, closeDocument, renderPage } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
import type { PDFDocumentHandle } from '@giga-pdf/pdf-engine';
import { zipSync, type Zippable } from 'fflate';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.1;
const MAX_SCALE = 6;

/**
 * Copy bytes into a freshly-allocated `ArrayBuffer`-backed view so the result is
 * a `Uint8Array<ArrayBuffer>` — usable as an `fflate` `Zippable` value (the
 * engine / fflate otherwise return the looser `Uint8Array<ArrayBufferLike>`).
 */
function freshCopy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/** Zero-pad a 1-based page number so zip entries sort naturally (page-001.png). */
function pageEntryName(pageNumber: number, total: number): string {
  const width = String(total).length;
  return `page-${String(pageNumber).padStart(width, '0')}.png`;
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  let handle: PDFDocumentHandle | null = null;
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Request must be multipart/form-data.' },
        { status: 400 },
      );
    }

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    // Parse and clamp the scale (default when absent; reject nonsense values).
    const scaleRaw = formData.get('scale');
    let scale = DEFAULT_SCALE;
    if (scaleRaw !== null) {
      scale = Number(scaleRaw);
      if (!Number.isFinite(scale) || scale <= 0) {
        return NextResponse.json(
          { success: false, error: 'scale must be a positive number.' },
          { status: 400 },
        );
      }
      scale = Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Open once to read the page count; render every page to PNG.
    handle = await openDocument(buffer);
    const total = handle.pageCount;

    const entries: Zippable = {};
    for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
      const png = await renderPage(buffer, pageNumber, { scale, format: 'png' });
      entries[pageEntryName(pageNumber, total)] = freshCopy(png);
    }

    // STORE (level 0): PNG pages are already compressed.
    const zipped = freshCopy(zipSync(entries, { level: 0 }));

    const baseName = file.name.replace(/\.pdf$/i, '') || 'pages';
    const outputName = `${baseName}-images.zip`;

    serverLogger.info('[api/pdf/to-image] Rasterised all pages', {
      userId: authResult.context.userId,
      pageCount: total,
      scale,
      outputBytes: zipped.byteLength,
    });

    // Buffer.from is required: Next.js rejects Uint8Array<ArrayBufferLike> as BodyInit.
    return new Response(Buffer.from(zipped), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': sanitizeContentDisposition(outputName),
        'Content-Length': String(zipped.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('[api/pdf/to-image] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to convert the PDF to images.' },
      { status: 500 },
    );
  } finally {
    if (handle) closeDocument(handle);
  }
}
