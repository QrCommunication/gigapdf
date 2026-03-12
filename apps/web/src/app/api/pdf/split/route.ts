/**
 * PDF Split route
 *
 * POST /api/pdf/split
 * Splits a PDF into multiple parts at specified page boundaries.
 *
 * Request body (JSON):
 * {
 *   file        — base64-encoded PDF string  — OR —
 * }
 *
 * Form fields (multipart/form-data):
 *   file          — PDF file (required)
 *   splitPoints   — JSON array of page numbers where splits occur, e.g. "[5,10]"
 *                   (mutually exclusive with ranges)
 *   ranges        — JSON array of page-range strings, e.g. ["1-5","6-10","11-20"]
 *                   (mutually exclusive with splitPoints)
 *   outputNames   — JSON array of output file names (optional)
 *
 * Returns JSON with an array of base64-encoded PDF parts:
 * {
 *   success: true,
 *   data: {
 *     parts: [
 *       { filename: "part1.pdf", pageRange: "1-5", pageCount: 5, data: "<base64>" },
 *       ...
 *     ]
 *   }
 * }
 */

import { NextResponse } from 'next/server';
import { splitAt, splitPDF, parsePageRange } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import type { PageRange } from '@giga-pdf/pdf-engine';

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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const splitPointsRaw = formData.get('splitPoints') as string | null;
    const rangesRaw = formData.get('ranges') as string | null;
    const outputNamesRaw = formData.get('outputNames') as string | null;

    if (!splitPointsRaw && !rangesRaw) {
      return NextResponse.json(
        { success: false, error: 'Provide either splitPoints or ranges.' },
        { status: 400 },
      );
    }

    let outputNames: string[] | undefined;
    if (outputNamesRaw) {
      try {
        outputNames = JSON.parse(outputNamesRaw) as string[];
      } catch {
        return NextResponse.json(
          { success: false, error: 'outputNames must be a valid JSON array of strings.' },
          { status: 400 },
        );
      }
    }

    let parts: Uint8Array[];

    if (splitPointsRaw) {
      let splitPoints: number[];
      try {
        splitPoints = JSON.parse(splitPointsRaw) as number[];
      } catch {
        return NextResponse.json(
          { success: false, error: 'splitPoints must be a valid JSON array of integers.' },
          { status: 400 },
        );
      }
      if (!Array.isArray(splitPoints) || splitPoints.some((p) => typeof p !== 'number')) {
        return NextResponse.json(
          { success: false, error: 'splitPoints must be an array of integers.' },
          { status: 400 },
        );
      }
      parts = await splitAt(buffer, splitPoints);
    } else {
      // Parse range strings into PageRange objects.
      // We need the page count to validate, so we parse leniently first.
      let rangeStrings: string[];
      try {
        rangeStrings = JSON.parse(rangesRaw!) as string[];
      } catch {
        return NextResponse.json(
          { success: false, error: 'ranges must be a valid JSON array of page-range strings.' },
          { status: 400 },
        );
      }
      if (!Array.isArray(rangeStrings) || rangeStrings.some((r) => typeof r !== 'string')) {
        return NextResponse.json(
          { success: false, error: 'ranges must be an array of page-range strings (e.g. ["1-5","6-10"]).' },
          { status: 400 },
        );
      }
      // Use a high sentinel page count for parsing; splitPDF will validate against actual count
      const MAX_PAGES = 100000;
      let pageRanges: PageRange[];
      try {
        pageRanges = rangeStrings.flatMap((r) => parsePageRange(r, MAX_PAGES));
      } catch (parseError) {
        return NextResponse.json(
          { success: false, error: `Invalid page range: ${parseError instanceof Error ? parseError.message : String(parseError)}` },
          { status: 400 },
        );
      }
      parts = await splitPDF(buffer, pageRanges);
    }

    const baseName = file.name.endsWith('.pdf')
      ? file.name.slice(0, -4)
      : file.name;

    const result = parts.map((partBytes, i) => {
      const filename = outputNames?.[i] ?? `${baseName}_part${i + 1}.pdf`;
      return {
        filename,
        pageCount: null, // Page count is not cheaply available without re-parsing
        data: Buffer.from(partBytes).toString('base64'),
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        originalFilename: file.name,
        partsCount: parts.length,
        parts: result,
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

    console.error('[api/pdf/split]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to split PDF document.' },
      { status: 500 },
    );
  }
}
