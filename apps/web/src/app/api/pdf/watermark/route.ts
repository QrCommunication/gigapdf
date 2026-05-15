/**
 * PDF Watermark route.
 *
 * POST /api/pdf/watermark
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   text       — Watermark text (required, non-empty)
 *   position   — "center-diagonal" | "top-left" | "top-right" |
 *                "bottom-left" | "bottom-right" | "header" | "footer" |
 *                "custom" (default: center-diagonal)
 *   pages      — JSON array of 1-based page numbers (optional, defaults to all)
 *   fontSize   — Number (optional, auto-computed otherwise)
 *   color      — JSON array [r, g, b] in [0,1] (optional)
 *   opacity    — Number in [0, 1] (optional, default 0.25)
 *   custom     — JSON {x, y, rotation} when position === "custom"
 *
 * Returns the watermarked PDF as application/pdf.
 */

import { NextResponse } from 'next/server';
import { addWatermark } from '@giga-pdf/pdf-engine';
import type { WatermarkPosition } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

const VALID_POSITIONS: WatermarkPosition[] = [
  'center-diagonal',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'header',
  'footer',
  'custom',
];

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const text = (formData.get('text') as string | null)?.trim();
    if (!text) {
      return NextResponse.json(
        { success: false, error: 'text is required and must be non-empty.' },
        { status: 400 },
      );
    }

    const position =
      ((formData.get('position') as string | null) ?? 'center-diagonal') as WatermarkPosition;
    if (!VALID_POSITIONS.includes(position)) {
      return NextResponse.json(
        {
          success: false,
          error: `position must be one of: ${VALID_POSITIONS.join(', ')}.`,
        },
        { status: 400 },
      );
    }

    let pages: number[] | undefined;
    const pagesRaw = formData.get('pages') as string | null;
    if (pagesRaw) {
      try {
        const parsed = JSON.parse(pagesRaw);
        if (Array.isArray(parsed) && parsed.every((p) => Number.isInteger(p) && p >= 1)) {
          pages = parsed;
        } else {
          throw new Error('Invalid pages');
        }
      } catch {
        return NextResponse.json(
          { success: false, error: 'pages must be a JSON array of positive integers.' },
          { status: 400 },
        );
      }
    }

    const fontSizeRaw = formData.get('fontSize') as string | null;
    const fontSize = fontSizeRaw ? Number(fontSizeRaw) : undefined;
    if (fontSize !== undefined && (Number.isNaN(fontSize) || fontSize < 1 || fontSize > 500)) {
      return NextResponse.json(
        { success: false, error: 'fontSize must be a number between 1 and 500.' },
        { status: 400 },
      );
    }

    let color: [number, number, number] | undefined;
    const colorRaw = formData.get('color') as string | null;
    if (colorRaw) {
      try {
        const parsed = JSON.parse(colorRaw);
        if (
          Array.isArray(parsed) &&
          parsed.length === 3 &&
          parsed.every((c) => typeof c === 'number' && c >= 0 && c <= 1)
        ) {
          color = parsed as [number, number, number];
        } else {
          throw new Error('Invalid color');
        }
      } catch {
        return NextResponse.json(
          { success: false, error: 'color must be JSON array [r,g,b] in [0,1].' },
          { status: 400 },
        );
      }
    }

    const opacityRaw = formData.get('opacity') as string | null;
    const opacity = opacityRaw ? Number(opacityRaw) : undefined;
    if (opacity !== undefined && (Number.isNaN(opacity) || opacity < 0 || opacity > 1)) {
      return NextResponse.json(
        { success: false, error: 'opacity must be in [0, 1].' },
        { status: 400 },
      );
    }

    let custom: { x: number; y: number; rotation: number } | undefined;
    const customRaw = formData.get('custom') as string | null;
    if (customRaw) {
      try {
        const parsed = JSON.parse(customRaw);
        if (
          typeof parsed?.x === 'number' &&
          typeof parsed?.y === 'number' &&
          typeof parsed?.rotation === 'number'
        ) {
          custom = parsed;
        } else {
          throw new Error('Invalid custom');
        }
      } catch {
        return NextResponse.json(
          { success: false, error: 'custom must be JSON {x:number, y:number, rotation:number}.' },
          { status: 400 },
        );
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await addWatermark(new Uint8Array(arrayBuffer), {
      text,
      position,
      pages,
      fontSize,
      color,
      opacity,
      custom,
    });

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
    serverLogger.error('api.pdf.watermark', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to add watermark.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
