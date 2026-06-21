/**
 * Render PDF pages to PNG data URLs in the browser via the GigaPDF engine
 * (`@qrcommunication/gigapdf-lib`) — no third-party PDF library.
 *
 * The engine is a single WebAssembly module shared across every `PDFRenderer`
 * in the page; each renderer opens one document on it and rasterises pages with
 * the engine's native renderer (`doc.renderPage(n, scale)` → PNG bytes).
 *
 * Loading the wasm
 * ────────────────
 *   The wasm is fetched from a public URL (default `/gigapdf.wasm`, copied into
 *   `apps/web/public/` by the app's `postinstall`). Call
 *   {@link setPdfEngineWasmUrl} before the first render to override the path
 *   (e.g. a CDN or a versioned asset).
 *
 * Consumers use only `loadDocument` → `renderPageToDataURL` → `dispose`; the
 * previous pdfjs worker/main-thread split and text-masking layer are gone.
 */

import type { GigaPdfEngine, GigaPdfDoc } from "@qrcommunication/gigapdf-lib";

// ─── Shared engine (one wasm instance per page) ──────────────────────────────

let _wasmUrl = "/gigapdf.wasm";
let _enginePromise: Promise<GigaPdfEngine> | null = null;

/**
 * Override where the engine wasm is fetched from (default `/gigapdf.wasm`).
 * Must be called before the first `loadDocument`.
 */
export function setPdfEngineWasmUrl(url: string): void {
  _wasmUrl = url;
  _enginePromise = null; // re-load from the new URL on next use
}

/** Lazily load (and cache) the shared engine. Browser-only — uses `load(url)`. */
async function getEngine(): Promise<GigaPdfEngine> {
  if (!_enginePromise) {
    const { GigaPdfEngine } = await import("@qrcommunication/gigapdf-lib");
    _enginePromise = GigaPdfEngine.load(_wasmUrl);
  }
  return _enginePromise;
}

/**
 * Get the shared, lazily-loaded GigaPDF engine (the single wasm instance used
 * for page rasterisation). Exposed so other editor features — e.g. reading or
 * writing page margins — can open their own short-lived `GigaPdfDoc` on the
 * same engine instead of loading a second wasm module.
 */
export function loadPdfEngine(): Promise<GigaPdfEngine> {
  return getEngine();
}

/** Encode raw PNG bytes as a `data:image/png;base64,…` URL (any size). */
function pngToDataUrl(png: Uint8Array): Promise<string> {
  // TS 5.7+ types the engine's bytes as `Uint8Array<ArrayBufferLike>`, which is
  // not assignable to `BlobPart` (it requires `Uint8Array<ArrayBuffer>` — a
  // SharedArrayBuffer-backed view can't be a Blob part). Re-wrap over a plain
  // ArrayBuffer so the type — and the runtime guarantee — line up.
  const bytes = new Uint8Array(png);
  const blob = new Blob([bytes], { type: "image/png" });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("FileReader error encoding PNG"));
    reader.readAsDataURL(blob);
  });
}

// ─── Public types ────────────────────────────────────────────────────────────

export interface PDFRenderOptions {
  /** Render scale (1 = 72 dpi). HiDPI editor backgrounds pass devicePixelRatio. */
  scale?: number;
  /**
   * Render the page WITHOUT its text (text-free raster) so the editor can paint
   * the REAL editable text as a Fabric overlay on top — direct text editing with
   * 1:1 fidelity, and no per-edit colour mask (which breaks on gradients). All
   * non-text content (vector art, gradients/shadings, images) is still rendered
   * faithfully by the engine. Implemented via the engine's `renderPageNoText`.
   */
  skipText?: boolean;
  /**
   * Engine UNIFIED element indices (from the parse) to OMIT from the raster, so
   * the editor can paint live, editable versions of those elements as visible
   * Fabric overlays on top — the same direct-edit model used for text, extended
   * to vector SHAPES. Implemented via the engine's `renderPageExcluding`. When
   * combined with `skipText`, ALL the page's text runs are excluded too (so the
   * text overlay never doubles the raster), making this a strict superset of the
   * `renderPageNoText` behaviour.
   */
  excludeIndices?: number[];
}

// ─── PDFRenderer ─────────────────────────────────────────────────────────────

/**
 * Renders pages of one PDF document to PNG data URLs using the GigaPDF engine.
 */
export class PDFRenderer {
  private doc: GigaPdfDoc | null = null;

  /** Open a PDF from bytes or a URL. Call before any render. */
  async loadDocument(source: string | ArrayBuffer | Uint8Array): Promise<void> {
    const engine = await getEngine();
    let bytes: Uint8Array;
    if (typeof source === "string") {
      const res = await fetch(source);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else if (source instanceof Uint8Array) {
      bytes = source;
    } else {
      bytes = new Uint8Array(source);
    }
    this.doc?.close();
    this.doc = engine.open(bytes);
  }

  /** Number of pages in the loaded document. */
  getPageCount(): number {
    if (!this.doc) throw new Error("PDF document not loaded");
    return this.doc.pageCount();
  }

  /**
   * Rasterise page `pageNumber` (1-indexed) to a PNG data URL at `scale`.
   */
  async renderPageToDataURL(
    pageNumber: number,
    options: PDFRenderOptions = {},
  ): Promise<string> {
    if (!this.doc) throw new Error("PDF document not loaded");
    const { scale = 1, excludeIndices } = options;
    const skipText = options.skipText ?? false;

    let png: Uint8Array;
    if (excludeIndices && excludeIndices.length > 0) {
      // ⚠ Combining `skipText` with `excludeIndices` is UNSAFE — do not rely on
      // it for a faithful background. Two engine realities break it:
      //   1. `textElements().index` is a TEXT-RUN ordinal (dense 0..N), NOT the
      //      unified `pageElements` index that `renderPageExcluding` consumes.
      //      Unioning it in (to keep the raster text-free) therefore excludes
      //      whatever UNRELATED unified elements happen to share those numbers.
      //   2. `renderPageExcluding` honours `vectorPaths().index` for only SOME
      //      paths on real documents (it drops e.g. index 34 but keeps 101).
      // The net effect blanked whole coloured shape backgrounds, so the editor
      // now keeps shapes IN the raster (`renderPageNoText`) and overlays them as
      // transparent hit-targets instead (see editor `loadPage`). This branch is
      // kept only for callers that pass `excludeIndices` WITHOUT `skipText`
      // (exclude specific elements while leaving text in the raster).
      const indices = skipText
        ? [...this.textRunIndices(pageNumber), ...excludeIndices]
        : excludeIndices;
      png = this.doc.renderPageExcluding(pageNumber, indices, scale);
    } else if (skipText) {
      png = this.doc.renderPageNoText(pageNumber, scale);
    } else {
      png = this.doc.renderPage(pageNumber, scale);
    }
    return pngToDataUrl(png);
  }

  /**
   * Each text run's **text-run ordinal** on `pageNumber` (1-indexed) — the value
   * `replaceText` accepts. NOTE: this is NOT the unified `pageElements` index
   * that `renderPageExcluding` consumes (the two spaces only overlap by
   * coincidence), so do not feed the result into `renderPageExcluding` expecting
   * it to suppress those exact text runs.
   */
  private textRunIndices(pageNumber: number): number[] {
    if (!this.doc) return [];
    return this.doc.textElements(pageNumber).map((t) => t.index);
  }

  /** Close the document and free its engine memory. */
  dispose(): void {
    this.doc?.close();
    this.doc = null;
  }
}

/** Create a new PDF renderer instance. */
export function createPDFRenderer(): PDFRenderer {
  return new PDFRenderer();
}
