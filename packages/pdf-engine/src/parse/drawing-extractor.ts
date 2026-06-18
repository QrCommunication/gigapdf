import { randomUUID } from 'node:crypto';
import type { ShapeElement, ShapeType, Point } from '@giga-pdf/types';
import type { VectorPathInfo } from '@qrcommunication/gigapdf-lib';
import { rgbToHex } from '../utils';
import { getEngine } from '../wasm';

// ---------------------------------------------------------------------------
// Drawing/shape extractor — backed by the native engine's `vectorPaths()`
// (no pdfjs). The engine walks the page content stream and returns each painted
// path as geometry (segments in user space, origin bottom-left) + style
// (fill/stroke RGB 0..1, line width, alpha, dash). We map that to the editor's
// ShapeElement scene-graph type, flipping to web coordinates (top-left origin).
// ---------------------------------------------------------------------------

interface PathSegment {
  /** SVG-like command in PDF user-space coords (post-CTM, pre-Y-flip). */
  cmd: 'M' | 'L' | 'C' | 'Q' | 'Z';
  points: Point[];
}

/** Convert one engine path segment (user space) to an SVG-like PathSegment. */
function toSegment(seg: VectorPathInfo['segments'][number]): PathSegment | null {
  const p = seg.pts;
  switch (seg.op) {
    case 'M':
      return { cmd: 'M', points: [{ x: p[0]!, y: p[1]! }] };
    case 'L':
      return { cmd: 'L', points: [{ x: p[0]!, y: p[1]! }] };
    case 'C':
      return {
        cmd: 'C',
        points: [
          { x: p[0]!, y: p[1]! },
          { x: p[2]!, y: p[3]! },
          { x: p[4]!, y: p[5]! },
        ],
      };
    case 'Z':
      return { cmd: 'Z', points: [] };
    default:
      return null;
  }
}

function pathToSvgString(segments: PathSegment[], pageHeight: number): string {
  let d = '';
  for (const seg of segments) {
    if (seg.cmd === 'Z') {
      d += 'Z ';
      continue;
    }
    if (seg.cmd === 'M') {
      const p = seg.points[0]!;
      d += `M ${p.x.toFixed(3)} ${(pageHeight - p.y).toFixed(3)} `;
    } else if (seg.cmd === 'L') {
      const p = seg.points[0]!;
      d += `L ${p.x.toFixed(3)} ${(pageHeight - p.y).toFixed(3)} `;
    } else if (seg.cmd === 'C') {
      const [cp1, cp2, end] = seg.points;
      d += `C ${cp1!.x.toFixed(3)} ${(pageHeight - cp1!.y).toFixed(3)}, ${cp2!.x.toFixed(3)} ${(pageHeight - cp2!.y).toFixed(3)}, ${end!.x.toFixed(3)} ${(pageHeight - end!.y).toFixed(3)} `;
    } else if (seg.cmd === 'Q') {
      const [cp, end] = seg.points;
      d += `Q ${cp!.x.toFixed(3)} ${(pageHeight - cp!.y).toFixed(3)}, ${end!.x.toFixed(3)} ${(pageHeight - end!.y).toFixed(3)} `;
    }
  }
  return d.trim();
}

function flattenPoints(segments: PathSegment[], pageHeight: number): Point[] {
  // Anchor points only (M/L start, C/Q end), in web coords.
  const pts: Point[] = [];
  for (const seg of segments) {
    if (seg.cmd === 'Z' || seg.points.length === 0) continue;
    const last = seg.points[seg.points.length - 1]!;
    pts.push({ x: last.x, y: pageHeight - last.y });
  }
  return pts;
}

function isAxisAlignedRect(segments: PathSegment[]): boolean {
  const pts: Point[] = [];
  for (const seg of segments) {
    if (seg.cmd === 'M' || seg.cmd === 'L') pts.push(seg.points[0]!);
  }
  if (pts.length < 4) return false;
  const [p0, p1, p2, p3] = pts;
  return (
    Math.abs(p0!.x - p3!.x) < 1 &&
    Math.abs(p0!.y - p1!.y) < 1 &&
    Math.abs(p1!.x - p2!.x) < 1 &&
    Math.abs(p2!.y - p3!.y) < 1
  );
}

function detectShapeType(segments: PathSegment[], hasCurves: boolean): ShapeType {
  if (segments.length === 0) return 'path';
  const moves = segments.filter((s) => s.cmd === 'M').length;
  const lines = segments.filter((s) => s.cmd === 'L').length;
  const curves = segments.filter((s) => s.cmd === 'C' || s.cmd === 'Q').length;
  const closes = segments.filter((s) => s.cmd === 'Z').length;

  // Single straight line
  if (moves === 1 && lines === 1 && curves === 0 && closes === 0) return 'line';

  // Closed rectangle: 1 move + 3-4 lines + close, axis-aligned edges
  if (moves === 1 && lines === 3 && curves === 0) {
    return isAxisAlignedRect(segments) ? 'rectangle' : 'polygon';
  }
  if (moves === 1 && lines === 4 && curves === 0) {
    return isAxisAlignedRect(segments) ? 'rectangle' : 'polygon';
  }

  if (hasCurves) return 'path';
  if (closes > 0 && lines >= 2) return 'polygon';
  return 'path';
}

/** Web bounds (top-left origin) from an engine path's user-space box. */
function webBoundsFromPath(
  path: VectorPathInfo,
  pageHeight: number,
  fallbackPoints: Point[],
): { x: number; y: number; width: number; height: number } {
  if (path.hasBounds) {
    return {
      x: path.x0,
      y: pageHeight - path.y1,
      width: path.x1 - path.x0,
      height: path.y1 - path.y0,
    };
  }
  // Degenerate box: derive from the flattened (web) anchor points.
  if (fallbackPoints.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = fallbackPoints[0]!.x;
  let maxX = minX;
  let minY = fallbackPoints[0]!.y;
  let maxY = minY;
  for (const p of fallbackPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Map one engine VectorPathInfo to a ShapeElement, or null when degenerate. */
function toShape(path: VectorPathInfo, pageHeight: number): ShapeElement | null {
  const segments = path.segments.map(toSegment).filter((s): s is PathSegment => s !== null);
  if (segments.length === 0) return null;

  const points = flattenPoints(segments, pageHeight);
  const bounds = webBoundsFromPath(path, pageHeight, points);
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const hasCurves = segments.some((s) => s.cmd === 'C' || s.cmd === 'Q');
  const shapeType = detectShapeType(segments, hasCurves);
  const pathData = pathToSvgString(segments, pageHeight);

  const fillColor = path.fill ? rgbToHex(path.fill[0], path.fill[1], path.fill[2]) : null;
  const strokeColor = path.stroke ? rgbToHex(path.stroke[0], path.stroke[1], path.stroke[2]) : null;

  return {
    elementId: randomUUID(),
    type: 'shape',
    bounds,
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    shapeType,
    geometry: { points, pathData, cornerRadius: 0 },
    style: {
      fillColor,
      fillOpacity: fillColor ? path.fillAlpha : 0,
      strokeColor,
      strokeWidth: strokeColor ? path.strokeWidth : 0,
      strokeOpacity: strokeColor ? path.strokeAlpha : 0,
      strokeDashArray: path.dash,
    },
  };
}

/**
 * Extract vector shapes from a PDF, grouped by 1-based page number. Opens the
 * document once. Degenerate (zero-area) paths are skipped. Empty map on failure.
 */
export async function extractDrawingElementsByPage(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<Map<number, ShapeElement[]>> {
  const byPage = new Map<number, ShapeElement[]>();
  try {
    const giga = await getEngine();
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = giga.open(bytes);
    try {
      const pageCount = doc.pageCount();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const pageHeight = doc.pageInfo(pageNumber).height;
        const shapes: ShapeElement[] = [];
        for (const path of doc.vectorPaths(pageNumber)) {
          const shape = toShape(path, pageHeight);
          if (shape) shapes.push(shape);
        }
        if (shapes.length > 0) byPage.set(pageNumber, shapes);
      }
    } finally {
      doc.close();
    }
  } catch {
    // leave the map empty on failure
  }
  return byPage;
}

/** Vector shapes on a single page (convenience wrapper over the grouped map). */
export async function extractDrawingElements(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  pageNumber: number,
): Promise<ShapeElement[]> {
  return (await extractDrawingElementsByPage(pdfBytes)).get(pageNumber) ?? [];
}
