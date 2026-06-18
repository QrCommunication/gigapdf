/**
 * Native PDF annotations via the WASM engine (`@qrcommunication/gigapdf-lib`).
 *
 * Native engine path. Real `/Annot` objects (Highlight, Underline,
 * StrikeOut, FreeText, Stamp) are written into the page so readers manage them
 * natively. Coordinates are PDF user-space (origin bottom-left); callers convert
 * from web space via `webToPdf` first. (`Squiggly` maps to Underline; per-annot
 * opacity / pop-up author are not carried by the engine annotations.)
 */

import { getEngine } from '../wasm';
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
  /** Optional opacity [0, 1] (not applied by the engine annotations). */
  opacity?: number;
  /** Author name (not carried by the engine annotations). */
  author?: string;
  /** Free-text content / stamp label (Acrobat /Contents entry). */
  contents?: string;
}

export interface AddNativeAnnotationsResult {
  bytes: Uint8Array;
  added: number;
  pagesAffected: number;
}

const DEFAULT_HIGHLIGHT_COLOR: [number, number, number] = [1, 0.92, 0];
const DEFAULT_UNDERLINE_COLOR: [number, number, number] = [0, 0.5, 1];

/** [0,1] RGB → packed 0xRRGGBB. */
function packRgb([r, g, b]: [number, number, number]): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

/** Axis-aligned bounding rect [x0,y0,x1,y1] of an 8-number quad. */
function quadBounds(
  q: [number, number, number, number, number, number, number, number],
): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < 8; k += 2) {
    minX = Math.min(minX, q[k]!);
    maxX = Math.max(maxX, q[k]!);
    minY = Math.min(minY, q[k + 1]!);
    maxY = Math.max(maxY, q[k + 1]!);
  }
  return [minX, minY, maxX, maxY];
}

export async function addNativeAnnotations(
  pdfBytes: Uint8Array,
  annotations: NativeAnnotationSpec[],
): Promise<AddNativeAnnotationsResult> {
  if (annotations.length === 0) {
    return { bytes: pdfBytes, added: 0, pagesAffected: 0 };
  }

  const giga = await getEngine();
  const doc = giga.open(pdfBytes);
  try {
    const totalPages = doc.pageCount();
    const pagesAffected = new Set<number>();
    let added = 0;

    for (const spec of annotations) {
      if (spec.pageNumber < 1 || spec.pageNumber > totalPages) {
        engineLogger.warn('native-annotations: page out of range, skipping', {
          pageNumber: spec.pageNumber,
          pageCount: totalPages,
        });
        continue;
      }
      const rgb = packRgb(
        spec.color ??
          (spec.type === 'Highlight' ? DEFAULT_HIGHLIGHT_COLOR : DEFAULT_UNDERLINE_COLOR),
      );
      const rects =
        spec.quads && spec.quads.length > 0 ? spec.quads.map(quadBounds) : [spec.rect];

      for (const [x0, y0, x1, y1] of rects) {
        let ok = false;
        switch (spec.type) {
          case 'Highlight':
            ok = doc.addHighlight(spec.pageNumber, x0, y0, x1, y1, rgb);
            break;
          case 'Underline':
          case 'Squiggly':
            ok = doc.addUnderline(spec.pageNumber, x0, y0, x1, y1, rgb);
            break;
          case 'StrikeOut':
            ok = doc.addStrikeOut(spec.pageNumber, x0, y0, x1, y1, rgb);
            break;
          case 'FreeText':
            ok = doc.addFreeText(spec.pageNumber, x0, y0, x1, y1, spec.contents ?? '', 12, rgb);
            break;
          case 'Stamp':
            ok = doc.addStamp(spec.pageNumber, x0, y0, x1, y1, spec.contents ?? 'STAMP', rgb);
            break;
        }
        if (ok) {
          added++;
          pagesAffected.add(spec.pageNumber);
        }
      }
    }

    const bytes = doc.saveCompressed();
    engineLogger.info('native-annotations: added native PDF annotations', {
      requested: annotations.length,
      added,
      pagesAffected: pagesAffected.size,
      outputBytes: bytes.byteLength,
    });
    return { bytes, added, pagesAffected: pagesAffected.size };
  } finally {
    doc.close();
  }
}
