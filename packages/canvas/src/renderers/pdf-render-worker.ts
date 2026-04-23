/**
 * PDF render worker — runs inside a DedicatedWorker.
 *
 * Responsibilities:
 *  - Parse the PDF document with pdfjs-dist (INSIDE the worker, separate from
 *    the pdfjs internal parsing worker which is also a worker; these are two
 *    different workers that cooperate).
 *  - Render pages onto an OffscreenCanvas transferred from the main thread.
 *  - Return the rendered ImageBitmap to the main thread as a transferable so
 *    that zero copies are involved.
 *
 * Message protocol
 * ─────────────────
 * Main → Worker  (WorkerRequest)
 *   { type: 'LOAD',   id, source: ArrayBuffer | string }
 *   { type: 'RENDER', id, pageNumber, scale, rotation, offscreen: OffscreenCanvas }
 *   { type: 'DISPOSE', id }
 *
 * Worker → Main  (WorkerResponse)
 *   { type: 'LOADED',     id, numPages }
 *   { type: 'RENDERED',   id, bitmap: ImageBitmap }
 *   { type: 'DISPOSED',   id }
 *   { type: 'ERROR',      id, message }
 *
 * NOTE: pdfjs-dist must NOT configure GlobalWorkerOptions.workerSrc inside a
 * Worker context — the workerSrc path is for the HTML document scope only. In
 * Worker scope we set workerSrc = '' to force inline (fake-worker) mode, which
 * runs the pdfjs parsing logic synchronously in this same worker thread.
 */

import * as pdfjsLib from "pdfjs-dist";

// ─── Type declarations ────────────────────────────────────────────────────────

interface LoadRequest {
  type: "LOAD";
  /** Unique id for this request — used to match the LOADED response. */
  id: string;
  /** Stable key identifying this PDFRenderer instance's document in the cache. */
  docKey: string;
  source: ArrayBuffer | string;
}

interface RenderRequest {
  type: "RENDER";
  /** Unique id for this request — used to match the RENDERED response. */
  id: string;
  /** Identifies which cached document to render from. */
  docKey: string;
  pageNumber: number;
  scale: number;
  /** Optional override; when undefined the PDF's native /Rotate flag is used. */
  rotation: 0 | 90 | 180 | 270 | undefined;
  offscreen: OffscreenCanvas;
}

interface GetDimensionsRequest {
  type: "GET_DIMENSIONS";
  /** Unique id for this request — used to match the DIMENSIONS response. */
  id: string;
  /** Identifies which cached document to query. */
  docKey: string;
  pageNumber: number;
  scale: number;
}

interface DisposeRequest {
  type: "DISPOSE";
  /** Unique id for this request — used to match the DISPOSED response. */
  id: string;
  /** Identifies which cached document to destroy. */
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

// ─── pdfjs inline worker setup ───────────────────────────────────────────────

// Inside a Worker we cannot load another Worker via a URL resolved from the
// main document. Setting workerSrc to empty string makes pdfjs fall back to
// its own fake-worker (synchronous) implementation that runs in THIS worker.
// This is the correct pattern for "worker of a worker" scenarios.
pdfjsLib.GlobalWorkerOptions.workerSrc = "";

// ─── Document cache ──────────────────────────────────────────────────────────

const docCache = new Map<string, pdfjsLib.PDFDocumentProxy>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function reply(response: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    self.postMessage(response, transfer);
  } else {
    self.postMessage(response);
  }
}

function replyError(id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  reply({ type: "ERROR", id, message });
}

// ─── Message handler ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  if (req.type === "LOAD") {
    try {
      // Destroy any previously loaded document for this docKey
      const existing = docCache.get(req.docKey);
      if (existing) {
        existing.destroy();
        docCache.delete(req.docKey);
      }

      // Security hardening — identical to the main-thread PDFRenderer config
      const loadingTask = pdfjsLib.getDocument({
        data: req.source instanceof ArrayBuffer ? req.source : undefined,
        url: typeof req.source === "string" ? req.source : undefined,
        isEvalSupported: false,
        enableXfa: false,
        stopAtErrors: true,
        disableAutoFetch: true,
        disableFontFace: false,
        // fontExtraProperties: true allows fonts to be embedded and resolved
        // inside the worker via the data-driven FontFace path — which works in
        // DedicatedWorkerGlobalScope (FontFaceSet is available since Chrome 87+).
        fontExtraProperties: true,
      });

      const pdf = await loadingTask.promise;
      docCache.set(req.docKey, pdf);
      reply({ type: "LOADED", id: req.id, numPages: pdf.numPages });
    } catch (err) {
      replyError(req.id, err);
    }
    return;
  }

  if (req.type === "RENDER") {
    const pdf = docCache.get(req.docKey);
    if (!pdf) {
      replyError(req.id, `PDF document not loaded in worker (docKey: ${req.docKey})`);
      return;
    }

    try {
      const page = await pdf.getPage(req.pageNumber);
      // Passing rotation:0 would override the PDF's /Rotate flag. When the
      // caller omitted rotation, let pdfjs use the PDF's native rotation.
      const viewport =
        req.rotation === undefined
          ? page.getViewport({ scale: req.scale })
          : page.getViewport({ scale: req.scale, rotation: req.rotation });

      // Resize the transferred OffscreenCanvas to match the viewport
      req.offscreen.width = viewport.width;
      req.offscreen.height = viewport.height;

      const context = req.offscreen.getContext("2d");
      if (!context) {
        throw new Error("Failed to obtain 2D context from OffscreenCanvas");
      }

      context.clearRect(0, 0, req.offscreen.width, req.offscreen.height);

      const renderTask = page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        canvas: req.offscreen as unknown as HTMLCanvasElement,
        viewport,
        renderInteractiveForms: false,
      } as Parameters<typeof page.render>[0]);
      await renderTask.promise;

      // Transfer the pixels back as an ImageBitmap (zero-copy transfer)
      const bitmap = req.offscreen.transferToImageBitmap();
      reply({ type: "RENDERED", id: req.id, bitmap }, [bitmap]);
    } catch (err) {
      replyError(req.id, err);
    }
    return;
  }

  if (req.type === "GET_DIMENSIONS") {
    const pdf = docCache.get(req.docKey);
    if (!pdf) {
      replyError(req.id, `PDF document not loaded in worker (docKey: ${req.docKey})`);
      return;
    }
    try {
      const page = await pdf.getPage(req.pageNumber);
      const viewport = page.getViewport({ scale: req.scale });
      reply({
        type: "DIMENSIONS",
        id: req.id,
        width: viewport.width,
        height: viewport.height,
      });
    } catch (err) {
      replyError(req.id, err);
    }
    return;
  }

  if (req.type === "DISPOSE") {
    const pdf = docCache.get(req.docKey);
    if (pdf) {
      pdf.destroy();
      docCache.delete(req.docKey);
    }
    reply({ type: "DISPOSED", id: req.id });
    return;
  }
};
