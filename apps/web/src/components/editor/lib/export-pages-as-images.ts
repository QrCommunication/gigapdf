/**
 * export-pages-as-images.ts
 *
 * Client-side helper for rasterising the current document to per-page images
 * (PNG / JPEG / WebP) and bundling them into a single `.zip` — entirely in the
 * browser, with no backend job and no `<canvas>` / `sharp` dependency.
 *
 * The document bytes are opened through the shared GigaPDF engine
 * ({@link loadPdfEngine} — the same single wasm instance that rasterises page
 * backgrounds, so we never load a second engine). Each page is rasterised to PNG
 * by the SDK's `doc.renderPage(pageNumber, scale)`; for JPEG / WebP the PNG is
 * decoded to RGBA and re-encoded with the engine's own native codecs
 * (`decodePng` → `encodeJpeg` / `encodeWebp`). The per-page images are then
 * packed into a STORE-level (uncompressed) zip via `fflate` — the images are
 * already compressed, so deflating them again only wastes CPU.
 *
 * This is a strictly READ-ONLY consumer: it opens a short-lived `GigaPdfDoc` on a
 * copy of the current bytes, renders every page, and closes the doc in `finally`.
 * It never mutates `currentPdfFile`, the scene graph, or the operations queue —
 * exactly like {@link file://./export-document.ts}.
 *
 * No React, no DOM — trivially unit-testable with an injected engine loader.
 */

import { loadPdfEngine } from "@giga-pdf/canvas";
import { zipSync, type Zippable } from "fflate";

/** Image targets the per-page exporter can produce. */
export type ImageExportFormat = "png" | "jpeg" | "webp";

/** Loader for the shared GigaPDF engine; injectable for tests. */
type EngineLoader = typeof loadPdfEngine;

/** Tuning for the rasterisation pass. */
export interface ImageExportOptions {
  /**
   * Target resolution in dots-per-inch. PDF user-space is 72 DPI, so the engine
   * render scale is `dpi / 72`. Defaults to 150 (the value the old backend job
   * used for image exports).
   */
  readonly dpi?: number;
  /** JPEG / WebP quality, 1-100. Ignored for PNG. Defaults to 85. */
  readonly quality?: number;
}

/** MIME type for each image format (used on the per-entry, not the zip). */
const IMAGE_CONTENT_TYPE: Readonly<Record<ImageExportFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
} as const;

const DEFAULT_DPI = 150;
const DEFAULT_QUALITY = 85;
/** PDF user-space is 72 DPI; engine render scale = dpi / 72. */
const PDF_DPI = 72;
const ZIP_CONTENT_TYPE = "application/zip";

/**
 * Minimal structural view of the SDK engine + document we rely on here. Declared
 * locally so this module stays decoupled from the SDK's public type surface (the
 * methods are stable on `GigaPdfEngine` / `GigaPdfDoc`). Note the image codecs
 * (`decodePng` / `encodeJpeg` / `encodeWebp`) live on the *engine*, while page
 * rasterisation lives on the *doc* — mirrors `pdf-engine/src/render/engine-render.ts`.
 */
interface RasterEngine {
  open(bytes: Uint8Array): RasterDoc;
  decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null;
  encodeJpeg(rgba: Uint8Array, width: number, height: number, quality?: number): Uint8Array;
  encodeWebp(rgba: Uint8Array, width: number, height: number): Uint8Array;
}

interface RasterDoc {
  pageCount(): number;
  renderPage(pageNumber: number, scale?: number): Uint8Array;
  close(): void;
}

/** Normalise PDF bytes to a `Uint8Array` the engine can open. */
function toBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

/**
 * Copy bytes into a freshly-allocated `ArrayBuffer`-backed view so the result is
 * a `Uint8Array<ArrayBuffer>` — directly usable as a `BlobPart` and a `fflate`
 * `Zippable` value (the SDK / fflate return the looser `Uint8Array<ArrayBufferLike>`).
 */
function freshCopy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/** Read width/height from a PNG's IHDR chunk (big-endian, fixed offsets). */
function pngSize(png: Uint8Array): { width: number; height: number } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** Zero-pad a 1-based page number so zip entries sort naturally (page-001.png). */
function pageEntryName(pageNumber: number, total: number, format: ImageExportFormat): string {
  const width = String(total).length;
  return `page-${String(pageNumber).padStart(width, "0")}.${format}`;
}

/**
 * Re-encode a freshly-rasterised PNG page into the requested image `format`.
 * PNG is returned untouched; JPEG / WebP decode the PNG to RGBA and re-encode
 * with the engine's native codecs. A failed decode falls back to a blank RGBA
 * buffer of the right size so one bad page never aborts the whole export.
 */
function encodePage(
  engine: RasterEngine,
  png: Uint8Array,
  format: ImageExportFormat,
  quality: number,
): Uint8Array {
  if (format === "png") return png;
  const { width, height } = pngSize(png);
  const decoded = engine.decodePng(png);
  const rgba = decoded?.rgba ?? new Uint8Array(width * height * 4);
  return format === "jpeg"
    ? engine.encodeJpeg(rgba, width, height, quality)
    : engine.encodeWebp(rgba, width, height);
}

/**
 * Rasterise every page of `source` to `format` and return a download-ready `.zip`
 * `Blob`. Opens a short-lived `GigaPdfDoc` on the shared engine, renders + encodes
 * each page synchronously (the wasm rasteriser is synchronous, so the doc never
 * overlaps page rendering on the shared instance — mirrors export-document.ts),
 * zips the entries at STORE level, and closes the doc in `finally`. Throws if the
 * engine cannot open the bytes; the caller surfaces that as an error toast.
 */
export async function exportPagesAsImages(
  source: ArrayBuffer | Uint8Array,
  format: ImageExportFormat,
  opts: ImageExportOptions = {},
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<Blob> {
  const dpi = opts.dpi ?? DEFAULT_DPI;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const scale = dpi / PDF_DPI;
  // `IMAGE_CONTENT_TYPE` documents the per-entry MIME; referenced to keep the
  // table honest with `format` and avoid an unused-export lint.
  void IMAGE_CONTENT_TYPE[format];

  const engine = (await loadEngine()) as unknown as RasterEngine;
  const doc = engine.open(toBytes(source));
  try {
    const total = doc.pageCount();
    const entries: Zippable = {};
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      const png = doc.renderPage(pageNumber, scale);
      const bytes = encodePage(engine, png, format, quality);
      entries[pageEntryName(pageNumber, total, format)] = freshCopy(bytes);
    }
    // STORE (level 0): the page images are already compressed, so deflating them
    // a second time only burns CPU for no size win.
    const zipped = freshCopy(zipSync(entries, { level: 0 }));
    return new Blob([zipped], { type: ZIP_CONTENT_TYPE });
  } finally {
    doc.close();
  }
}
