/**
 * redact-pii.ts
 *
 * Client-side helper for the editor's PII redaction tool.
 *
 * Redaction is a **true, irreversible** operation baked onto the PDF through the
 * shared GigaPDF engine ({@link loadPdfEngine} — the same single wasm instance
 * that rasterises page backgrounds and bakes headers/footers, so we never load a
 * second engine). For each page the engine's {@link redactPii} deletes the
 * overlapping text/vector content from the content stream (glyphs + their
 * `/ToUnicode` mapping are gone — copy/paste and text extraction reveal nothing),
 * overwrites the pixels of any underlying image with opaque black (re-encoded, so
 * the sensitive bytes are erased, not merely covered), strips overlapping
 * annotations, and paints an opaque black box as the visible redaction mark.
 *
 * The flow mirrors {@link file://./page-headers-footers.ts}:
 *
 *   - the user draws redaction zones on the editor canvas (web coordinates,
 *     origin top-left, Y-down, in PDF points at scale 1);
 *   - {@link webRectToPdf} lowers each web rect into PDF user-space (origin
 *     bottom-left, Y-up), honouring the page's `/Rotate` flag;
 *   - {@link groupRectsByPage} buckets the converted rects per 1-based page;
 *   - {@link redactDocument} opens a short-lived `GigaPdfDoc` on the shared
 *     engine, calls `redactPii` once per page that has rects, re-serialises, and
 *     closes the doc in `finally`.
 *
 * The caller feeds the returned bytes back into the editor's single source of
 * truth (`currentPdfFile`) via `adoptModifiedPdf` — exactly like any other
 * full-binary operation. No React, no DOM — trivially unit-testable with an
 * injected engine loader.
 */

import { loadPdfEngine } from "@giga-pdf/canvas";

/** Loader for the shared GigaPDF engine; injectable for tests. */
type EngineLoader = typeof loadPdfEngine;

/** A rectangle in either web or PDF coordinate space (PDF points). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A redaction rectangle drawn on a given page (web coordinates, Y-down). */
export interface WebRedactionRect extends Rect {
  /** 1-based page number the rect was drawn on. */
  pageNumber: number;
}

/** The geometry of a page needed to lower web rects into PDF user-space. */
export interface PageGeometry {
  /** Displayed page width in PDF points (post-`/Rotate`). */
  width: number;
  /** Displayed page height in PDF points (post-`/Rotate`). */
  height: number;
  /** The page's `/Rotate` flag (0 by default). */
  rotation?: 0 | 90 | 180 | 270;
}

/** Rects bucketed by 1-based page number, in PDF user-space. */
export type RectsByPage = Map<number, Rect[]>;

/** Normalise PDF bytes to a `Uint8Array` the engine can open. */
function toBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

/**
 * Copy the engine's saved bytes into a freshly-allocated `ArrayBuffer`-backed
 * view so the result is a `Uint8Array<ArrayBuffer>` — directly usable as a
 * `BlobPart` in the browser (the engine's `save()` returns the looser
 * `Uint8Array<ArrayBufferLike>`).
 */
function freshCopy(saved: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(saved.byteLength);
  copy.set(saved);
  return copy;
}

/**
 * Convert a web rect (origin top-left, Y-down — in PDF points at scale 1) into a
 * PDF user-space rect (origin bottom-left, Y-up), honouring the page's `/Rotate`
 * flag. `bounds.y` is the TOP edge of the box in web space; after conversion the
 * returned `y` is the BOTTOM edge in PDF space.
 *
 * This is the same rotation-aware formula as `@giga-pdf/pdf-engine`'s `webToPdf`,
 * inlined here so the redaction helper stays browser-safe and free of the
 * pdf-engine barrel (which pulls heavy native/wasm modules).
 *
 * `geo.width` / `geo.height` are the DISPLAYED page dimensions (post-rotation),
 * exactly what the editor's scene-graph `page.dimensions` carry.
 */
export function webRectToPdf(rect: Rect, geo: PageGeometry): Rect {
  const rot = geo.rotation ?? 0;
  const { x, y, width, height } = rect;

  if (rot === 90 || rot === 270) {
    // On a /Rotate=90|270 page the effective display height is the MediaBox
    // width — but the scene graph already reports DISPLAYED dimensions, so the
    // displayed height (geo.height) is the right axis to flip against.
    return { x, y: geo.height - y - height, width, height };
  }

  if (rot === 180) {
    // 180° flips both axes about the displayed page box.
    return { x: geo.width - x - width, y, width, height };
  }

  // rotation = 0 (default): plain Y-flip.
  return { x, y: geo.height - y - height, width, height };
}

/**
 * Lower a list of web redaction rects into PDF user-space and bucket them per
 * 1-based page. `pageGeometries` maps a 1-based page number to that page's
 * displayed geometry. Rects whose page has no geometry, or that are empty
 * (non-positive width/height), are dropped — a degenerate drag must never
 * produce a redaction.
 */
export function groupRectsByPage(
  rects: readonly WebRedactionRect[],
  pageGeometries: ReadonlyMap<number, PageGeometry>,
): RectsByPage {
  const byPage: RectsByPage = new Map();
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    const geo = pageGeometries.get(rect.pageNumber);
    if (!geo) continue;
    const pdfRect = webRectToPdf(rect, geo);
    const bucket = byPage.get(rect.pageNumber);
    if (bucket) bucket.push(pdfRect);
    else byPage.set(rect.pageNumber, [pdfRect]);
  }
  return byPage;
}

/**
 * Minimal structural view of the SDK document we rely on here. Declared locally
 * so this module stays decoupled from the SDK's public type surface (the methods
 * are stable on `GigaPdfDoc`).
 */
interface RedactableDoc {
  redactPii(
    page: number,
    rects: Rect[],
    opts?: { cover?: boolean; coverRgb?: number },
  ): number;
  save(): Uint8Array;
  close(): void;
}

/**
 * Irreversibly redact `rectsByPage` (PDF user-space rects bucketed per 1-based
 * page) from `source` and return the re-serialised PDF bytes. Opens a short-lived
 * `GigaPdfDoc` on the shared engine, calls `redactPii` once per page that has
 * rects (opaque black cover, the PII default), and closes the doc in `finally`.
 *
 * Returns the count of content elements deleted across every page. Throws (with
 * the doc still closed) if the engine cannot open the bytes; the caller surfaces
 * that as an error toast. A call with no rects is a no-op that still returns
 * freshly-serialised bytes.
 */
export async function redactDocument(
  source: ArrayBuffer | Uint8Array,
  rectsByPage: RectsByPage,
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; deleted: number }> {
  const engine = await loadEngine();
  // open → redact → save → close in the same synchronous tick (no await between
  // open and close) so the short-lived doc never overlaps page rendering on the
  // shared wasm instance — mirrors page-headers-footers.ts.
  const doc = engine.open(toBytes(source)) as unknown as RedactableDoc;
  try {
    let deleted = 0;
    for (const [pageNumber, rects] of rectsByPage) {
      if (rects.length === 0) continue;
      // `cover` defaults to true for PII; pass it explicitly for intent.
      deleted += doc.redactPii(pageNumber, rects, { cover: true });
    }
    return { bytes: freshCopy(doc.save()), deleted };
  } finally {
    doc.close();
  }
}
