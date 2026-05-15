/**
 * PDF Apply Elements route
 *
 * POST /api/pdf/apply-elements
 * Applies an ordered list of element operations (add, update, delete) to a PDF
 * and returns the modified PDF binary.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   operations — JSON string of ElementOperation[] (required)
 *
 * ElementOperation schema:
 * {
 *   action: 'add' | 'update' | 'delete',
 *   pageNumber: number,           // 1-based
 *   element: Record<string, unknown>,
 *   oldBounds?: { x, y, width, height }  // required for 'update'; used for 'delete'
 * }
 *
 * Supported element types: text, image, shape, annotation, form_field
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import {
  openDocument,
  saveDocument,
  addText,
  updateText,
  addImage,
  updateImage,
  addShape,
  addAnnotation,
  addFormField,
  deleteElementArea,
  setFontCacheForHandle,
  applyRedactions,
  webToPdf,
} from '@giga-pdf/pdf-engine';
import type { RedactionTarget } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import { createFontCacheDbAdapter } from '@/lib/font-cache-db';
import type { TextElement, ImageElement, ShapeElement, AnnotationElement, FormFieldElement, Bounds } from '@giga-pdf/types';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ElementOperation {
  action: 'add' | 'update' | 'delete';
  pageNumber: number;
  element: Record<string, unknown>;
  oldBounds?: { x: number; y: number; width: number; height: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Decode a base64 data URL to a Uint8Array using Node.js Buffer (server-side safe).
 */
function decodeDataUrl(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex !== -1 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Extract image data from an element's source.dataUrl if present.
 */
function extractImageData(element: Record<string, unknown>): Uint8Array | undefined {
  const source = element['source'] as Record<string, unknown> | undefined;
  if (!source) return undefined;
  const dataUrl = source['dataUrl'];
  if (typeof dataUrl !== 'string' || !dataUrl) return undefined;
  return decodeDataUrl(dataUrl);
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    // ── Validate file ──────────────────────────────────────────────────────────
    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    // ── Validate operations ────────────────────────────────────────────────────
    const operationsRaw = formData.get('operations') as string | null;
    if (!operationsRaw) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: operations (JSON ElementOperation[])' },
        { status: 400 },
      );
    }

    let operations: ElementOperation[];
    try {
      operations = JSON.parse(operationsRaw) as ElementOperation[];
    } catch {
      return NextResponse.json(
        { success: false, error: 'operations must be valid JSON.' },
        { status: 400 },
      );
    }

    if (!Array.isArray(operations)) {
      return NextResponse.json(
        { success: false, error: 'operations must be a JSON array.' },
        { status: 400 },
      );
    }

    // ── Open document ──────────────────────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);
    // Plug the Prisma-backed font cache so Type1/CFF→TTF conversions done
    // by fontforge inside the engine are memoised across requests. The
    // engine itself stays free of any DB import — it just sees a port.
    setFontCacheForHandle(handle, createFontCacheDbAdapter());

    // ── Collect redaction targets for the post-pass MuPDF redaction ───────────
    // Every update / delete operation describes an area of the original page
    // that must physically disappear from the content stream. The legacy
    // mask-rectangle approach in updateText only HIDES it, leaving the bytes
    // recoverable via copy-paste or re-flatten. We accumulate the PDF-space
    // bounds here and pass them to MuPDF in a single batch after the pdf-lib
    // operations complete.
    const redactionTargets: RedactionTarget[] = [];

    /** Convert web bounds → PDF user-space bounds for the given page. */
    const toPdfBounds = (
      pageNumber: number,
      webBounds: { x: number; y: number; width: number; height: number },
    ): RedactionTarget['bounds'] => {
      const page = handle._pdfDoc.getPage(pageNumber - 1);
      const pageH = page.getHeight();
      const pageW = page.getWidth();
      const rotation = page.getRotation().angle as 0 | 90 | 180 | 270;
      return webToPdf(
        webBounds.x,
        webBounds.y,
        webBounds.width,
        webBounds.height,
        pageH,
        pageW,
        rotation,
      );
    };

    // ── Apply each operation in order ──────────────────────────────────────────
    for (let opIndex = 0; opIndex < operations.length; opIndex++) {
      const op = operations[opIndex]!;
      const { action, pageNumber, element, oldBounds } = op;
      const elementType = element['type'] as string | undefined;

      try {
      if (action === 'add') {
        switch (elementType) {
          case 'text': {
            await addText(handle, pageNumber, element as unknown as TextElement);
            break;
          }
          case 'image': {
            const imageData = extractImageData(element);
            if (imageData) {
              await addImage(handle, pageNumber, element as unknown as ImageElement, imageData);
            }
            break;
          }
          case 'shape': {
            addShape(handle, pageNumber, element as unknown as ShapeElement);
            break;
          }
          case 'annotation': {
            await addAnnotation(handle, pageNumber, element as unknown as AnnotationElement);
            break;
          }
          case 'form_field': {
            addFormField(handle, pageNumber, element as unknown as FormFieldElement);
            break;
          }
          default:
            break;
        }
      } else if (action === 'update') {
        if (!oldBounds) {
          return NextResponse.json(
            {
              success: false,
              error: `oldBounds is required for update operations (element type: ${elementType ?? 'unknown'}).`,
            },
            { status: 400 },
          );
        }
        const bounds: Bounds = oldBounds;

        // Queue the original area for MuPDF redaction so the new render
        // doesn't sit on top of the still-existing original glyphs/image.
        redactionTargets.push({
          pageNumber,
          bounds: toPdfBounds(pageNumber, bounds),
        });

        switch (elementType) {
          case 'text': {
            await updateText(handle, pageNumber, bounds, element as unknown as TextElement);
            break;
          }
          case 'image': {
            const imageData = extractImageData(element);
            await updateImage(handle, pageNumber, bounds, element as unknown as ImageElement, imageData);
            break;
          }
          default: {
            // For shape, annotation, form_field: clear the old area then re-add.
            deleteElementArea(handle, pageNumber, bounds);
            switch (elementType) {
              case 'shape': {
                addShape(handle, pageNumber, element as unknown as ShapeElement);
                break;
              }
              case 'annotation': {
                await addAnnotation(handle, pageNumber, element as unknown as AnnotationElement);
                break;
              }
              case 'form_field': {
                addFormField(handle, pageNumber, element as unknown as FormFieldElement);
                break;
              }
              default:
                break;
            }
            break;
          }
        }
      } else if (action === 'delete') {
        const bounds = (element['bounds'] ?? oldBounds) as Bounds | undefined;
        if (bounds) {
          deleteElementArea(handle, pageNumber, bounds);
          redactionTargets.push({
            pageNumber,
            bounds: toPdfBounds(pageNumber, bounds),
          });
        }
      }
      } catch (opError) {
        const elementId = element['elementId'] ?? element['id'];
        const annotated = new Error(
          `apply-elements op[${opIndex}] failed (action=${action}, type=${elementType ?? 'unknown'}, page=${pageNumber}, elementId=${elementId ?? 'n/a'}): ${opError instanceof Error ? opError.message : String(opError)}`,
        );
        if (opError instanceof Error) (annotated as Error & { cause?: unknown }).cause = opError;
        throw annotated;
      }
    }

    // ── Save pdf-lib output ────────────────────────────────────────────────────
    const pdfLibBytes = await saveDocument(handle);

    // ── Post-pass: real redaction via MuPDF ────────────────────────────────────
    // Physically removes the original glyphs/images/line-art under each
    // update/delete area so the exported PDF contains the new content
    // only — no doublons hidden behind a white rectangle. Falls back to
    // the pdf-lib output if MuPDF errors out (degraded but functional).
    let finalBytes: Uint8Array = new Uint8Array(pdfLibBytes);
    if (redactionTargets.length > 0) {
      try {
        const result = await applyRedactions(finalBytes, redactionTargets);
        finalBytes = result.bytes;
      } catch (err) {
        serverLogger.warn('api.pdf.apply-elements: MuPDF redaction failed', {
          error: err instanceof Error ? err.message : String(err),
          targetCount: redactionTargets.length,
        });
      }
    }

    // Wrap in Buffer so TypeScript accepts it as BodyInit across lib targets
    // (Uint8Array<ArrayBufferLike> is rejected by Next.js' stricter
    // type-check while Buffer satisfies the BodyInit union).
    return new Response(Buffer.from(finalBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(finalBytes.byteLength),
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

    serverLogger.error('api.pdf.apply-elements', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to apply element operations.' },
      { status: 500 },
    );
  }
}
