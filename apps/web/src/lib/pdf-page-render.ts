/**
 * Server-side helper: render a single PDF page to PNG and report both the
 * rendered pixel dimensions and the source page geometry (PDF points + /Rotate),
 * so callers can map PDF-point bounding boxes onto the raster (#85 search
 * highlights).
 *
 * Wraps the pdf-engine public API (`engineRenderPages` for pixels,
 * `openDocument`/`getPageDimensions` for point geometry). Re-exports
 * `pdfBoxToImageRect` so the route imports a single module.
 */

import 'server-only';

import {
  engineRenderPages,
  pdfBoxToImageRect,
  PDFPageOutOfRangeError,
} from '@giga-pdf/pdf-engine';
import {
  openDocument,
  closeDocument,
  getPageDimensions,
} from '@giga-pdf/pdf-engine/engine';

export { pdfBoxToImageRect };

export interface RenderedPageWithDimensions {
  /** PNG bytes of the rendered page. */
  bytes: Uint8Array;
  /** Rendered image width in pixels (post-rotation). */
  imageWidth: number;
  /** Rendered image height in pixels (post-rotation). */
  imageHeight: number;
  /** Page width in PDF points (UNrotated MediaBox). */
  pageWidth: number;
  /** Page height in PDF points (UNrotated MediaBox). */
  pageHeight: number;
  /** Page /Rotate flag. */
  rotation: 0 | 90 | 180 | 270;
}

/**
 * Render `page` (1-based) of `pdfBytes` at `scale` and return the PNG plus the
 * pixel + point geometry needed to overlay highlights. Returns null when the
 * page is out of range.
 */
export async function renderPagesWithDimensions(
  pdfBytes: Uint8Array,
  { page, scale = 1.5 }: { page: number; scale?: number },
): Promise<RenderedPageWithDimensions | null> {
  // Point geometry + rotation from the engine page info.
  const handle = await openDocument(Buffer.from(pdfBytes));
  let dims: { width: number; height: number; rotation: 0 | 90 | 180 | 270 };
  try {
    dims = getPageDimensions(handle, page);
  } catch (err) {
    // Out-of-range page → null (caller maps to 400). Any other engine/parse
    // failure must propagate so it surfaces as a 500, not a misleading 400.
    if (err instanceof PDFPageOutOfRangeError) return null;
    throw err;
  } finally {
    closeDocument(handle);
  }

  // Pixel raster (post-rotation) from the engine renderer.
  const rendered = await engineRenderPages(pdfBytes, {
    pages: [page],
    scale,
    format: 'png',
  });
  const first = rendered[0];
  if (!first) return null;

  return {
    bytes: first.bytes,
    imageWidth: first.width,
    imageHeight: first.height,
    pageWidth: dims.width,
    pageHeight: dims.height,
    rotation: dims.rotation,
  };
}
