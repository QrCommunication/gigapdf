/**
 * image-extractor.ts
 *
 * Extracts embedded raster images from a PDF page using pdfjs-dist.
 *
 * Two public exports:
 *  - extractImageElements(page, pageNumber, pageHeight, baseUrl?, documentId?)
 *    → Used by parser.ts in the main extraction pipeline.
 *    → Returns ImageElement[] conforming to @giga-pdf/types.
 *
 *  - extractImages(pdfBytes, pageNumber?, options?)
 *    → Standalone API for external callers (Fabric.js editor).
 *    → Returns ExtractedImage[] with richer metadata + optional dataUrls.
 *
 * Coordinate system: all bounds are in web space (origin top-left, Y increases downward).
 * Values are in PDF points (1 pt = 1/72 inch).
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy, PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { createHash } from 'node:crypto';
import type { ImageElement } from '@giga-pdf/types';
import { engineLogger } from '../utils/logger';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum image dimension (in PDF points) to be included. Filters hairline images. */
const MIN_IMAGE_DIMENSION = 2;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Multiply two 6-element PDF transformation matrices [a,b,c,d,e,f].
 * Represents the concatenation: m1 × m2
 */
function multiplyMatrices(m1: number[], m2: number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

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

/**
 * Detect MIME type from the first bytes of an image data array.
 *
 * Magic bytes:
 *  - JPEG:  FF D8 FF
 *  - PNG:   89 50 4E 47 (‌\x89PNG)
 *  - JBIG2: (no standard magic; treated as unknown)
 *  - JP2:   00 00 00 0C 6A 50 20 20 (starts with \x00\x00\x00\x0C jP  )
 */
function detectMimeType(
  data: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
): 'image/jpeg' | 'image/png' | 'image/jp2' | 'image/unknown' {
  if (!data || data.length < 4) return 'image/unknown';
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  const b2 = data[2] ?? 0;
  const b3 = data[3] ?? 0;

  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image/jpeg';
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'image/png';
  if (b0 === 0x00 && b1 === 0x00 && b2 === 0x00 && b3 === 0x0c) return 'image/jp2';

  return 'image/unknown';
}

/**
 * Map MIME type to originalFormat string used by ImageSource.
 */
function mimeToFormat(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpeg';
    case 'image/png':  return 'png';
    case 'image/jp2':  return 'jp2';
    default:           return 'unknown';
  }
}

/**
 * Compute the rotation angle (in degrees) from a CTM matrix.
 * Rotation = atan2(b, a) — the angle of the X-axis vector.
 */
function rotationFromCtm(ctm: number[]): number {
  const a = ctm[0] ?? 1;
  const b = ctm[1] ?? 0;
  return Math.round((Math.atan2(b, a) * 180) / Math.PI);
}

/**
 * Compute the bounding rectangle from the CTM that was active at a paintImageXObject
 * operator. The unit image [0,0→1,1] is transformed by the CTM.
 *
 * We transform all four corners and take the axis-aligned bounding box so that
 * rotated images are handled correctly.
 *
 * Returns bounds in **web coordinates** (top-left origin, Y down).
 */
function boundsFromCtm(
  ctm: number[],
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  // Four corners of the unit square in PDF image space
  const corners: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  // Transform each corner: [a,b,c,d,e,f]
  // x' = a*x + c*y + e
  // y' = b*x + d*y + f  (PDF coords, bottom-left origin)
  const transformed = corners.map(([cx, cy]) => {
    const px = (ctm[0] ?? 1) * cx! + (ctm[2] ?? 0) * cy! + (ctm[4] ?? 0);
    const py = (ctm[1] ?? 0) * cx! + (ctm[3] ?? 1) * cy! + (ctm[5] ?? 0);
    return { px, py };
  });

  const xs = transformed.map((p) => p.px);
  const ys = transformed.map((p) => p.py);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minPdfY = Math.min(...ys);
  const maxPdfY = Math.max(...ys);

  const width = maxX - minX;
  const height = maxPdfY - minPdfY;

  // Convert PDF Y (bottom-left) → web Y (top-left)
  const webY = pageHeight - maxPdfY;

  return { x: minX, y: webY, width, height };
}

// ---------------------------------------------------------------------------
// Internal image object resolver
// ---------------------------------------------------------------------------

/**
 * Attempt to resolve a pdfjs image object by its resource name.
 *
 * pdfjs loads image data lazily. After getOperatorList() has run, most images
 * are available via `page.objs.get(name)`.
 *
 * Returns null if the object is not available (not yet loaded or not an image).
 */
// pdfjs ImageKind values (from src/shared/util.js).
// We must convert each kind to RGBA (4 bytes/pixel) for the canvas ImageData
// constructor — feeding it raw RGB or 1bpp grayscale produces a corrupted
// rendering with shifted pixels (the symptom: a noisy diagonal pattern that
// has nothing to do with the source image).
const PDFJS_IMAGE_KIND = {
  GRAYSCALE_1BPP: 1,
  RGB_24BPP: 2,
  RGBA_32BPP: 3,
} as const;

function toRgbaPixels(
  rawData: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  kind: number | undefined,
): Uint8ClampedArray {
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  if (kind === PDFJS_IMAGE_KIND.RGBA_32BPP || rawData.length === pixelCount * 4) {
    // Already RGBA — copy through as-is.
    rgba.set(rawData);
    return rgba;
  }

  if (kind === PDFJS_IMAGE_KIND.RGB_24BPP || rawData.length === pixelCount * 3) {
    // RGB 24bpp → expand to RGBA with alpha=255.
    for (let i = 0, j = 0; i < pixelCount; i++, j += 4) {
      const src = i * 3;
      rgba[j] = rawData[src]!;
      rgba[j + 1] = rawData[src + 1]!;
      rgba[j + 2] = rawData[src + 2]!;
      rgba[j + 3] = 255;
    }
    return rgba;
  }

  if (kind === PDFJS_IMAGE_KIND.GRAYSCALE_1BPP || rawData.length === pixelCount) {
    // 8bpp grayscale → replicate to RGB, alpha=255.
    for (let i = 0, j = 0; i < pixelCount; i++, j += 4) {
      const v = rawData[i]!;
      rgba[j] = v;
      rgba[j + 1] = v;
      rgba[j + 2] = v;
      rgba[j + 3] = 255;
    }
    return rgba;
  }

  // Unknown layout — best-effort: assume RGBA if exact, else fail open.
  // Fail-open is preferable to corrupting random pixels.
  if (rawData.length >= pixelCount * 4) {
    rgba.set(rawData.subarray(0, pixelCount * 4));
  }
  return rgba;
}

async function resolveImageObj(
  page: PDFPageProxy,
  name: string,
): Promise<{ width: number; height: number; data: Uint8ClampedArray | null } | null> {
  try {
    // pdfjs exposes `objs` (page-level) and `commonObjs` (document-level).
    // Image XObjects are typically page-level. They are loaded lazily during
    // rendering: only the first image referenced in the operator list is
    // available synchronously after getOperatorList. Subsequent images throw
    // "Requesting object that isn't resolved yet" if accessed via the sync
    // get(name) API. The async callback form resolves once the data lands.
    const objs = (page as unknown as Record<string, unknown>)['objs'];
    if (!objs) return null;
    const objsApi = objs as {
      get: ((k: string) => unknown) & ((k: string, cb: (v: unknown) => void) => void);
      has?: (k: string) => boolean;
    };
    if (typeof objsApi.get !== 'function') return null;

    const imgObj = await new Promise<unknown>((resolve) => {
      // Two-arg form: callback fires when the resource resolves.
      try {
        (objsApi.get as (k: string, cb: (v: unknown) => void) => void)(name, resolve);
      } catch {
        resolve(null);
      }
    });
    if (!imgObj || typeof imgObj !== 'object') return null;

    const obj = imgObj as Record<string, unknown>;
    const w = typeof obj['width'] === 'number' ? obj['width'] : null;
    const h = typeof obj['height'] === 'number' ? obj['height'] : null;
    if (!w || !h) return null;

    const rawData = obj['data'];
    if (!(rawData instanceof Uint8Array || rawData instanceof Uint8ClampedArray)) {
      return { width: w, height: h, data: null };
    }
    const kind = typeof obj['kind'] === 'number' ? (obj['kind'] as number) : undefined;
    const data = toRgbaPixels(rawData, w, h, kind);

    return { width: w, height: h, data };
  } catch {
    return null;
  }
}

/** Type shape expected from the optional `canvas` peer dependency. */
interface CanvasModule {
  createCanvas: (w: number, h: number) => {
    getContext: (t: '2d') => {
      putImageData: (id: unknown, x: number, y: number) => void;
    };
    toDataURL: (fmt: string) => string;
  };
  ImageData: new (data: Uint8ClampedArray, w: number, h: number) => unknown;
}

async function rgbaToDataUrl(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string | null> {
  try {
    // Attempt to use the `canvas` package if available in the environment.
    // It is an optional peer dependency for server-side dataUrl generation.
    // Dynamic import keeps this module loadable when `canvas` is absent.
    const canvasModule = (await import('canvas')) as unknown as CanvasModule;

    // Standard W3C constructor: new ImageData(data, width, height).
    // The non-standard ctx.createImageData(data, width, height) signature was
    // throwing "input data has zero byte length" silently, returning null and
    // dropping every image from the rendered canvas.
    const canvas = canvasModule.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const imageData = new canvasModule.ImageData(data, width, height);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    // `canvas` package not installed — skip dataUrl generation gracefully
    engineLogger.debug('[image-extractor] canvas not available; skipping dataUrl', {
      width,
      height,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// GraphicsState tracker — opacity via gs (ExtGState)
// ---------------------------------------------------------------------------

interface GraphicsState {
  /** Fill alpha (ca in ExtGState), 0-1 */
  fillAlpha: number;
}

// ---------------------------------------------------------------------------
// extractImageElements — existing API used by parser.ts
// ---------------------------------------------------------------------------

/**
 * Extract embedded images from a PDF page and return ImageElement[] objects
 * compatible with @giga-pdf/types.
 *
 * This function is called by parser.ts in the main extraction pipeline.
 * It is performance-sensitive: < 1 s for a page with 10 images.
 *
 * @param page        - pdfjs PDFPageProxy (operator list already available)
 * @param pageNumber  - 1-based page number
 * @param pageHeight  - Page height in PDF points (used for Y-flip)
 * @param baseUrl     - Optional base URL for image src URLs
 * @param documentId  - Optional document ID for image src URLs
 */
export async function extractImageElements(
  page: PDFPageProxy,
  pageNumber: number,
  pageHeight: number,
  baseUrl?: string | null,
  documentId?: string,
): Promise<ImageElement[]> {
  let ops: Awaited<ReturnType<PDFPageProxy['getOperatorList']>>;
  try {
    ops = await page.getOperatorList();
  } catch (error) {
    engineLogger.warn('[image-extractor] getOperatorList failed', {
      pageNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const images: ImageElement[] = [];
  let imageIndex = 0;

  const fnArray = ops.fnArray;
  const argsArray = ops.argsArray;

  // Current transformation matrix — starts as identity
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const matrixStack: number[][] = [];

  // Graphics state stack (for opacity via gs operator)
  const gsState: GraphicsState = { fillAlpha: 1 };
  const gsStack: GraphicsState[] = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];

    // ---- Transformation matrix management ----
    if (fn === OPS.save) {
      matrixStack.push([...ctm]);
      gsStack.push({ ...gsState });
    } else if (fn === OPS.restore) {
      ctm = matrixStack.pop() ?? [1, 0, 0, 1, 0, 0];
      const restoredGs = gsStack.pop();
      if (restoredGs) {
        gsState.fillAlpha = restoredGs.fillAlpha;
      }
    } else if (fn === OPS.transform) {
      const args = argsArray[i] as number[];
      const [a, b, c, d, e, f] = args;
      ctm = multiplyMatrices(ctm, [a!, b!, c!, d!, e!, f!]);
    }

    // ---- ExtGState (opacity via gs operator) ----
    else if (fn === OPS.setGState) {
      // args: [Array<[key, value]>]
      const gStateArgs = argsArray[i] as Array<[string, unknown]> | undefined;
      if (Array.isArray(gStateArgs)) {
        for (const entry of gStateArgs) {
          if (!Array.isArray(entry)) continue;
          const [key, value] = entry;
          // 'ca' = fill alpha, 'CA' = stroke alpha
          if (key === 'ca' && typeof value === 'number') {
            gsState.fillAlpha = value;
          }
        }
      }
    }

    // ---- Image drawing operators ----
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const args = argsArray[i] as unknown[];

      // Resource name is the first argument for paintImageXObject
      const resourceName =
        fn === OPS.paintImageXObject
          ? (typeof args[0] === 'string' ? args[0] : `img_${imageIndex}`)
          : `inline_${pageNumber}_${imageIndex}`;

      const bounds = boundsFromCtm(ctm, pageHeight);
      const rotation = rotationFromCtm(ctm);
      const opacity = gsState.fillAlpha;

      // Skip degenerate images (hairlines, invisible)
      if (bounds.width < MIN_IMAGE_DIMENSION || bounds.height < MIN_IMAGE_DIMENSION) {
        imageIndex++;
        continue;
      }

      // Attempt to resolve native image dimensions and pixel bytes from pdfjs.
      let nativeWidth = Math.round(Math.abs(ctm[0]!));
      let nativeHeight = Math.round(Math.abs(ctm[3]!));
      let originalFormat = 'unknown';
      let pixelData: Uint8ClampedArray | null = null;

      try {
        const imgObj = await resolveImageObj(page, resourceName);
        if (imgObj) {
          nativeWidth = imgObj.width;
          nativeHeight = imgObj.height;
          pixelData = imgObj.data;
          const mime = detectMimeType(imgObj.data);
          originalFormat = mimeToFormat(mime);
        }
      } catch (objError) {
        engineLogger.debug('[image-extractor] could not resolve image object', {
          pageNumber,
          resourceName,
          error: objError instanceof Error ? objError.message : String(objError),
        });
      }

      // Generate an inline data URL so the frontend can render the image
      // without an extra round-trip. The previous implementation pointed at
      // /api/pdf/{docId}/pages/{N}/images/{idx} — an endpoint that does not
      // exist — so every image silently fell through to an empty source and
      // the editor canvas dropped them entirely.
      let dataUrl = '';
      if (pixelData && nativeWidth > 0 && nativeHeight > 0) {
        const generated = await rgbaToDataUrl(pixelData, nativeWidth, nativeHeight);
        if (generated) dataUrl = generated;
      }
      if (!dataUrl && baseUrl && documentId) {
        dataUrl = `${baseUrl}/api/pdf/${documentId}/pages/${pageNumber}/images/${imageIndex}`;
      }

      const elementId = deriveStableId(pageNumber, bounds.x, bounds.y, resourceName);

      const imageElement: ImageElement = {
        elementId,
        type: 'image',
        bounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
        transform: {
          rotation,
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
          originalFormat,
          originalDimensions: {
            width: nativeWidth,
            height: nativeHeight,
          },
        },
        style: {
          opacity,
          blendMode: 'normal',
        },
        crop: null,
      };

      images.push(imageElement);
      imageIndex++;
    }

    // ---- Soft-mask / Form XObjects that contain images (paintFormXObjectBegin) ----
    // pdfjs flattens form XObjects into the operator list before we see them,
    // so we do NOT need to handle OPS.paintFormXObjectBegin separately —
    // the inner Do operators will appear in the flat list with updated CTM.
  }

  engineLogger.debug('[image-extractor] extractImageElements complete', {
    pageNumber,
    found: images.length,
  });

  return images;
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
    x: number;    // web coords (top-left origin), PDF points
    y: number;
    width: number;
    height: number;
  };
  source: {
    /** Resource name in the PDF XObject dictionary (e.g. "Im0") */
    resourceName: string;
    /**
     * data:image/png;base64,… — only populated when options.includeDataUrls = true
     * and the `canvas` package is available.
     */
    dataUrl: string | null;
    /** Detected MIME type from magic bytes */
    mimeType: 'image/jpeg' | 'image/png' | 'image/jp2' | 'image/unknown';
    /** Native pixel width of the image resource */
    width: number;
    /** Native pixel height of the image resource */
    height: number;
  };
  /** Rotation in degrees derived from the CTM at render time */
  rotation: number;
  /** Fill alpha from the active ExtGState (0-1) */
  opacity: number;
}

/**
 * Options for the standalone `extractImages()` function.
 */
export interface ExtractImagesOptions {
  /**
   * When true, each image's RGBA data is converted to a PNG data URL.
   * Requires the optional `canvas` npm package to be installed.
   * Defaults to false for performance.
   */
  includeDataUrls?: boolean;
}

/**
 * Standalone image extractor for the Fabric.js editor.
 *
 * Extracts embedded images from all pages (or a specific page) of a PDF.
 * Returns richer metadata than `extractImageElements`, including MIME type,
 * native dimensions, and optional dataUrls.
 *
 * Performance target: < 1 s per page (10 images), includeDataUrls = false.
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
  const startMs = Date.now();

  const data =
    pdfBytes instanceof ArrayBuffer ? new Uint8Array(pdfBytes) : pdfBytes;

  let pdfDoc: PDFDocumentProxy;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data,
      useWorkerFetch: false,
      useSystemFonts: true,
    });
    pdfDoc = await loadingTask.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLogger.error('[image-extractor] extractImages — failed to open PDF', { message });
    throw new Error(`extractImages: failed to open PDF — ${message}`);
  }

  const numPages = pdfDoc.numPages;
  const pagesToProcess =
    pageNumber !== undefined
      ? [Math.max(1, Math.min(pageNumber, numPages))]
      : Array.from({ length: numPages }, (_, i) => i + 1);

  engineLogger.debug('[image-extractor] extractImages — start', {
    pages: pagesToProcess.length,
    includeDataUrls,
  });

  const allImages: ExtractedImage[] = [];

  for (const pgNum of pagesToProcess) {
    let page: PDFPageProxy;
    try {
      page = await pdfDoc.getPage(pgNum);
    } catch (pageError) {
      engineLogger.warn('[image-extractor] could not open page — skipping', {
        pageNumber: pgNum,
        error: pageError instanceof Error ? pageError.message : String(pageError),
      });
      continue;
    }

    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;

    let ops: Awaited<ReturnType<PDFPageProxy['getOperatorList']>>;
    try {
      ops = await page.getOperatorList();
    } catch (opsError) {
      engineLogger.warn('[image-extractor] getOperatorList failed — skipping page', {
        pageNumber: pgNum,
        error: opsError instanceof Error ? opsError.message : String(opsError),
      });
      page.cleanup();
      continue;
    }

    let imageIndex = 0;
    let ctm: number[] = [1, 0, 0, 1, 0, 0];
    const matrixStack: number[][] = [];
    const gsState: GraphicsState = { fillAlpha: 1 };
    const gsStack: GraphicsState[] = [];

    const fnArray = ops.fnArray;
    const argsArray = ops.argsArray;

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];

      if (fn === OPS.save) {
        matrixStack.push([...ctm]);
        gsStack.push({ ...gsState });
      } else if (fn === OPS.restore) {
        ctm = matrixStack.pop() ?? [1, 0, 0, 1, 0, 0];
        const restoredGs = gsStack.pop();
        if (restoredGs) {
          gsState.fillAlpha = restoredGs.fillAlpha;
        }
      } else if (fn === OPS.transform) {
        const args = argsArray[i] as number[];
        const [a, b, c, d, e, f] = args;
        ctm = multiplyMatrices(ctm, [a!, b!, c!, d!, e!, f!]);
      } else if (fn === OPS.setGState) {
        const gStateArgs = argsArray[i] as Array<[string, unknown]> | undefined;
        if (Array.isArray(gStateArgs)) {
          for (const entry of gStateArgs) {
            if (!Array.isArray(entry)) continue;
            const [key, value] = entry;
            if (key === 'ca' && typeof value === 'number') {
              gsState.fillAlpha = value;
            }
          }
        }
      } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        const args = argsArray[i] as unknown[];

        const resourceName =
          fn === OPS.paintImageXObject
            ? (typeof args[0] === 'string' ? args[0] : `img_${imageIndex}`)
            : `inline_${pgNum}_${imageIndex}`;

        const bounds = boundsFromCtm(ctm, pageHeight);
        const rotation = rotationFromCtm(ctm);
        const opacity = gsState.fillAlpha;

        if (bounds.width < MIN_IMAGE_DIMENSION || bounds.height < MIN_IMAGE_DIMENSION) {
          imageIndex++;
          continue;
        }

        // Try to resolve native image object from pdfjs
        let nativeWidth = Math.round(Math.abs(ctm[0]!));
        let nativeHeight = Math.round(Math.abs(ctm[3]!));
        let mimeType: ReturnType<typeof detectMimeType> = 'image/unknown';
        let dataUrl: string | null = null;

        try {
          const imgObj = await resolveImageObj(page, resourceName);
          if (imgObj) {
            nativeWidth = imgObj.width;
            nativeHeight = imgObj.height;
            mimeType = detectMimeType(imgObj.data);

            if (includeDataUrls && imgObj.data) {
              dataUrl = await rgbaToDataUrl(imgObj.data, nativeWidth, nativeHeight);
            }
          }
        } catch (objError) {
          engineLogger.debug('[image-extractor] could not resolve image object for extractImages', {
            pageNumber: pgNum,
            resourceName,
            error: objError instanceof Error ? objError.message : String(objError),
          });
        }

        const elementId = deriveStableId(pgNum, bounds.x, bounds.y, resourceName);

        allImages.push({
          elementId,
          pageNumber: pgNum,
          bounds,
          source: {
            resourceName,
            dataUrl,
            mimeType,
            width: nativeWidth,
            height: nativeHeight,
          },
          rotation,
          opacity,
        });

        imageIndex++;
      }
    }

    page.cleanup();
  }

  // Sort: page ascending, then top-left → bottom-right within each page
  allImages.sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    const dy = a.bounds.y - b.bounds.y;
    return Math.abs(dy) > 1 ? dy : a.bounds.x - b.bounds.x;
  });

  const elapsedMs = Date.now() - startMs;
  engineLogger.info('[image-extractor] extractImages — complete', {
    totalImages: allImages.length,
    pages: pagesToProcess.length,
    elapsedMs,
  });

  await pdfDoc.destroy();

  return allImages;
}
