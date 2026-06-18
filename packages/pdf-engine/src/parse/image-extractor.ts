/**
 * image-extractor.ts
 *
 * Extracts embedded raster images from a PDF using the native engine
 * (`@qrcommunication/gigapdf-lib`) — no pdfjs.
 *
 * Two public exports:
 *  - extractImageElementsByPage(pdfBytes)
 *    → Used by parser.ts. Opens the document once, reads every page's image
 *      placements, and groups them by 1-based page number as ImageElement[].
 *
 *  - extractImages(pdfBytes, pageNumber?, options?)
 *    → Standalone API for external callers (Fabric.js editor).
 *    → Returns ExtractedImage[] with richer metadata + optional dataUrls.
 *
 * Coordinate system: all bounds are in web space (origin top-left, Y increases
 * downward), in PDF points (1 pt = 1/72 inch). The engine reports image
 * placement in user space (origin bottom-left); we flip Y with the page height.
 */

import { createHash } from 'node:crypto';
import type { ImageElement } from '@giga-pdf/types';
import type { ImageElementInfo } from '@qrcommunication/gigapdf-lib';
import { engineLogger } from '../utils/logger';
import { getEngine } from '../wasm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum image dimension (in PDF points) to be included. Filters hairlines. */
const MIN_IMAGE_DIMENSION = 2;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derive a stable UUID from (page, x, y, resourceName).
 * Same image at the same position always gets the same elementId — useful for
 * diff / incremental updates in the Fabric.js editor.
 */
function deriveStableId(
  pageNumber: number,
  x: number,
  y: number,
  resourceName: string,
): string {
  const hash = createHash('sha256')
    .update(`${pageNumber}:${x.toFixed(2)}:${y.toFixed(2)}:${resourceName}`)
    .digest('hex')
    .slice(0, 32);

  // Format as UUID v4-like (RFC 4122 variant bits in position 16)
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

type ImageMime = 'image/jpeg' | 'image/png' | 'image/jp2' | 'image/unknown';

/** Map the engine's `format` string to a MIME type. */
function formatToMime(format: string): ImageMime {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'jp2':
      return 'image/jp2';
    default:
      return 'image/unknown';
  }
}

/**
 * Build a `data:` URL from the engine's embeddable image bytes, or `null` when
 * the format is unknown (no bytes) — the engine already encodes JPEG/JP2
 * passthrough and re-encodes Flate/raw samples to PNG.
 */
function dataUrlFromInfo(info: ImageElementInfo): string | null {
  if (info.format === 'unknown' || info.data.length === 0) return null;
  const mime = formatToMime(info.format);
  return `data:${mime};base64,${Buffer.from(info.data).toString('base64')}`;
}

/**
 * Convert an engine `ImageElementInfo` (user space, origin bottom-left) to web
 * bounds (origin top-left). `pageHeight` is the page's user-space height.
 */
function webBounds(
  info: ImageElementInfo,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: info.x,
    y: pageHeight - info.y - info.height,
    width: info.width,
    height: info.height,
  };
}

// ---------------------------------------------------------------------------
// extractImageElementsByPage — document-level extraction used by parser.ts
// ---------------------------------------------------------------------------

/**
 * Extract every embedded image from a PDF, grouped by 1-based page number, as
 * editor `ImageElement` scene-graph objects. Opens the document once (the
 * efficient path for the multi-page parse); degenerate (hairline) placements
 * are skipped. Returns an empty map on failure.
 */
export async function extractImageElementsByPage(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  baseUrl?: string | null,
  documentId?: string,
): Promise<Map<number, ImageElement[]>> {
  const byPage = new Map<number, ImageElement[]>();
  try {
    const giga = await getEngine();
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = giga.open(bytes);
    try {
      const pageCount = doc.pageCount();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const pageHeight = doc.pageInfo(pageNumber).height;
        const elements: ImageElement[] = [];
        let index = 0;
        for (const info of doc.imageElements(pageNumber)) {
          const bounds = webBounds(info, pageHeight);
          if (bounds.width < MIN_IMAGE_DIMENSION || bounds.height < MIN_IMAGE_DIMENSION) {
            index++;
            continue;
          }
          const resourceName = `img_${index}`;
          let dataUrl = dataUrlFromInfo(info) ?? '';
          if (!dataUrl && baseUrl && documentId) {
            dataUrl = `${baseUrl}/api/pdf/${documentId}/pages/${pageNumber}/images/${index}`;
          }
          elements.push({
            elementId: deriveStableId(pageNumber, bounds.x, bounds.y, resourceName),
            type: 'image',
            bounds,
            transform: {
              rotation: Math.round(info.rotation),
              scaleX: 1,
              scaleY: 1,
              skewX: 0,
              skewY: 0,
            },
            layerId: null,
            locked: false,
            visible: true,
            source: {
              type: 'embedded',
              dataUrl,
              originalFormat: info.format,
              originalDimensions: { width: info.pixelWidth, height: info.pixelHeight },
            },
            style: { opacity: info.opacity, blendMode: 'normal' },
            crop: null,
          });
          index++;
        }
        if (elements.length > 0) byPage.set(pageNumber, elements);
      }
    } finally {
      doc.close();
    }
  } catch (error) {
    engineLogger.warn('[image-extractor] extractImageElementsByPage failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return byPage;
}

/** Image elements on a single page (convenience wrapper over the grouped map). */
export async function extractImageElements(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  pageNumber: number,
  baseUrl?: string | null,
  documentId?: string,
): Promise<ImageElement[]> {
  return (await extractImageElementsByPage(pdfBytes, baseUrl, documentId)).get(pageNumber) ?? [];
}

// ---------------------------------------------------------------------------
// ExtractedImage — richer type for the standalone extractImages API
// ---------------------------------------------------------------------------

/**
 * Richer image descriptor returned by `extractImages()`.
 * Includes native pixel dimensions, MIME type, optional dataUrl, and opacity.
 */
export interface ExtractedImage {
  /** Stable UUID derived from hash(page:x:y:resourceName) */
  elementId: string;
  pageNumber: number;
  bounds: {
    x: number; // web coords (top-left origin), PDF points
    y: number;
    width: number;
    height: number;
  };
  source: {
    /** Synthetic resource name (`img_{index}`) — the engine indexes by order. */
    resourceName: string;
    /** data:…;base64,… — only when `options.includeDataUrls = true`. */
    dataUrl: string | null;
    /** Detected MIME type from the engine's encoded bytes. */
    mimeType: ImageMime;
    /** Native pixel width of the image resource */
    width: number;
    /** Native pixel height of the image resource */
    height: number;
  };
  /** Rotation in degrees derived from the placement CTM */
  rotation: number;
  /** Fill alpha from the active ExtGState (0-1) */
  opacity: number;
}

/**
 * Options for the standalone `extractImages()` function.
 */
export interface ExtractImagesOptions {
  /**
   * When true, each image carries a `data:` URL built from the engine's
   * embeddable bytes. Defaults to false for performance.
   */
  includeDataUrls?: boolean;
}

/**
 * Standalone image extractor for the Fabric.js editor.
 *
 * Extracts embedded images from all pages (or a specific page) of a PDF.
 * Returns richer metadata than `extractImageElementsByPage`, including MIME
 * type, native dimensions, and optional dataUrls.
 *
 * @param pdfBytes    - PDF content as ArrayBuffer or Uint8Array
 * @param pageNumber  - Optional 1-based page number. When omitted, all pages.
 * @param options     - includeDataUrls (default: false)
 * @returns           Array of ExtractedImage sorted top-left → bottom-right.
 */
export async function extractImages(
  pdfBytes: ArrayBuffer | Uint8Array,
  pageNumber?: number,
  options: ExtractImagesOptions = {},
): Promise<ExtractedImage[]> {
  const includeDataUrls = options.includeDataUrls ?? false;
  const allImages: ExtractedImage[] = [];

  try {
    const giga = await getEngine();
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = giga.open(bytes);
    try {
      const pageCount = doc.pageCount();
      const pages =
        pageNumber !== undefined
          ? [Math.max(1, Math.min(pageNumber, pageCount))]
          : Array.from({ length: pageCount }, (_, i) => i + 1);

      for (const pgNum of pages) {
        const pageHeight = doc.pageInfo(pgNum).height;
        let index = 0;
        for (const info of doc.imageElements(pgNum)) {
          const bounds = webBounds(info, pageHeight);
          if (bounds.width < MIN_IMAGE_DIMENSION || bounds.height < MIN_IMAGE_DIMENSION) {
            index++;
            continue;
          }
          const resourceName = `img_${index}`;
          allImages.push({
            elementId: deriveStableId(pgNum, bounds.x, bounds.y, resourceName),
            pageNumber: pgNum,
            bounds,
            source: {
              resourceName,
              dataUrl: includeDataUrls ? dataUrlFromInfo(info) : null,
              mimeType: formatToMime(info.format),
              width: info.pixelWidth,
              height: info.pixelHeight,
            },
            rotation: Math.round(info.rotation),
            opacity: info.opacity,
          });
          index++;
        }
      }
    } finally {
      doc.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLogger.error('[image-extractor] extractImages failed', { message });
    throw new Error(`extractImages: ${message}`);
  }

  // Sort: page ascending, then top-left → bottom-right within each page
  allImages.sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    const dy = a.bounds.y - b.bounds.y;
    return Math.abs(dy) > 1 ? dy : a.bounds.x - b.bounds.x;
  });

  return allImages;
}
