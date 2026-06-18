import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { ShapeElement } from '@giga-pdf/types';
import { hexToPackedRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';

function pageGeometry(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  const { width, height, rotation } = handle._doc.pageInfo(pageNumber);
  return { width, height, rotation: rotation as 0 | 90 | 180 | 270 };
}

function buildSvgPathFromPoints(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return '';
  const [first, ...rest] = points;
  const move = `M ${first!.x} ${first!.y}`;
  const lines = rest.map((p) => `L ${p.x} ${p.y}`).join(' ');
  return `${move} ${lines} Z`;
}

export function addShape(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: ShapeElement,
): void {
  const { width: pageW, height: pageH, rotation } = pageGeometry(handle, pageNumber);
  const pdfRect = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    pageH,
    pageW,
    rotation,
  );

  const doc = handle._doc;
  const fill = element.style.fillColor ? hexToPackedRgb(element.style.fillColor) : null;
  const stroke = element.style.strokeColor ? hexToPackedRgb(element.style.strokeColor) : null;
  const borderWidth = element.style.strokeWidth;
  const opacity = element.style.fillOpacity;

  switch (element.shapeType) {
    case 'rectangle': {
      doc.addRectangle(
        pageNumber,
        pdfRect.x,
        pdfRect.y,
        pdfRect.width,
        pdfRect.height,
        stroke,
        fill,
        borderWidth,
        opacity,
      );
      break;
    }

    case 'circle':
    case 'ellipse': {
      const centerX = pdfRect.x + pdfRect.width / 2;
      const centerY = pdfRect.y + pdfRect.height / 2;
      doc.addEllipse(
        pageNumber,
        centerX,
        centerY,
        pdfRect.width / 2,
        pdfRect.height / 2,
        stroke,
        fill,
        borderWidth,
        opacity,
      );
      break;
    }

    case 'line':
    case 'arrow': {
      const points = element.geometry.points;
      const start = points[0] ?? { x: pdfRect.x, y: pdfRect.y };
      const end = points[1] ?? { x: pdfRect.x + pdfRect.width, y: pdfRect.y + pdfRect.height };
      const startPdf = webToPdf(start.x, start.y, 0, 0, pageH, pageW, rotation);
      const endPdf = webToPdf(end.x, end.y, 0, 0, pageH, pageW, rotation);
      doc.drawLine(
        pageNumber,
        startPdf.x,
        startPdf.y,
        endPdf.x,
        endPdf.y,
        stroke ?? fill ?? 0,
        borderWidth,
        element.style.strokeOpacity,
      );
      break;
    }

    case 'polygon':
    case 'triangle':
    case 'path': {
      // addPath anchors the SVG origin at (ox, oy) with the Y axis flipped —
      // same convention as pdf-lib's drawSvgPath, so the top-left anchor is the
      // rect's top edge: (x, y + height).
      const svgPath = element.geometry.pathData
        ? element.geometry.pathData
        : element.geometry.points.length >= 2
          ? buildSvgPathFromPoints(element.geometry.points)
          : '';
      if (svgPath) {
        doc.addPath(
          pageNumber,
          svgPath,
          pdfRect.x,
          pdfRect.y + pdfRect.height,
          stroke,
          fill,
          borderWidth,
          opacity,
        );
      }
      break;
    }

    default:
      break;
  }

  markDirty(doc);
}
