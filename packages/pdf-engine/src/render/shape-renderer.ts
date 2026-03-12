import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { ShapeElement } from '@giga-pdf/types';
import { hexToRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';

function getPage(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  return handle._pdfDoc.getPage(pageNumber - 1);
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
  const page = getPage(handle, pageNumber);
  const pageH = page.getHeight();
  const pdfRect = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    pageH,
  );

  const fillColor = element.style.fillColor ? hexToRgb(element.style.fillColor) : undefined;
  const borderColor = element.style.strokeColor ? hexToRgb(element.style.strokeColor) : undefined;
  const borderWidth = element.style.strokeWidth;
  const opacity = element.style.fillOpacity;
  const dashArray = element.style.strokeDashArray.length > 0
    ? element.style.strokeDashArray
    : undefined;

  switch (element.shapeType) {
    case 'rectangle': {
      page.drawRectangle({
        x: pdfRect.x,
        y: pdfRect.y,
        width: pdfRect.width,
        height: pdfRect.height,
        color: fillColor,
        borderColor,
        borderWidth,
        opacity,
      });
      break;
    }

    case 'circle':
    case 'ellipse': {
      const centerX = pdfRect.x + pdfRect.width / 2;
      const centerY = pdfRect.y + pdfRect.height / 2;
      page.drawEllipse({
        x: centerX,
        y: centerY,
        xScale: pdfRect.width / 2,
        yScale: pdfRect.height / 2,
        color: fillColor,
        borderColor,
        borderWidth,
        opacity,
      });
      break;
    }

    case 'line':
    case 'arrow': {
      const points = element.geometry.points;
      const start = points[0] ?? { x: pdfRect.x, y: pdfRect.y };
      const end = points[1] ?? { x: pdfRect.x + pdfRect.width, y: pdfRect.y + pdfRect.height };
      const startPdf = webToPdf(start.x, start.y, 0, 0, pageH);
      const endPdf = webToPdf(end.x, end.y, 0, 0, pageH);
      page.drawLine({
        start: { x: startPdf.x, y: startPdf.y },
        end: { x: endPdf.x, y: endPdf.y },
        color: borderColor ?? fillColor,
        thickness: borderWidth,
        opacity: element.style.strokeOpacity,
        dashArray,
      });
      break;
    }

    case 'polygon':
    case 'triangle':
    case 'path': {
      if (element.geometry.pathData) {
        page.drawSvgPath(element.geometry.pathData, {
          x: pdfRect.x,
          y: pdfRect.y + pdfRect.height,
          color: fillColor,
          borderColor,
          borderWidth,
          opacity,
        });
      } else if (element.geometry.points.length >= 2) {
        const svgPath = buildSvgPathFromPoints(element.geometry.points);
        if (svgPath) {
          page.drawSvgPath(svgPath, {
            x: pdfRect.x,
            y: pdfRect.y + pdfRect.height,
            color: fillColor,
            borderColor,
            borderWidth,
            opacity,
          });
        }
      }
      break;
    }

    default:
      break;
  }

  markDirty(handle._pdfDoc);
}
