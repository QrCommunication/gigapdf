import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type { ShapeElement, ShapeType, Point } from '@giga-pdf/types';
import { rgbToHex } from '../utils';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; }

// pdfjs internal DrawOPS encoded inside constructPath's Float32Array stream.
// Ref: pdfjs-dist legacy build, search for "moveTo: 0" inside the bundle.
const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_QUAD_CURVE_TO = 3;
const DRAW_CLOSE_PATH = 4;

interface DrawingState {
  fillColor: string | null;
  strokeColor: string | null;
  strokeWidth: number;
  dashArray: number[];
  fillAlpha: number;
  strokeAlpha: number;
  ctm: number[];
  matrixStack: Array<{
    ctm: number[];
    fillColor: string | null;
    strokeColor: string | null;
    strokeWidth: number;
    fillAlpha: number;
    strokeAlpha: number;
    dashArray: number[];
  }>;
}

function parsePdfjsColor(args: unknown[]): string | null {
  if (args.length === 0) return null;
  const first = args[0];
  if (typeof first === 'string') {
    // Already a hex string ("#rrggbb"). Modern pdfjs.
    if (/^#[0-9a-f]{6}$/i.test(first)) return first.toLowerCase();
    return null;
  }
  if (typeof first === 'number') {
    // Older pdfjs: byte triple [r, g, b] in 0–255.
    const r = Math.max(0, Math.min(255, Math.round(first)));
    const g = Math.max(0, Math.min(255, Math.round((args[1] as number) ?? 0)));
    const b = Math.max(0, Math.min(255, Math.round((args[2] as number) ?? 0)));
    return rgbToHex(r, g, b);
  }
  return null;
}

function multiplyMatrices(m1: number[], m2: number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

function transformPoint(x: number, y: number, ctm: number[]): Point {
  return {
    x: ctm[0]! * x + ctm[2]! * y + ctm[4]!,
    y: ctm[1]! * x + ctm[3]! * y + ctm[5]!,
  };
}

interface PathSegment {
  /** SVG-like command in PDF user-space coords (post-CTM, pre-Y-flip) */
  cmd: 'M' | 'L' | 'C' | 'Q' | 'Z';
  points: Point[];
}

/**
 * Decode the inline opcode stream produced by pdfjs `constructPath`.
 * Format: Float32Array with [op, ...coords, op, ...coords, ...] where:
 *   op=0  moveTo            → 2 coords
 *   op=1  lineTo            → 2 coords
 *   op=2  curveTo (cubic)   → 6 coords (cp1 cp2 end)
 *   op=3  quadraticCurveTo  → 4 coords (cp end)
 *   op=4  closePath         → 0 coords
 */
function decodePathStream(buffer: Float32Array, ctm: number[]): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;
  while (i < buffer.length) {
    const op = buffer[i++]! | 0;
    switch (op) {
      case DRAW_MOVE_TO: {
        if (i + 2 > buffer.length) return segments;
        const p = transformPoint(buffer[i]!, buffer[i + 1]!, ctm);
        i += 2;
        segments.push({ cmd: 'M', points: [p] });
        break;
      }
      case DRAW_LINE_TO: {
        if (i + 2 > buffer.length) return segments;
        const p = transformPoint(buffer[i]!, buffer[i + 1]!, ctm);
        i += 2;
        segments.push({ cmd: 'L', points: [p] });
        break;
      }
      case DRAW_CURVE_TO: {
        if (i + 6 > buffer.length) return segments;
        const cp1 = transformPoint(buffer[i]!, buffer[i + 1]!, ctm);
        const cp2 = transformPoint(buffer[i + 2]!, buffer[i + 3]!, ctm);
        const end = transformPoint(buffer[i + 4]!, buffer[i + 5]!, ctm);
        i += 6;
        segments.push({ cmd: 'C', points: [cp1, cp2, end] });
        break;
      }
      case DRAW_QUAD_CURVE_TO: {
        if (i + 4 > buffer.length) return segments;
        const cp = transformPoint(buffer[i]!, buffer[i + 1]!, ctm);
        const end = transformPoint(buffer[i + 2]!, buffer[i + 3]!, ctm);
        i += 4;
        segments.push({ cmd: 'Q', points: [cp, end] });
        break;
      }
      case DRAW_CLOSE_PATH:
        segments.push({ cmd: 'Z', points: [] });
        break;
      default:
        // Unknown opcode — abort gracefully rather than read junk
        return segments;
    }
  }
  return segments;
}

function pathToSvgString(segments: PathSegment[], pageHeight: number): string {
  let d = '';
  for (const seg of segments) {
    if (seg.cmd === 'Z') { d += 'Z '; continue; }
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
  // Anchor points only (M/L/C end/Q end), suitable for downstream consumers
  // that don't render Bezier curves natively.
  const pts: Point[] = [];
  for (const seg of segments) {
    if (seg.cmd === 'Z' || seg.points.length === 0) continue;
    const last = seg.points[seg.points.length - 1]!;
    pts.push({ x: last.x, y: pageHeight - last.y });
  }
  return pts;
}

function detectShapeType(segments: PathSegment[], hasCurves: boolean): ShapeType {
  if (segments.length === 0) return 'path';
  const moves = segments.filter((s) => s.cmd === 'M').length;
  const lines = segments.filter((s) => s.cmd === 'L').length;
  const curves = segments.filter((s) => s.cmd === 'C' || s.cmd === 'Q').length;
  const closes = segments.filter((s) => s.cmd === 'Z').length;

  // Single straight line
  if (moves === 1 && lines === 1 && curves === 0 && closes === 0) return 'line';

  // Closed rectangle: 1 move + 3 lines + 1 close, with axis-aligned edges
  if (moves === 1 && lines === 3 && closes >= 0 && curves === 0) {
    return isAxisAlignedRect(segments) ? 'rectangle' : 'polygon';
  }
  if (moves === 1 && lines === 4 && curves === 0) {
    return isAxisAlignedRect(segments) ? 'rectangle' : 'polygon';
  }

  if (hasCurves) return 'path';
  if (closes > 0 && lines >= 2) return 'polygon';
  return 'path';
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

function emitShape(
  segments: PathSegment[],
  paintOp: number,
  pageHeight: number,
  state: DrawingState,
  minMax: Float32Array | number[] | undefined,
): ShapeElement | null {
  if (segments.length === 0) return null;

  // Filter out invisible no-op paints (clip-only and endPath)
  const isClip = paintOp === OPS.clip || paintOp === OPS.eoClip;
  const isEndPath = paintOp === OPS.endPath;
  if (isClip || isEndPath) return null;

  const isFill =
    paintOp === OPS.fill ||
    paintOp === OPS.eoFill ||
    paintOp === OPS.fillStroke ||
    paintOp === OPS.eoFillStroke ||
    paintOp === OPS.closeFillStroke;
  const isStroke =
    paintOp === OPS.stroke ||
    paintOp === OPS.closeStroke ||
    paintOp === OPS.fillStroke ||
    paintOp === OPS.eoFillStroke ||
    paintOp === OPS.closeFillStroke;
  if (!isFill && !isStroke) return null;

  // Use pdfjs-provided minMax bbox when available — already in user-space.
  // Layout: [minX, minY, maxX, maxY] in PDF coords (Y up).
  let bounds: { x: number; y: number; width: number; height: number };
  if (minMax && minMax.length === 4) {
    const minX = minMax[0]!;
    const minY = minMax[1]!;
    const maxX = minMax[2]!;
    const maxY = minMax[3]!;
    // Apply CTM to bbox corners (cheap: 4 transforms)
    const c0 = transformPoint(minX, minY, state.ctm);
    const c1 = transformPoint(maxX, minY, state.ctm);
    const c2 = transformPoint(maxX, maxY, state.ctm);
    const c3 = transformPoint(minX, maxY, state.ctm);
    const xs = [c0.x, c1.x, c2.x, c3.x];
    const ys = [c0.y, c1.y, c2.y, c3.y];
    const bbX = Math.min(...xs);
    const bbY = Math.min(...ys);
    bounds = {
      x: bbX,
      y: pageHeight - Math.max(...ys), // flip to Y-down
      width: Math.max(...xs) - bbX,
      height: Math.max(...ys) - bbY,
    };
  } else {
    const flat = flattenPoints(segments, pageHeight);
    if (flat.length < 2) return null;
    let minX = flat[0]!.x;
    let maxX = flat[0]!.x;
    let minY = flat[0]!.y;
    let maxY = flat[0]!.y;
    for (const p of flat) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  // Drop hairlines, zero-area paths, and sub-pixel artefacts. PDFs
  // generated from Type3 fonts (icon glyphs, OCR markers) can emit
  // thousands of 1×1 px paths that pollute the scene graph and the
  // editor's selection layer without contributing to the visible
  // rendering. Threshold of 2px catches dust without dropping intentional
  // hairlines (PDF stroke widths typically >= 0.25pt × CTM scale).
  if (bounds.width < 2 && bounds.height < 2) return null;

  const hasCurves = segments.some((s) => s.cmd === 'C' || s.cmd === 'Q');
  const shapeType = detectShapeType(segments, hasCurves);
  const points = flattenPoints(segments, pageHeight);
  const pathData = pathToSvgString(segments, pageHeight);

  return {
    elementId: randomUUID(),
    type: 'shape',
    bounds,
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    shapeType,
    geometry: {
      points,
      pathData,
      cornerRadius: 0,
    },
    style: {
      fillColor: isFill ? state.fillColor : null,
      fillOpacity: isFill ? state.fillAlpha : 0,
      strokeColor: isStroke ? state.strokeColor : null,
      strokeWidth: isStroke ? state.strokeWidth : 0,
      strokeOpacity: isStroke ? state.strokeAlpha : 0,
      strokeDashArray: state.dashArray,
    },
  };
}

export async function extractDrawingElements(
  page: PDFPageProxy,
  _pageNumber: number,
  pageHeight: number,
): Promise<ShapeElement[]> {
  const ops = await page.getOperatorList();
  const shapes: ShapeElement[] = [];

  const state: DrawingState = {
    fillColor: '#000000',
    strokeColor: '#000000',
    strokeWidth: 1,
    dashArray: [],
    fillAlpha: 1,
    strokeAlpha: 1,
    ctm: [1, 0, 0, 1, 0, 0],
    matrixStack: [],
  };

  const fnArray = ops.fnArray;
  const argsArray = ops.argsArray;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];

    switch (fn) {
      case OPS.save:
        state.matrixStack.push({
          ctm: [...state.ctm],
          fillColor: state.fillColor,
          strokeColor: state.strokeColor,
          strokeWidth: state.strokeWidth,
          fillAlpha: state.fillAlpha,
          strokeAlpha: state.strokeAlpha,
          dashArray: [...state.dashArray],
        });
        break;

      case OPS.restore: {
        const popped = state.matrixStack.pop();
        if (popped) {
          state.ctm = popped.ctm;
          state.fillColor = popped.fillColor;
          state.strokeColor = popped.strokeColor;
          state.strokeWidth = popped.strokeWidth;
          state.fillAlpha = popped.fillAlpha;
          state.strokeAlpha = popped.strokeAlpha;
          state.dashArray = popped.dashArray;
        } else {
          state.ctm = [1, 0, 0, 1, 0, 0];
        }
        break;
      }

      case OPS.transform: {
        const [a, b, c, d, e, f] = args as number[];
        state.ctm = multiplyMatrices(state.ctm, [a!, b!, c!, d!, e!, f!]);
        break;
      }

      case OPS.constructPath: {
        // Modern pdfjs batches every path operation through this op.
        // Args layout: [paintOp: number, [Float32Array data], minMax?: Float32Array]
        const paintOp = typeof args[0] === 'number' ? (args[0] as number) : 0;
        const dataArg = args[1];
        let buffer: Float32Array | null = null;
        if (Array.isArray(dataArg) && dataArg.length > 0) {
          const first = dataArg[0];
          if (first instanceof Float32Array) buffer = first;
          else if (first instanceof Array) buffer = Float32Array.from(first as number[]);
        }
        if (!buffer) break;
        const minMax = args[2] as Float32Array | number[] | undefined;
        const segments = decodePathStream(buffer, state.ctm);
        const shape = emitShape(segments, paintOp, pageHeight, state, minMax);
        if (shape) shapes.push(shape);
        break;
      }

      case OPS.rectangle: {
        const [x, y, w, h] = args as number[];
        const segments: PathSegment[] = [
          { cmd: 'M', points: [transformPoint(x!, y!, state.ctm)] },
          { cmd: 'L', points: [transformPoint(x! + w!, y!, state.ctm)] },
          { cmd: 'L', points: [transformPoint(x! + w!, y! + h!, state.ctm)] },
          { cmd: 'L', points: [transformPoint(x!, y! + h!, state.ctm)] },
          { cmd: 'Z', points: [] },
        ];
        // Rectangle alone doesn't paint until a subsequent fill/stroke op.
        // Most generators batch this through constructPath. Safe to ignore
        // here, the next paint op will materialise a path. But for robustness
        // we capture rectangles as filled shapes by default since most
        // standalone re ops with a fill follow.
        const shape = emitShape(segments, OPS.fill, pageHeight, state, undefined);
        if (shape) shapes.push(shape);
        break;
      }

      case OPS.setStrokeRGBColor: {
        // pdfjs delivers the colour pre-resolved: a "#rrggbb" string in
        // modern builds (since pdfjs 3.x), an [r,g,b] byte triple in older
        // builds. Accept both.
        state.strokeColor = parsePdfjsColor(args);
        break;
      }

      case OPS.setFillRGBColor: {
        state.fillColor = parsePdfjsColor(args);
        break;
      }

      case OPS.setLineWidth: {
        const [w] = args as number[];
        state.strokeWidth = w ?? 1;
        break;
      }

      case OPS.setDash: {
        const [dashArray] = args as [number[]];
        state.dashArray = dashArray ?? [];
        break;
      }

      case OPS.setGState: {
        // Extract fill/stroke alpha from graphics state if present.
        const gStateArgs = args[0] as Array<[string, unknown]> | undefined;
        if (Array.isArray(gStateArgs)) {
          for (const entry of gStateArgs) {
            if (!Array.isArray(entry)) continue;
            const [key, value] = entry;
            if (key === 'ca' && typeof value === 'number') state.fillAlpha = value;
            if (key === 'CA' && typeof value === 'number') state.strokeAlpha = value;
          }
        }
        break;
      }
    }
  }

  return shapes;
}
