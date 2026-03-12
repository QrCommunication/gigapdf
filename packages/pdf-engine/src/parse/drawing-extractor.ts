import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type { ShapeElement, ShapeType, Point } from '@giga-pdf/types';
import { rgbToHex } from '../utils';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; }

interface DrawingState {
  currentPath: Point[];
  fillColor: string | null;
  strokeColor: string | null;
  strokeWidth: number;
  dashArray: number[];
  ctm: number[];
  matrixStack: number[][];
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

function computeBounds(points: Point[]): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0]!.x;
  let maxX = points[0]!.x;
  let minY = points[0]!.y;
  let maxY = points[0]!.y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function detectShapeType(points: Point[]): ShapeType {
  if (points.length === 2) return 'line';
  if (points.length === 4 || points.length === 5) {
    const [p0, p1, p2, p3] = points;
    if (!p0 || !p1 || !p2 || !p3) return 'path';
    const isRect =
      Math.abs(p0.x - p3.x) < 1 &&
      Math.abs(p0.y - p1.y) < 1 &&
      Math.abs(p1.x - p2.x) < 1 &&
      Math.abs(p2.y - p3.y) < 1;
    if (isRect) return 'rectangle';
  }
  return 'path';
}

function buildPathData(points: Point[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i]!.x} ${points[i]!.y}`;
  }
  return d;
}

function createShapeElement(
  points: Point[],
  pageHeight: number,
  state: DrawingState,
  hasFill: boolean,
  hasStroke: boolean,
): ShapeElement | null {
  if (points.length < 2) return null;

  const webPoints = points.map((p) => ({ x: p.x, y: pageHeight - p.y }));
  const rawBounds = computeBounds(webPoints);
  if (rawBounds.width < 0.5 && rawBounds.height < 0.5) return null;

  const shapeType = detectShapeType(webPoints);

  return {
    elementId: randomUUID(),
    type: 'shape',
    bounds: rawBounds,
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    shapeType,
    geometry: {
      points: webPoints,
      pathData: shapeType === 'path' || shapeType === 'line' ? buildPathData(webPoints) : null,
      cornerRadius: 0,
    },
    style: {
      fillColor: hasFill ? state.fillColor : null,
      fillOpacity: hasFill ? 1 : 0,
      strokeColor: hasStroke ? state.strokeColor : null,
      strokeWidth: state.strokeWidth,
      strokeOpacity: hasStroke ? 1 : 0,
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
    currentPath: [],
    fillColor: '#000000',
    strokeColor: '#000000',
    strokeWidth: 1,
    dashArray: [],
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
        state.matrixStack.push([...state.ctm]);
        break;

      case OPS.restore:
        state.ctm = state.matrixStack.pop() ?? [1, 0, 0, 1, 0, 0];
        break;

      case OPS.transform: {
        const [a, b, c, d, e, f] = args as number[];
        state.ctm = multiplyMatrices(state.ctm, [a!, b!, c!, d!, e!, f!]);
        break;
      }

      case OPS.moveTo: {
        const [x, y] = args as number[];
        state.currentPath = [transformPoint(x!, y!, state.ctm)];
        break;
      }

      case OPS.lineTo: {
        const [x, y] = args as number[];
        state.currentPath.push(transformPoint(x!, y!, state.ctm));
        break;
      }

      case OPS.curveTo:
      case OPS.curveTo2:
      case OPS.curveTo3: {
        const coords = args as number[];
        const last = coords.slice(-2);
        if (last.length === 2) {
          state.currentPath.push(transformPoint(last[0]!, last[1]!, state.ctm));
        }
        break;
      }

      case OPS.rectangle: {
        const [x, y, w, h] = args as number[];
        const p0 = transformPoint(x!, y!, state.ctm);
        const p1 = transformPoint(x! + w!, y!, state.ctm);
        const p2 = transformPoint(x! + w!, y! + h!, state.ctm);
        const p3 = transformPoint(x!, y! + h!, state.ctm);
        state.currentPath = [p0, p1, p2, p3, p0];
        break;
      }

      case OPS.closePath:
        if (state.currentPath.length > 0) {
          state.currentPath.push(state.currentPath[0]!);
        }
        break;

      case OPS.stroke: {
        const shape = createShapeElement(state.currentPath, pageHeight, state, false, true);
        if (shape) shapes.push(shape);
        state.currentPath = [];
        break;
      }

      case OPS.fill:
      case OPS.eoFill: {
        const shape = createShapeElement(state.currentPath, pageHeight, state, true, false);
        if (shape) shapes.push(shape);
        state.currentPath = [];
        break;
      }

      case OPS.fillStroke:
      case OPS.eoFillStroke: {
        const shape = createShapeElement(state.currentPath, pageHeight, state, true, true);
        if (shape) shapes.push(shape);
        state.currentPath = [];
        break;
      }

      case OPS.endPath:
        state.currentPath = [];
        break;

      case OPS.setStrokeRGBColor: {
        const [r, g, b] = args as number[];
        state.strokeColor = rgbToHex(r!, g!, b!);
        break;
      }

      case OPS.setFillRGBColor: {
        const [r, g, b] = args as number[];
        state.fillColor = rgbToHex(r!, g!, b!);
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
    }
  }

  return shapes;
}
