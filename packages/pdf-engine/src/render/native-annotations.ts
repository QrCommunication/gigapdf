/**
 * Native PDF annotations via MuPDF — Highlight, Underline, Squiggly,
 * StrikeOut, FreeText, Stamp.
 *
 * The legacy approach (pdf-lib `drawRectangle` + transparency) produces
 * a flattened drawing that PDF readers can't isolate — the user can't
 * click it, can't edit it, can't toggle its visibility, and copy-paste
 * leaks the underlying text untouched. By creating real `/Annot` objects
 * via MuPDF's `PDFPage.createAnnotation`, the resulting PDF has true
 * interactive annotations that Adobe Acrobat / macOS Preview / Foxit
 * recognise and manage natively.
 *
 * Coordinates are in PDF user-space (origin bottom-left). Callers must
 * convert from web space via `webToPdf` before calling.
 */

import { engineLogger } from '../utils/logger';

export type NativeAnnotationType =
  | 'Highlight'
  | 'Underline'
  | 'Squiggly'
  | 'StrikeOut'
  | 'FreeText'
  | 'Stamp';

export interface NativeAnnotationSpec {
  pageNumber: number; // 1-based
  type: NativeAnnotationType;
  /** PDF user-space rectangle: [x0, y0, x1, y1]. */
  rect: [number, number, number, number];
  /** Quads for Highlight/Underline/Squiggly/StrikeOut covering multi-line text. */
  quads?: Array<[number, number, number, number, number, number, number, number]>;
  /** Stroke colour in [0, 1] range (R, G, B). Defaults to yellow highlight. */
  color?: [number, number, number];
  /** Optional opacity [0, 1]. Defaults to 0.4 for Highlight, 1 for the rest. */
  opacity?: number;
  /** Author name shown by readers (Acrobat /T entry). */
  author?: string;
  /** Free-text content / pop-up note body (Acrobat /Contents entry). */
  contents?: string;
}

export interface AddNativeAnnotationsResult {
  bytes: Uint8Array;
  added: number;
  pagesAffected: number;
}

const DEFAULT_HIGHLIGHT_COLOR: [number, number, number] = [1, 0.92, 0];
const DEFAULT_UNDERLINE_COLOR: [number, number, number] = [0, 0.5, 1];

export async function addNativeAnnotations(
  pdfBytes: Uint8Array,
  annotations: NativeAnnotationSpec[],
): Promise<AddNativeAnnotationsResult> {
  if (annotations.length === 0) {
    return { bytes: pdfBytes, added: 0, pagesAffected: 0 };
  }

  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(
    pdfBytes,
    'application/pdf',
  ) as unknown as InstanceType<typeof mupdf.PDFDocument>;

  const pageBuckets = new Map<number, NativeAnnotationSpec[]>();
  for (const a of annotations) {
    const list = pageBuckets.get(a.pageNumber);
    if (list) list.push(a);
    else pageBuckets.set(a.pageNumber, [a]);
  }

  let added = 0;
  let pagesAffected = 0;

  for (const [pageNumber, list] of pageBuckets) {
    const pageIndex = pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= doc.countPages()) {
      engineLogger.warn('native-annotations: page out of range, skipping', {
        pageNumber,
        pageCount: doc.countPages(),
      });
      continue;
    }

    const page = doc.loadPage(pageIndex) as unknown as InstanceType<
      typeof mupdf.PDFPage
    >;

    for (const spec of list) {
      const annot = page.createAnnotation(spec.type);
      annot.setRect(spec.rect);

      const color =
        spec.color ??
        (spec.type === 'Highlight'
          ? DEFAULT_HIGHLIGHT_COLOR
          : DEFAULT_UNDERLINE_COLOR);
      annot.setColor(color);

      const opacity =
        spec.opacity ?? (spec.type === 'Highlight' ? 0.4 : 1);
      annot.setOpacity(opacity);

      if (spec.quads && spec.quads.length > 0) {
        annot.setQuadPoints(spec.quads);
      }

      if (spec.author) annot.setAuthor(spec.author);
      if (spec.contents) annot.setContents(spec.contents);

      // Persist the visual appearance stream so even readers that don't
      // re-render annotations (lightweight viewers) still show the correct
      // highlight colour.
      annot.update();

      added++;
    }

    pagesAffected++;
  }

  const buf = doc.saveToBuffer('garbage=4,compress=yes,sanitize=yes');
  const bytes = buf.asUint8Array();

  engineLogger.info('native-annotations: added native PDF annotations', {
    requested: annotations.length,
    added,
    pagesAffected,
    outputBytes: bytes.byteLength,
  });

  return { bytes, added, pagesAffected };
}
