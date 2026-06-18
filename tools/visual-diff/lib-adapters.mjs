// Shared adapters for the visual-diff harness.
//
// Centralises every interaction with:
//   - the GigaPDF home engine  (@qrcommunication/gigapdf-lib)
//   - the reference renderer    (pdfjs-dist 5.7.x)
//   - the Node canvas backend   (@napi-rs/canvas, fallback `canvas`)
//   - PNG decoding              (pngjs)
//
// Everything is imported by absolute path because the lib package is
// `"type":"module"` and we want zero ambiguity about which copy is loaded.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const APP_ROOT = "/home/rony/Projets/gigapdf";
const require = createRequire(path.join(APP_ROOT, "package.json"));

const LIB_ENTRY = path.join(APP_ROOT, "node_modules/@qrcommunication/gigapdf-lib/dist/index.js");
const PDFJS_ENTRY = path.join(APP_ROOT, "node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const PDFJS_WORKER = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
const PDFJS_STD_FONTS = path.join(APP_ROOT, "node_modules/pdfjs-dist/standard_fonts/");
const PDFJS_CMAPS = path.join(APP_ROOT, "node_modules/pdfjs-dist/cmaps/");

// ---------------------------------------------------------------------------
// pdfjs noise: getOperatorList / render emit benign console warnings
// (missing standardFontDataUrl on some docs, fake-worker notes, etc.).
// We provide the font/cmap URLs below, but keep a guard for the rest so the
// harness output stays readable.
// ---------------------------------------------------------------------------
const _origWarn = console.warn;
export function silencePdfjsWarnings() {
  console.warn = (...args) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (
      first.includes("standardFontDataUrl") ||
      first.includes("fake worker") ||
      first.includes("Setting up fake worker")
    ) {
      return;
    }
    _origWarn(...args);
  };
}

// ---------------------------------------------------------------------------
// Singletons (loaded lazily, reused across all PDFs in one run).
// ---------------------------------------------------------------------------
let _gigaPromise = null;
let _pdfjsPromise = null;
let _canvasPromise = null;
let _pngPromise = null;

/** GigaPDF home engine instance (the system under test). */
export function getGigaEngine() {
  if (!_gigaPromise) {
    _gigaPromise = import(LIB_ENTRY).then((m) => m.GigaPdfEngine.loadDefault());
  }
  return _gigaPromise;
}

/** pdfjs module with worker disabled + std fonts / cmaps wired (the reference). */
export function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import(PDFJS_ENTRY).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `file://${PDFJS_WORKER}`;
      return pdfjs;
    });
  }
  return _pdfjsPromise;
}

/** Node canvas factory: prefer @napi-rs/canvas, fall back to `canvas`. */
export function getCanvasFactory() {
  if (!_canvasPromise) {
    _canvasPromise = (async () => {
      try {
        const m = await import(path.join(APP_ROOT, "node_modules/@napi-rs/canvas/index.js"));
        return {
          name: "@napi-rs/canvas",
          createCanvas: m.createCanvas,
          encodePng: async (canvas) =>
            canvas.encode ? await canvas.encode("png") : canvas.toBuffer("image/png"),
        };
      } catch {
        const m = await import(path.join(APP_ROOT, "node_modules/canvas/index.js"));
        return {
          name: "canvas",
          createCanvas: m.createCanvas,
          encodePng: async (canvas) => canvas.toBuffer("image/png"),
        };
      }
    })();
  }
  return _canvasPromise;
}

/** pngjs PNG class for decoding rendered buffers into raw RGBA. */
export function getPng() {
  if (!_pngPromise) {
    _pngPromise = import("pngjs").then((m) => m.PNG);
  }
  return _pngPromise;
}

// ---------------------------------------------------------------------------
// Document opening (memoised per absolute path so geometry + pixel passes
// don't re-parse the same bytes twice).
// ---------------------------------------------------------------------------
const _bytesCache = new Map();

/** Read PDF bytes once per path. Returns a Uint8Array. */
export function readPdfBytes(absPath) {
  if (!_bytesCache.has(absPath)) {
    _bytesCache.set(absPath, new Uint8Array(fs.readFileSync(absPath)));
  }
  return _bytesCache.get(absPath);
}

/**
 * Open a PDF with the home engine.
 * @returns {{ ok: true, doc: any } | { ok: false, error: string }}
 */
export async function openWithGiga(absPath) {
  try {
    const giga = await getGigaEngine();
    const doc = giga.open(readPdfBytes(absPath));
    // Touch pageCount to surface lazy parse failures early.
    doc.pageCount();
    return { ok: true, doc };
  } catch (e) {
    return { ok: false, error: shortErr(e) };
  }
}

/**
 * Open a PDF with pdfjs.
 * @returns {{ ok: true, doc: any } | { ok: false, error: string }}
 */
export async function openWithPdfjs(absPath) {
  try {
    const pdfjs = await getPdfjs();
    const doc = await pdfjs.getDocument({
      data: readPdfBytes(absPath).slice(), // pdfjs takes ownership of the buffer
      disableWorker: true,
      isEvalSupported: false,
      standardFontDataUrl: ensureTrailingSlash(PDFJS_STD_FONTS),
      cMapUrl: ensureTrailingSlash(PDFJS_CMAPS),
      cMapPacked: true,
    }).promise;
    return { ok: true, doc };
  } catch (e) {
    return { ok: false, error: shortErr(e) };
  }
}

// ---------------------------------------------------------------------------
// Coordinate helpers — the single source of truth for the Y convention.
//
// GigaPDF textElements:  y = PDF bottom-left origin (Y up). The top-left of a
//   run in web/screen coordinates (Y down, origin top-left) is therefore:
//       webYtop = pageHeight - y - height
//
// pdfjs item: Util.transform(viewport.transform, item.transform) yields a
//   matrix m where m[4] = x (left), m[5] = baseline Y in web coords. The
//   visual top of the glyph box is roughly  m[5] - fontSize.
// ---------------------------------------------------------------------------

/** Convert a GigaPDF run to web-space {x, yTop, w, h, fontSize, text, rotation}. */
export function gigaRunToWeb(run, pageHeight) {
  const h = num(run.height);
  return {
    x: num(run.x),
    yTop: pageHeight - num(run.y) - h,
    w: num(run.width),
    h,
    fontSize: num(run.fontSize),
    text: String(run.text ?? ""),
    rotation: num(run.rotation),
  };
}

/**
 * Convert a pdfjs text item to web-space {x, yTop, w, fontSize, text}.
 * @param pdfjs the pdfjs module (for Util.transform)
 * @param item  a getTextContent() item
 * @param viewport page.getViewport({ scale: 1 })
 */
export function pdfjsItemToWeb(pdfjs, item, viewport) {
  const m = pdfjs.Util.transform(viewport.transform, item.transform);
  const fontSize = Math.hypot(m[0], m[1]) || num(item.height) || 0;
  return {
    x: m[4],
    yTop: m[5] - fontSize, // glyph box top ≈ baseline - ascender
    yBaseline: m[5],
    w: num(item.width),
    fontSize,
    text: String(item.str ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Small utilities.
// ---------------------------------------------------------------------------
export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function ensureTrailingSlash(p) {
  return p.endsWith("/") ? p : `${p}/`;
}

export function shortErr(e) {
  const msg = e && e.message ? e.message : String(e);
  return msg.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function basename(p) {
  return path.basename(p);
}
