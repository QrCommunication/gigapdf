/**
 * Page rendering via the WASM engine (`@qrcommunication/gigapdf-lib`).
 *
 * Native engine path. The engine rasterises a page to PNG
 * directly (glyphs + images, pure WASM) and re-encodes to JPEG / lossless WebP
 * with the engine's own native codecs (no third-party image library). The public
 * API (`renderPages` / `renderPage`) is unchanged.
 */

import { getEngine } from '../wasm';
import { engineLogger } from '../utils/logger';

export interface RenderPageOptions {
  pageNumber: number; // 1-based
  /** Scale factor relative to PDF user-space (1 = native size). 2 = retina. */
  scale?: number;
  /** Output format. JPEG is smaller (no alpha), PNG keeps transparency. */
  format?: 'png' | 'jpeg' | 'webp';
  /** Quality 1-100 for jpeg/webp (ignored for png). */
  quality?: number;
}

export interface RenderedPage {
  pageNumber: number;
  bytes: Uint8Array;
  format: 'png' | 'jpeg' | 'webp';
  width: number;
  height: number;
}

export interface BatchRenderOptions {
  /** Pages to render (1-based). Defaults to all pages. */
  pages?: number[];
  scale?: number;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  /** Cap parallel native re-encoding jobs. Defaults to 4. */
  concurrency?: number;
}

/** Read width/height from a PNG's IHDR chunk (big-endian, fixed offsets). */
function pngSize(png: Uint8Array): { width: number; height: number } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export async function renderPages(
  pdfBytes: Uint8Array,
  options: BatchRenderOptions = {},
): Promise<RenderedPage[]> {
  const { pages, scale = 1, format = 'jpeg', quality = 85, concurrency = 4 } = options;

  const giga = await getEngine();
  const doc = giga.open(pdfBytes);
  try {
    const totalPages = doc.pageCount();
    const targetPages = pages
      ? pages.filter((p) => p >= 1 && p <= totalPages)
      : Array.from({ length: totalPages }, (_, i) => i + 1);

    // Phase 1 — rasterise each page to PNG via the engine (synchronous WASM).
    const pngs = targetPages.map((pageNumber) => ({
      pageNumber,
      png: doc.renderPage(pageNumber, scale),
    }));

    // Phase 2 — re-encode to the requested format natively, bounded concurrency.
    const results: RenderedPage[] = [];
    for (let i = 0; i < pngs.length; i += concurrency) {
      const chunk = pngs.slice(i, i + concurrency);
      const encoded = await Promise.all(
        chunk.map(async ({ pageNumber, png }) => {
          const { width, height } = pngSize(png);
          let bytes: Uint8Array;
          if (format === 'png') {
            bytes = png;
          } else {
            // Re-encode natively (no `sharp`): decode the engine PNG to RGBA,
            // then encode JPEG (lossy) or lossless WebP (VP8L).
            const img = giga.decodePng(png);
            const rgba = img?.rgba ?? new Uint8Array(width * height * 4);
            bytes =
              format === 'jpeg'
                ? giga.encodeJpeg(rgba, width, height, quality)
                : giga.encodeWebp(rgba, width, height);
          }
          return { pageNumber, bytes, format, width, height } as RenderedPage;
        }),
      );
      results.push(...encoded);
    }

    engineLogger.info('render: batch render complete', {
      requestedPages: targetPages.length,
      rendered: results.length,
      format,
      scale,
    });
    return results;
  } finally {
    doc.close();
  }
}

/** Single-page convenience helper. */
export async function renderPage(
  pdfBytes: Uint8Array,
  pageNumber: number,
  options: Omit<RenderPageOptions, 'pageNumber'> = {},
): Promise<RenderedPage> {
  const [result] = await renderPages(pdfBytes, {
    pages: [pageNumber],
    scale: options.scale,
    format: options.format,
    quality: options.quality,
    concurrency: 1,
  });
  if (!result) {
    throw new Error(`renderPage: page ${pageNumber} could not be rendered`);
  }
  return result;
}
