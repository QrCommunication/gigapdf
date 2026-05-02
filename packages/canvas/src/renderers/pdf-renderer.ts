/**
 * PDF.js integration for rendering PDF pages to canvas.
 *
 * Architecture — two rendering paths:
 *
 *  1. OffscreenCanvas + Web Worker (PERF-01)
 *     When `canvas.transferControlToOffscreen` is available the rendering work
 *     is offloaded to `pdf-render-worker.ts`, which runs pdfjs in its own
 *     thread and returns an ImageBitmap via postMessage transfer. The main
 *     thread is never blocked during the 200-800ms render pass.
 *
 *  2. Main-thread fallback (legacy)
 *     Browsers that do not support OffscreenCanvas (Firefox < 105, Safari <
 *     16.4, IE, older Chromium on mobile) use the original synchronous path
 *     unchanged. Feature detection is the sole gate — no UA sniffing.
 *
 * Worker lifecycle
 * ────────────────
 *   - Created lazily on the first `renderPage` call.
 *   - Shared by all PDFRenderer instances in the same JS context.
 *   - Terminated via `PDFRenderer.terminateSharedWorker()` or automatically
 *     when the last renderer is disposed (ref-counted).
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PageObject } from "@giga-pdf/types";

type PdfPageForMask = {
  getViewport: (opts: { scale: number }) => { transform: number[]; height: number };
  getTextContent: (opts?: unknown) => Promise<{
    items: Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    }>;
  }>;
};

/**
 * Overlay opaque white rectangles on all text regions of a rendered PDF page,
 * so that the Fabric editable text overlay is the only visible text on the canvas.
 *
 * Uses viewport.transform composition to compute each text item's absolute
 * bounding box in canvas pixel space, accounting for page rotation, MediaBox,
 * and render scale automatically.
 */
async function maskTextLayer(
  page: PdfPageForMask,
  context: CanvasRenderingContext2D,
  viewport: { transform: number[]; height: number },
): Promise<void> {
  try {
    const textContent = await page.getTextContent();
    context.save();
    context.fillStyle = "#ffffff";
    for (const item of textContent.items) {
      if (!item.str || !item.transform) continue;

      // Combined = viewport.transform · item.transform. Maps text-local
      // space to canvas pixel space, including any rotation pdfjs
      // applied via /Rotate. Util.transform(A, B) computes A·B.
      const combined = pdfjsLib.Util.transform(
        viewport.transform,
        item.transform as number[],
      ) as number[];
      const a = combined[0] ?? 1;
      const b = combined[1] ?? 0;
      const c = combined[2] ?? 0;
      const d = combined[3] ?? 1;
      const e = combined[4] ?? 0;
      const f = combined[5] ?? 0;

      const fontSize = Math.sqrt(a * a + b * b);
      if (fontSize < 0.1) continue;

      // item.width is in PDF user-space units (points), already scaled by
      // the font size — NOT in text-local units. To pass it through the
      // combined matrix (which also encodes the fontSize scale), we need
      // to divide by fontSize so we're expressing width in "text-local"
      // units: [0, itemWidth/fontSize]. Otherwise `b * itemWidth` explodes
      // (for rotated text, b = fontSize so b * 288 = 5184 — way off-canvas).
      const itemWidth = (item.width ?? 0) > 0
        ? (item.width as number)
        : fontSize * (item.str.length || 1) * 0.5;
      const localWidth = itemWidth / fontSize;

      // Enumerate corners spanning the glyph bounds in BOTH Y conventions
      // (ascender positive AND negative) so the AABB covers the run
      // regardless of pdfjs's text matrix orientation quirks.
      const corners: Array<[number, number]> = [
        [0, -0.85],
        [localWidth, -0.85],
        [localWidth, 0.85],
        [0, 0.85],
        [0, -0.3],
        [localWidth, -0.3],
        [localWidth, 0.3],
        [0, 0.3],
      ];
      let minPx = Infinity;
      let minPy = Infinity;
      let maxPx = -Infinity;
      let maxPy = -Infinity;
      for (const [lx, ly] of corners) {
        const px = a * lx + c * ly + e;
        const py = b * lx + d * ly + f;
        if (px < minPx) minPx = px;
        if (py < minPy) minPy = py;
        if (px > maxPx) maxPx = px;
        if (py > maxPy) maxPy = py;
      }
      // Padding scales with font size to catch:
      //   - anti-aliasing fringes (always)
      //   - shadow/relief effects: PDFs that render the same glyph
      //     multiple times with a small offset. textContent collapses
      //     them to one item but the bg bitmap still shows the offset
      //     copies. Mask 25% of the font size on the bottom and 10% on
      //     other edges so a typical 24pt title (6 px shadow drop)
      //     stays covered.
      const padX = Math.max(1, fontSize * 0.1);
      const padTop = Math.max(1, fontSize * 0.1);
      const padBottom = Math.max(2, fontSize * 0.25);
      context.fillRect(
        minPx - padX,
        minPy - padTop,
        maxPx - minPx + padX * 2,
        maxPy - minPy + padTop + padBottom,
      );
    }
    context.restore();
  } catch {
    // If text extraction fails, leave the canvas as-is (won't break rendering).
  }
}

/**
 * Mask only DUPLICATE text runs on the rendered PDF, preserving the first
 * occurrence of each (content + fontSize + position-cluster). This is a
 * surgical version of maskTextLayer used when the PDF source contains
 * duplicates baked in by prior save-loops — e.g. Fabric IText overlays
 * re-injected on top of the native glyphs producing a "shadowed" look.
 *
 * Heuristic mirrors the scene-graph dedupe in editor-canvas.tsx
 * (renderElementsOverlay): two runs collapse into one when they share
 * content + rounded fontSize AND either:
 *   - sit within 2px on both axes (shadow/outline twin), OR
 *   - share the same X (≤3px) regardless of Y (save-loop vertical stack).
 *
 * Same-content runs that differ on X are kept (legitimate cross-line
 * repeats like "RONY LICHA" appearing twice on an address block).
 */
async function maskDuplicateText(
  page: PdfPageForMask,
  context: CanvasRenderingContext2D,
  viewport: { transform: number[]; height: number },
): Promise<void> {
  try {
    const textContent = await page.getTextContent();
    type Item = { str: string; transform: number[]; width?: number };
    type Seen = { x: number; y: number };
    const seen = new Map<string, Seen[]>();

    context.save();
    context.fillStyle = "#ffffff";
    for (const raw of textContent.items as Item[]) {
      if (!raw.str || !raw.transform) continue;
      const tx = raw.transform[4] ?? 0;
      const ty = raw.transform[5] ?? 0;
      const fontSize = Math.sqrt(
        (raw.transform[0] ?? 1) * (raw.transform[0] ?? 1) +
          (raw.transform[1] ?? 0) * (raw.transform[1] ?? 0),
      );
      const sig = `${raw.str}|${Math.round(fontSize)}`;
      const positions = seen.get(sig);
      const here: Seen = { x: tx, y: ty };

      if (!positions) {
        seen.set(sig, [here]);
        continue;
      }

      const isDuplicate = positions.some((p) => {
        const dx = Math.abs(p.x - here.x);
        const dy = Math.abs(p.y - here.y);
        // Two patterns to catch:
        //   1. shadowOverlap: stacked twin within 2px on both axes
        //      (vector outline + fallback trace at sub-pixel offset)
        //   2. saveLoopStack: same column (≤2px X) AND close Y (≤fontSize)
        //      (Fabric IText overlay baked back into the PDF on top of the
        //      native glyph — typically offset by half a line height)
        //
        // We deliberately bound dy to roughly one line so that legitimate
        // table values like "86,77€" / "101,95€" appearing on multiple rows
        // (same X, Y separated by full row heights) are NOT collapsed.
        const lineGuess = Math.max(fontSize * 1.6, 12);
        return (
          (dx <= 2 && dy <= 2) ||
          (dx <= 2 && dy <= lineGuess)
        );
      });

      if (!isDuplicate) {
        positions.push(here);
        continue;
      }

      // Mask this duplicate. Reuse the same AABB-on-corners approach as
      // maskTextLayer so rotated/transformed text is fully covered.
      const combined = pdfjsLib.Util.transform(
        viewport.transform,
        raw.transform,
      ) as number[];
      const a = combined[0] ?? 1;
      const b = combined[1] ?? 0;
      const c = combined[2] ?? 0;
      const d = combined[3] ?? 1;
      const e = combined[4] ?? 0;
      const f = combined[5] ?? 0;
      const fs = Math.sqrt(a * a + b * b);
      if (fs < 0.1) continue;
      const itemWidth = (raw.width ?? 0) > 0
        ? (raw.width as number)
        : fs * (raw.str.length || 1) * 0.5;
      const localWidth = itemWidth / fs;

      const corners: Array<[number, number]> = [
        [0, -0.85],
        [localWidth, -0.85],
        [localWidth, 0.85],
        [0, 0.85],
        [0, -0.3],
        [localWidth, -0.3],
        [localWidth, 0.3],
        [0, 0.3],
      ];
      let minPx = Infinity;
      let minPy = Infinity;
      let maxPx = -Infinity;
      let maxPy = -Infinity;
      for (const [lx, ly] of corners) {
        const px = a * lx + c * ly + e;
        const py = b * lx + d * ly + f;
        if (px < minPx) minPx = px;
        if (py < minPy) minPy = py;
        if (px > maxPx) maxPx = px;
        if (py > maxPy) maxPy = py;
      }
      const padX = Math.max(1, fs * 0.1);
      const padTop = Math.max(1, fs * 0.1);
      const padBottom = Math.max(2, fs * 0.25);
      context.fillRect(
        minPx - padX,
        minPy - padTop,
        maxPx - minPx + padX * 2,
        maxPy - minPy + padTop + padBottom,
      );
    }
    context.restore();
  } catch {
    // If text extraction fails, leave the canvas as-is.
  }
}

// ─── pdfjs worker for the main-thread fallback path ──────────────────────────

// Configure PDF.js worker — use local copy served from /pdf-worker/
// to avoid CDN dependency (FRONT-01: CDN failure would break all PDF rendering).
// The worker file is copied at postinstall time from node_modules/pdfjs-dist/build/
// to apps/web/public/pdf-worker/ via the "postinstall" script in apps/web/package.json.
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf-worker/pdf.worker.min.mjs";
}

// ─── Feature detection ───────────────────────────────────────────────────────

/**
 * Returns true when the current browser fully supports the OffscreenCanvas
 * rendering path:
 *   - OffscreenCanvas constructor exists (Chrome 69+, Firefox 105+, Safari 16.4+)
 *   - Worker constructor exists (can spawn a DedicatedWorker)
 *   - OffscreenCanvas.convertToBlob is available (needed for renderPageToDataURL)
 *
 * Note: we do NOT require transferControlToOffscreen. We create standalone
 * OffscreenCanvas instances inside the worker instead, which is cleaner because
 * it avoids permanently transferring control of the caller's HTMLCanvasElement.
 *
 * This check is memoized — the result never changes during a page session.
 */
let _offscreenSupported: boolean | null = null;

export function isOffscreenCanvasSupported(): boolean {
  if (_offscreenSupported !== null) return _offscreenSupported;

  // TEMPORARY: worker path disabled until Turbopack worker resolution is
  // confirmed in Next.js 16 for pre-built packages. Main-thread fallback
  // remains functional. Re-enable by restoring the full feature detection
  // once `new Worker(new URL('./pdf-render-worker.mjs', ...))` resolution
  // is validated end-to-end.
  _offscreenSupported = false;

  return _offscreenSupported;
}

// ─── Worker message types ─────────────────────────────────────────────────────

interface LoadRequest {
  type: "LOAD";
  /** Unique request id — identifies this message in the response. */
  id: string;
  /** Stable key for the document inside the worker cache (= instanceId). */
  docKey: string;
  source: ArrayBuffer | string;
}

interface RenderRequest {
  type: "RENDER";
  id: string;
  docKey: string;
  pageNumber: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  offscreen: OffscreenCanvas;
}

interface GetDimensionsRequest {
  type: "GET_DIMENSIONS";
  id: string;
  docKey: string;
  pageNumber: number;
  scale: number;
}

interface DisposeRequest {
  type: "DISPOSE";
  id: string;
  docKey: string;
}

type WorkerRequest = LoadRequest | RenderRequest | GetDimensionsRequest | DisposeRequest;

interface LoadedResponse {
  type: "LOADED";
  id: string;
  numPages: number;
}

interface RenderedResponse {
  type: "RENDERED";
  id: string;
  bitmap: ImageBitmap;
}

interface DimensionsResponse {
  type: "DIMENSIONS";
  id: string;
  width: number;
  height: number;
}

interface DisposedResponse {
  type: "DISPOSED";
  id: string;
}

interface ErrorResponse {
  type: "ERROR";
  id: string;
  message: string;
}

type WorkerResponse =
  | LoadedResponse
  | RenderedResponse
  | DimensionsResponse
  | DisposedResponse
  | ErrorResponse;

// ─── Shared worker singleton ─────────────────────────────────────────────────

/**
 * A single Web Worker is shared across all PDFRenderer instances in the same
 * JS context. It is ref-counted so that it is terminated only when every
 * renderer has been disposed.
 */

// Each pending message maps a request `id` to its resolve/reject pair.
const pendingCallbacks = new Map<
  string,
  { resolve: (value: WorkerResponse) => void; reject: (reason: Error) => void }
>();

let sharedWorker: Worker | null = null;
let workerRefCount = 0;
let messageIdCounter = 0;

// Worker path is disabled for now (see `isOffscreenCanvasSupported` above for
// rationale). The function is kept so the rest of the codebase compiles but
// it never allocates a worker. To re-enable, restore the body to use
// `new Worker(new URL("./pdf-render-worker.mjs", import.meta.url), { type: "module" })`
// once Turbopack worker resolution is validated for pre-built packages.
function getOrCreateWorker(): Worker | null {
  return null;
}

function releaseWorker(): void {
  workerRefCount = Math.max(0, workerRefCount - 1);
  if (workerRefCount === 0 && sharedWorker) {
    sharedWorker.terminate();
    sharedWorker = null;
  }
}

function nextMessageId(): string {
  return String(++messageIdCounter);
}

/**
 * Send a message to the shared worker and await the response identified by id.
 */
function workerRpc<T extends WorkerResponse>(
  request: WorkerRequest,
  transfer?: Transferable[]
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = getOrCreateWorker();
    if (!worker) {
      pendingCallbacks.delete(request.id);
      reject(new Error("Worker loader could not be created"));
      return;
    }
    pendingCallbacks.set(request.id, {
      resolve: resolve as (value: WorkerResponse) => void,
      reject,
    });

    if (transfer && transfer.length > 0) {
      worker.postMessage(request, transfer);
    } else {
      worker.postMessage(request);
    }
  });
}

/**
 * Forcefully terminate the shared worker regardless of the ref count.
 * Use only in tests or when unmounting the entire application.
 */
export function terminateSharedPdfWorker(): void {
  if (sharedWorker) {
    for (const [id, { reject }] of pendingCallbacks) {
      reject(new Error("PDF render worker was terminated"));
      pendingCallbacks.delete(id);
    }
    sharedWorker.terminate();
    sharedWorker = null;
    workerRefCount = 0;
  }
}

// ─── Public interfaces ───────────────────────────────────────────────────────

export interface PDFRenderOptions {
  scale?: number;
  rotation?: 0 | 90 | 180 | 270;
  renderAnnotations?: boolean;
  renderTextLayer?: boolean;
  /**
   * When true, text regions are masked with white rectangles after rendering.
   * Useful for editor backgrounds where the text layer is handled separately
   * by an overlay (e.g. Fabric.js). Default: false.
   */
  maskText?: boolean;
  /**
   * When true, only DUPLICATE text runs are masked after rendering. The first
   * occurrence of each (string, fontSize, position-cluster) is kept; subsequent
   * stacked copies are painted over with white. This recovers the original
   * 1:1 visual on PDFs that accumulated text duplicates from prior save-loops
   * (where Fabric IText overlays were baked back into the PDF on top of the
   * native glyphs). Cheap to compute (one getTextContent pass). Default: false.
   */
  dedupeText?: boolean;
}

export interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  destroy(): void;
}

export interface PDFPageProxy {
  pageNumber: number;
  rotate: number;
  view: number[];
  getViewport(params: { scale: number; rotation?: number }): PDFPageViewport;
  render(params: PDFRenderParams): PDFRenderTask;
  getTextContent(): Promise<unknown>;
  getAnnotations(): Promise<unknown[]>;
}

export interface PDFPageViewport {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  transform: number[];
  clone(params?: { scale?: number; rotation?: number }): PDFPageViewport;
}

export interface PDFRenderParams {
  canvasContext: CanvasRenderingContext2D;
  viewport: PDFPageViewport;
  renderInteractiveForms?: boolean;
}

export interface PDFRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

// ─── PDFRenderer ─────────────────────────────────────────────────────────────

/**
 * PDF renderer class.
 *
 * When OffscreenCanvas is supported the renderer delegates page rendering to
 * the shared PDF render worker (off the main thread). Otherwise it falls back
 * to the original synchronous pdfjs rendering on the main thread.
 */
export class PDFRenderer {
  /** Unique id for this instance — used to key documents inside the worker. */
  private readonly instanceId: string;

  // ── Main-thread fallback state ──
  private pdfDoc: PDFDocumentProxy | null = null;
  private pageCache: Map<number, PDFPageProxy> = new Map();

  // ── Worker-path state ──
  private workerNumPages: number | null = null;
  private workerLoaded = false;

  constructor() {
    this.instanceId = `pdfr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // ── Document loading ────────────────────────────────────────────────────────

  /**
   * Load PDF document from URL or ArrayBuffer.
   *
   * Security hardening (SEC-OWASP-03) — prevents JS execution from malicious PDFs:
   * - isEvalSupported: false  blocks dynamic code execution in PDF scripts
   * - enableXfa: false        disables XFA forms (they can run PDF-embedded scripts)
   * - stopAtErrors: true      aborts parsing on malformed or suspicious structure
   * - disableAutoFetch: true  prevents the PDF from triggering background network requests
   * - disableFontFace: false  custom fonts are preserved (required for Wave-2 font support)
   */
  async loadDocument(source: string | ArrayBuffer): Promise<void> {
    if (isOffscreenCanvasSupported()) {
      await this._workerLoadDocument(source);
    } else {
      await this._mainThreadLoadDocument(source);
    }
  }

  private async _workerLoadDocument(
    source: string | ArrayBuffer
  ): Promise<void> {
    // Register this renderer's interest in the shared worker
    workerRefCount++;

    // For ArrayBuffer we must transfer ownership to avoid cloning a potentially
    // large binary (saves memory and time). A clone is kept for the fallback.
    const msgId = `${this.instanceId}-load-${nextMessageId()}`;

    let response: WorkerResponse;
    if (source instanceof ArrayBuffer) {
      // We transfer the ArrayBuffer to the worker. After transfer `source` is
      // detached and unusable on the main thread — which is intentional because
      // the main thread does not need it once the worker has parsed the document.
      response = await workerRpc<LoadedResponse>(
        { type: "LOAD", id: msgId, docKey: this.instanceId, source },
        [source]
      );
    } else {
      response = await workerRpc<LoadedResponse>({
        type: "LOAD",
        id: msgId,
        docKey: this.instanceId,
        source,
      });
    }

    if (response.type === "LOADED") {
      this.workerNumPages = response.numPages;
      this.workerLoaded = true;
    } else {
      workerRefCount = Math.max(0, workerRefCount - 1);
      throw new Error(`Failed to load PDF in worker: unexpected response type`);
    }
  }

  private async _mainThreadLoadDocument(
    source: string | ArrayBuffer
  ): Promise<void> {
    try {
      const loadingTask = pdfjsLib.getDocument({
        data: source instanceof ArrayBuffer ? source : undefined,
        url: typeof source === "string" ? source : undefined,
        isEvalSupported: false,
        enableXfa: false,
        stopAtErrors: true,
        disableAutoFetch: true,
        disableFontFace: false,
      });
      this.pdfDoc = (await loadingTask.promise) as unknown as PDFDocumentProxy;
    } catch (error) {
      throw new Error(`Failed to load PDF document: ${error}`);
    }
  }

  // ── Page count ──────────────────────────────────────────────────────────────

  getPageCount(): number {
    if (this.workerLoaded) {
      if (this.workerNumPages === null) {
        throw new Error("PDF document not loaded in worker");
      }
      return this.workerNumPages;
    }

    if (!this.pdfDoc) {
      throw new Error("PDF document not loaded");
    }
    return this.pdfDoc.numPages;
  }

  // ── Page proxy (main-thread fallback only) ──────────────────────────────────

  async getPage(pageNumber: number): Promise<PDFPageProxy> {
    if (!this.pdfDoc) {
      throw new Error("PDF document not loaded (main-thread path)");
    }
    if (this.pageCache.has(pageNumber)) {
      return this.pageCache.get(pageNumber)!;
    }
    const page = await this.pdfDoc.getPage(pageNumber);
    this.pageCache.set(pageNumber, page);
    return page;
  }

  // ── Core render ─────────────────────────────────────────────────────────────

  /**
   * Render a PDF page onto an HTMLCanvasElement.
   *
   * Worker path (OffscreenCanvas supported):
   *   1. Creates a fresh OffscreenCanvas (never attached to the DOM canvas).
   *   2. Sends it to the shared worker which draws with pdfjs off the UI thread.
   *   3. The worker returns an ImageBitmap (zero-copy transfer).
   *   4. The main thread stamps the bitmap onto `canvas` via the 2d context.
   *   5. Adjusts canvas dimensions to match the rendered viewport.
   *
   * We intentionally avoid `canvas.transferControlToOffscreen()` because that
   * permanently transfers control — the canvas cannot be used again from the
   * main thread (e.g. for toDataURL, multiple re-renders, or Fabric.js). Using
   * a fresh OffscreenCanvas per render is equally off-thread while keeping the
   * original HTMLCanvasElement fully usable.
   *
   * Fallback path: renders synchronously on the main thread via pdfjs.
   */
  async renderPage(
    canvas: HTMLCanvasElement,
    pageNumber: number,
    options: PDFRenderOptions = {}
  ): Promise<void> {
    const { scale = 1, rotation, renderAnnotations = false, maskText = false, dedupeText = false } = options;

    if (this.workerLoaded) {
      await this._workerRenderPage(canvas, pageNumber, scale, rotation as 0 | 90 | 180 | 270 | undefined);
    } else {
      await this._mainThreadRenderPage(canvas, pageNumber, scale, rotation as 0 | 90 | 180 | 270 | undefined, renderAnnotations, maskText, dedupeText);
    }
  }

  private async _workerRenderPage(
    canvas: HTMLCanvasElement,
    pageNumber: number,
    scale: number,
    rotation: 0 | 90 | 180 | 270 | undefined,
  ): Promise<void> {
    const bitmap = await this._renderToBitmap(pageNumber, scale, rotation);

    // Resize the HTMLCanvasElement to match the rendered bitmap
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    // Stamp the bitmap onto the canvas via the 2d context
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      throw new Error("Failed to get 2d context from HTMLCanvasElement");
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  }

  /**
   * Core worker render primitive — returns an ImageBitmap rendered off-thread.
   * Used by both renderPage and renderPageToDataURL.
   */
  private async _renderToBitmap(
    pageNumber: number,
    scale: number,
    rotation: 0 | 90 | 180 | 270 | undefined,
  ): Promise<ImageBitmap> {
    // A 1×1 OffscreenCanvas is the cheapest placeholder; the worker resizes it
    // to the correct viewport dimensions before drawing.
    const offscreen = new OffscreenCanvas(1, 1);
    const msgId = `${this.instanceId}-render-${pageNumber}-${nextMessageId()}`;

    const response = await workerRpc<RenderedResponse>(
      {
        type: "RENDER",
        id: msgId,
        docKey: this.instanceId,
        pageNumber,
        scale,
        rotation,
        offscreen,
      },
      [offscreen]
    );

    if (response.type !== "RENDERED") {
      throw new Error("Unexpected response type from render worker");
    }
    return response.bitmap;
  }

  private async _mainThreadRenderPage(
    canvas: HTMLCanvasElement,
    pageNumber: number,
    scale: number,
    rotation: 0 | 90 | 180 | 270 | undefined,
    renderAnnotations: boolean,
    maskText = false,
    dedupeText = false,
  ): Promise<void> {
    const page = await this.getPage(pageNumber);
    // Passing `rotation: 0` to getViewport OVERRIDES the PDF's native /Rotate
    // flag. Omit the param when the caller didn't specify a rotation so
    // rotated pages render as the user expects (thumbnails, editor bg).
    const viewport =
      rotation === undefined
        ? page.getViewport({ scale })
        : page.getViewport({ scale, rotation });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to get canvas context");
    }

    context.clearRect(0, 0, canvas.width, canvas.height);

    const renderTask = page.render({
      canvasContext: context,
      canvas,
      viewport,
      renderInteractiveForms: renderAnnotations,
    } as Parameters<typeof page.render>[0]);
    await renderTask.promise;

    // Optionally mask text from the rendered image so the Fabric overlay is the
    // only visible text. Only used by the editor background; disabled for thumbnails.
    if (maskText) {
      await maskTextLayer(page, context, viewport);
    } else if (dedupeText) {
      // Surgical mask: paint over only DUPLICATE glyph runs accumulated by
      // prior save-loops, preserving the original native rendering of
      // unique text. Cheaper visually than full maskText (no need for Fabric
      // overlays to be visible) and avoids the browser/PDF font rendering
      // gap inherent to maskText: true.
      await maskDuplicateText(page, context, viewport);
    }
  }

  // ── renderPageToDataURL ──────────────────────────────────────────────────────

  /**
   * Render PDF page to a PNG data URL.
   *
   * Worker path: renders off-thread, gets an ImageBitmap, draws it onto an
   * OffscreenCanvas and converts to blob → data URL. The DOM is never touched.
   *
   * Fallback path: creates a temporary HTMLCanvasElement on the main thread and
   * calls toDataURL() as before.
   */
  async renderPageToDataURL(
    pageNumber: number,
    options: PDFRenderOptions = {}
  ): Promise<string> {
    const { scale = 1, rotation } = options;

    if (this.workerLoaded) {
      const bitmap = await this._renderToBitmap(
        pageNumber,
        scale,
        rotation as 0 | 90 | 180 | 270 | undefined,
      );

      // OffscreenCanvas.convertToBlob() is available in all browsers that
      // support OffscreenCanvas (Chrome 69+, Firefox 105+, Safari 16.4+).
      const bridge = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = bridge.getContext("2d");
      if (!ctx) {
        bitmap.close();
        throw new Error("Cannot get 2d context from bridge OffscreenCanvas");
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const blob = await bridge.convertToBlob({ type: "image/png" });
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () =>
          reject(new Error("FileReader error in renderPageToDataURL"));
        reader.readAsDataURL(blob);
      });
    }

    // Fallback: main-thread HTMLCanvasElement path
    const canvas = document.createElement("canvas");
    await this._mainThreadRenderPage(
      canvas,
      pageNumber,
      scale,
      rotation as 0 | 90 | 180 | 270,
      options.renderAnnotations ?? false,
      options.maskText ?? false,
      options.dedupeText ?? false,
    );
    return canvas.toDataURL("image/png");
  }

  // ── Dimension helpers ────────────────────────────────────────────────────────

  async getPageDimensions(
    pageNumber: number,
    scale: number = 1
  ): Promise<{ width: number; height: number }> {
    if (this.workerLoaded) {
      // Ask the worker for page dimensions — avoids any main-thread pdfjs work.
      const msgId = `${this.instanceId}-dims-${pageNumber}-${nextMessageId()}`;
      const response = await workerRpc<DimensionsResponse>({
        type: "GET_DIMENSIONS",
        id: msgId,
        docKey: this.instanceId,
        pageNumber,
        scale,
      });
      if (response.type !== "DIMENSIONS") {
        throw new Error("Unexpected response from worker for GET_DIMENSIONS");
      }
      return { width: response.width, height: response.height };
    }

    // Main-thread fallback path
    if (!this.pdfDoc) {
      throw new Error("PDF document not loaded");
    }
    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    return { width: viewport.width, height: viewport.height };
  }

  // ── Text and annotation extraction ──────────────────────────────────────────

  /**
   * Extract text content from a page.
   * Only available when the main-thread fallback path is active.
   * In the worker path, use the pdf-engine package for text extraction.
   */
  async getPageText(pageNumber: number): Promise<string> {
    if (this.workerLoaded) {
      throw new Error(
        "getPageText is not available in the OffscreenCanvas worker path. " +
          "Use @giga-pdf/pdf-engine for text extraction."
      );
    }
    const page = await this.getPage(pageNumber);
    const textContent = await page.getTextContent();
    return (textContent as { items: Array<{ str: string }> }).items
      .map((item) => item.str)
      .join(" ");
  }

  /**
   * Extract annotations from a page.
   * Only available when the main-thread fallback path is active.
   */
  async getPageAnnotations(pageNumber: number): Promise<unknown[]> {
    if (this.workerLoaded) {
      throw new Error(
        "getPageAnnotations is not available in the OffscreenCanvas worker path. " +
          "Use @giga-pdf/pdf-engine for annotation extraction."
      );
    }
    const page = await this.getPage(pageNumber);
    return page.getAnnotations();
  }

  // ── Thumbnail ────────────────────────────────────────────────────────────────

  async createThumbnail(
    pageNumber: number,
    maxWidth: number,
    maxHeight: number
  ): Promise<string> {
    const dims = await this.getPageDimensions(pageNumber, 1);
    const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height);
    return this.renderPageToDataURL(pageNumber, { scale });
  }

  // ── Render page object ───────────────────────────────────────────────────────

  async renderPageObject(
    canvas: HTMLCanvasElement,
    pageObject: PageObject,
    scale: number = 1
  ): Promise<void> {
    await this.renderPage(canvas, pageObject.pageNumber, {
      scale,
      rotation: pageObject.dimensions.rotation,
    });
  }

  // ── Dispose ──────────────────────────────────────────────────────────────────

  /**
   * Dispose of this renderer and release resources.
   *
   * For the worker path: sends DISPOSE to the worker to free the parsed
   * document from worker memory, then decrements the shared worker ref count.
   * For the main-thread path: destroys the pdfjs document directly.
   */
  dispose(): void {
    this.pageCache.clear();

    if (this.workerLoaded) {
      const msgId = `${this.instanceId}-dispose-${nextMessageId()}`;
      // Fire-and-forget — we don't await the DISPOSED response
      workerRpc({ type: "DISPOSE", id: msgId, docKey: this.instanceId }).catch(() => {
        // Ignore errors during dispose (worker may already be shutting down)
      });
      this.workerLoaded = false;
      this.workerNumPages = null;
      releaseWorker();
    }

    if (this.pdfDoc) {
      this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a new PDF renderer instance.
 * The renderer will automatically use OffscreenCanvas + Worker when available.
 */
export function createPDFRenderer(): PDFRenderer {
  return new PDFRenderer();
}
