/**
 * Real PDF content-stream redaction backed by MuPDF (Artifex).
 *
 * The historical approach in `text-renderer.ts` / `image-renderer.ts` was to
 * paint a coloured rectangle over the area we wanted to remove, then re-draw
 * the new element on top. That has two visible side effects:
 *
 *   1. The original glyphs / image bytes stay in the PDF content stream —
 *      they're only hidden visually. After flatten / on copy-paste / in some
 *      readers, they leak through (the user sees the old text behind the new).
 *   2. The clear rectangle never matches the underlying gradient / pattern /
 *      anti-aliased halo around the original glyph perfectly, producing the
 *      thin "frame" border that motivated this refactor.
 *
 * This module solves both by adding a real PDF Redact annotation per target
 * area then calling `applyRedactions()` — MuPDF physically removes any text
 * / image / line-art whose bounding box intersects the redaction rectangle,
 * exactly like a PDF/A-compliant redactor would.
 *
 * The redaction is applied as a single pass over the final document at the
 * end of an `apply-elements` batch. This avoids re-loading the pdf-lib
 * document for every individual update operation.
 */

import { engineLogger } from '../utils/logger';

export interface RedactionTarget {
  /** 1-based page number */
  pageNumber: number;
  /** PDF coordinate-space rectangle to redact (origin top-left, post bounds-conversion). */
  bounds: { x: number; y: number; width: number; height: number };
}

export interface ApplyRedactionsResult {
  bytes: Uint8Array;
  /** Number of redaction annotations actually applied (<= targets.length). */
  applied: number;
  /** Pages that received at least one redaction. */
  pagesAffected: number;
}

/**
 * Apply a batch of redactions to the given PDF bytes and return the
 * modified bytes. MuPDF is loaded lazily so the WASM blob (~10 MB) never
 * gets pulled into hot paths that don't need it.
 *
 * Empty `targets` is a no-op that returns the input bytes unchanged so
 * callers can use it unconditionally.
 */
export async function applyRedactions(
  pdfBytes: Uint8Array,
  targets: RedactionTarget[],
): Promise<ApplyRedactionsResult> {
  if (targets.length === 0) {
    return { bytes: pdfBytes, applied: 0, pagesAffected: 0 };
  }

  // Lazy import — MuPDF's wasm runtime is heavy and we only want the cost
  // when an apply-elements batch actually contains updates / deletes.
  const mupdf = await import('mupdf');

  // mupdf.Document.openDocument accepts ArrayBuffer / Uint8Array directly.
  // It returns a Document; for PDF input we always get a PDFDocument back.
  const doc = mupdf.Document.openDocument(
    pdfBytes,
    'application/pdf',
  ) as unknown as InstanceType<typeof mupdf.PDFDocument>;

  // Group redactions by page so we open each page only once.
  const byPage = new Map<number, RedactionTarget['bounds'][]>();
  for (const t of targets) {
    const list = byPage.get(t.pageNumber);
    if (list) {
      list.push(t.bounds);
    } else {
      byPage.set(t.pageNumber, [t.bounds]);
    }
  }

  let applied = 0;
  let pagesAffected = 0;

  for (const [pageNumber, boundsList] of byPage) {
    const pageIndex = pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= doc.countPages()) {
      engineLogger.warn('mupdf-redact: page out of range, skipped', {
        pageNumber,
        pageCount: doc.countPages(),
      });
      continue;
    }

    const rawPage = doc.loadPage(pageIndex);
    // PDFDocument always returns PDFPage but the union type forces a cast.
    const page = rawPage as unknown as InstanceType<typeof mupdf.PDFPage>;

    // PDF coords for MuPDF: [x0, y0, x1, y1]. Our caller already passes
    // PDF-space bounds (the same coordinate system pdf-lib uses with
    // origin at the bottom-left), so no Y-flip is required here.
    for (const b of boundsList) {
      const annot = page.createAnnotation('Redact');
      annot.setRect([b.x, b.y, b.x + b.width, b.y + b.height]);
      applied++;
    }

    // black_boxes=false: don't paint MuPDF's default black fill — caller
    // is responsible for the visual replacement (we only want the bytes
    // gone). image / line-art removal use the MuPDF default semantics.
    page.applyRedactions(
      false,
      // image: REDACT_IMAGE_REMOVE — fully drop covered images
      1,
      // line-art: REDACT_LINE_ART_REMOVE_IF_COVERED — only kill paths fully under the rect
      1,
      // text: REDACT_TEXT_REMOVE — drop covered glyphs
      0,
    );

    pagesAffected++;
  }

  // Save with options that keep the file forward-compatible: garbage=4 +
  // compress + linearize (for fast web view). We pass them as a string so
  // we don't take a hard dep on a specific options-object shape across
  // mupdf minor releases.
  const buf = doc.saveToBuffer('garbage=4,compress=yes,sanitize=yes');
  const bytes = buf.asUint8Array();

  engineLogger.info('mupdf-redact: redactions applied', {
    targetsRequested: targets.length,
    redactionsApplied: applied,
    pagesAffected,
    inputBytes: pdfBytes.byteLength,
    outputBytes: bytes.byteLength,
  });

  return { bytes, applied, pagesAffected };
}
