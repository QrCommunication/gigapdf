/**
 * PDF Preview / Thumbnail route
 *
 * POST /api/pdf/preview
 * Renders one or more pages of a PDF as raster images.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   mode       — "page" | "thumbnail" | "all" (default: "page")
 *   pageNumber — 1-based page number (required for "page" and "thumbnail")
 *   dpi        — Render DPI (default 150, max 300)
 *   scale      — Alternative to dpi: explicit scale factor
 *   format     — "png" | "jpeg" | "webp" (default: "jpeg")
 *   quality    — 1-100, for jpeg/webp (default 85)
 *   maxWidth   — Max thumbnail width in px (thumbnail mode)
 *   maxHeight  — Max thumbnail height in px (thumbnail mode)
 *
 * Returns:
 *   mode "page":      image/png | image/jpeg | image/webp binary
 *   mode "thumbnail": image/png | image/jpeg | image/webp binary
 *   mode "all":       JSON with base64-encoded thumbnails for every page
 */

import { NextResponse } from 'next/server';
import {
  renderPage,
  renderThumbnail,
  renderAllThumbnails,
} from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import type { PreviewFormat, ThumbnailOptions, RenderOptions } from '@giga-pdf/pdf-engine';

const CONTENT_TYPES: Record<PreviewFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

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

    const mode = (formData.get('mode') as string | null) ?? 'page';
    if (mode !== 'page' && mode !== 'thumbnail' && mode !== 'all') {
      return NextResponse.json(
        { success: false, error: 'mode must be "page", "thumbnail", or "all".' },
        { status: 400 },
      );
    }

    const format = ((formData.get('format') as string | null) ?? 'jpeg') as PreviewFormat;
    const validFormats: PreviewFormat[] = ['png', 'jpeg', 'webp'];
    if (!validFormats.includes(format)) {
      return NextResponse.json(
        { success: false, error: `format must be one of: ${validFormats.join(', ')}.` },
        { status: 400 },
      );
    }

    const quality = Number(formData.get('quality') ?? 85);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (mode === 'all') {
      const maxWidth = formData.get('maxWidth') ? Number(formData.get('maxWidth')) : undefined;
      const maxHeight = formData.get('maxHeight') ? Number(formData.get('maxHeight')) : undefined;

      const options: ThumbnailOptions = { format, quality, maxWidth, maxHeight };
      const thumbnailMap = await renderAllThumbnails(buffer, options);

      const base64Thumbnails = Array.from(thumbnailMap.entries()).map(([pageNum, thumb]) => ({
        pageNumber: pageNum,
        data: thumb.toString('base64'),
        mimeType: CONTENT_TYPES[format],
      }));

      return NextResponse.json({
        success: true,
        data: {
          format,
          count: thumbnailMap.size,
          thumbnails: base64Thumbnails,
        },
      });
    }

    // mode: "page" or "thumbnail"
    const pageNumberRaw = formData.get('pageNumber');
    const pageNumber = Number(pageNumberRaw);
    if (!pageNumberRaw || !Number.isInteger(pageNumber) || pageNumber < 1) {
      return NextResponse.json(
        { success: false, error: 'pageNumber must be a positive integer.' },
        { status: 400 },
      );
    }

    let imageBuffer: Buffer;

    if (mode === 'thumbnail') {
      const maxWidth = formData.get('maxWidth') ? Number(formData.get('maxWidth')) : undefined;
      const maxHeight = formData.get('maxHeight') ? Number(formData.get('maxHeight')) : undefined;
      const options: ThumbnailOptions = { format, quality, maxWidth, maxHeight };
      imageBuffer = await renderThumbnail(buffer, pageNumber, options);
    } else {
      // mode === 'page'
      const dpiRaw = formData.get('dpi');
      const scaleRaw = formData.get('scale');
      const options: RenderOptions = {
        format,
        quality,
        ...(scaleRaw ? { scale: Number(scaleRaw) } : { dpi: Number(dpiRaw ?? 150) }),
      };
      imageBuffer = await renderPage(buffer, pageNumber, options);
    }

    return new Response(new Uint8Array(imageBuffer), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES[format],
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': String(imageBuffer.byteLength),
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

    console.error('[api/pdf/preview]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to render PDF preview.' },
      { status: 500 },
    );
  }
}
