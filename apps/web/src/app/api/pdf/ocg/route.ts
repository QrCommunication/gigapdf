/**
 * PDF OCG (Optional Content Group / "layers") mutation route
 *
 * POST /api/pdf/ocg
 * Toggles visibility/lock or removes native PDF OCG layers (by numeric OCG id)
 * and returns the modified PDF binary.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   operations — JSON string of OcgLayerOperation[] (required)
 *
 * OcgLayerOperation schema:
 * {
 *   action: 'visibility' | 'locked' | 'remove',
 *   ocgId: number,          // native OCG id (LayerObject.ocgId)
 *   value?: boolean         // target for visibility/locked; ignored for remove
 * }
 *
 * Implementation: delegates to `applyOcgOperations` (pdf-engine), a thin native
 * mutator that does NOT touch the element redact+add pipeline.
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { applyOcgOperations } from '@giga-pdf/pdf-engine';
import type { OcgLayerOperation } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

const VALID_ACTIONS = new Set(['visibility', 'locked', 'remove']);

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const operationsRaw = formData.get('operations') as string | null;
    if (!operationsRaw) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: operations (JSON OcgLayerOperation[])' },
        { status: 400 },
      );
    }

    let operations: OcgLayerOperation[];
    try {
      operations = JSON.parse(operationsRaw) as OcgLayerOperation[];
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

    // Validate each op (action enum + numeric ocgId) before opening the engine.
    for (const op of operations) {
      if (
        !op ||
        typeof op !== 'object' ||
        !VALID_ACTIONS.has((op as OcgLayerOperation).action) ||
        typeof (op as OcgLayerOperation).ocgId !== 'number'
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'Each operation needs an action (visibility|locked|remove) and a numeric ocgId.',
          },
          { status: 400 },
        );
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const inputBytes = new Uint8Array(arrayBuffer);

    const result = await applyOcgOperations(inputBytes, operations);

    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(result.bytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.ocg', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to apply OCG layer operations.' },
      { status: 500 },
    );
  }
}
