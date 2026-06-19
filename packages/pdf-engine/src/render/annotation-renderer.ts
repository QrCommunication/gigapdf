/**
 * Annotation renderer — creates REAL PDF annotations via the zero-dependency
 * engine. Each annotation lands in the page's `/Annots` (with an appearance
 * stream) so Adobe Reader, Preview, Chrome, etc. treat them as editable
 * annotations (highlightable, deletable, commentable) rather than baked ink.
 * No pdf-lib.
 */

import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { AnnotationElement, AnnotationQuad, Bounds } from '@giga-pdf/types';
import { hexToPackedRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';

interface PageGeom {
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

/**
 * Page geometry needed to place annotations correctly, including `/Rotate`.
 * Annotations MUST use the same rotation-aware conversion as text/image/shape
 * (via `webToPdf`) so markup lands on the right spot on rotated pages.
 */
function pageGeomOf(handle: PDFDocumentHandle, pageNumber: number): PageGeom {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  const info = handle._doc.pageInfo(pageNumber);
  const rotation = (((info.rotation ?? 0) % 360) + 360) % 360;
  return {
    width: info.width,
    height: info.height,
    rotation: rotation as 0 | 90 | 180 | 270,
  };
}

/** Current timestamp in PDF date format (D:YYYYMMDDHHmmSSZ). */
function pdfDateNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    'D:' +
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/** Default single quad from bounds when the caller passed no explicit runs. */
function boundsToSingleQuad(bounds: Bounds): AnnotationQuad {
  const { x, y, width, height } = bounds;
  return {
    x1: x,          y1: y,
    x2: x + width,  y2: y,
    x3: x,          y3: y + height,
    x4: x + width,  y4: y + height,
  };
}

/**
 * Convert a web-coords quad (y growing downward) to a PDF rect `[x0,y0,x1,y1]`
 * (bottom-left origin, y growing upward) for the engine's markup API. Uses the
 * shared rotation-aware `webToPdf` so quads land correctly on `/Rotate` pages.
 */
function webQuadToPdfRect(
  quad: AnnotationQuad,
  geom: PageGeom,
): [number, number, number, number] {
  const xs = [quad.x1, quad.x2, quad.x3, quad.x4];
  const ys = [quad.y1, quad.y2, quad.y3, quad.y4];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  const p = webToPdf(x, y, w, h, geom.height, geom.width, geom.rotation);
  return [p.x, p.y, p.x + p.width, p.y + p.height];
}

/** Convert a single web point `(x,y)` to PDF user space (rotation-aware). */
function webPointToPdf(x: number, y: number, geom: PageGeom): { x: number; y: number } {
  const p = webToPdf(x, y, 0, 0, geom.height, geom.width, geom.rotation);
  return { x: p.x, y: p.y };
}

const MARKUP_SUBTYPE: Record<string, 'highlight' | 'underline' | 'strikeout' | 'squiggly'> = {
  highlight: 'highlight',
  underline: 'underline',
  strikeout: 'strikeout',
  strikethrough: 'strikeout',
  squiggly: 'squiggly',
};

export async function addAnnotation(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: AnnotationElement,
): Promise<void> {
  const geom = pageGeomOf(handle, pageNumber);
  const doc = handle._doc;
  const rgb = hexToPackedRgb(element.style.color);

  const pdf = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    geom.height,
    geom.width,
    geom.rotation,
  );
  const rect: [number, number, number, number] = [
    pdf.x,
    pdf.y,
    pdf.x + pdf.width,
    pdf.y + pdf.height,
  ];
  const meta = {
    contents: element.content ?? '',
    author: element.author ?? 'GigaPDF',
    id: element.elementId,
    date: pdfDateNow(),
  };

  switch (element.annotationType) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'strikethrough':
    case 'squiggly': {
      const subtype = MARKUP_SUBTYPE[element.annotationType] ?? 'highlight';
      const quads =
        element.quads && element.quads.length > 0
          ? element.quads
          : [boundsToSingleQuad(element.bounds)];
      const pdfQuads = quads.map((q) => webQuadToPdfRect(q, geom));
      doc.addMarkupAnnotation(pageNumber, subtype, pdfQuads, rgb, element.style.opacity, meta);
      break;
    }

    case 'line':
    case 'arrow': {
      const lp = element.linePoints ?? {
        x1: element.bounds.x,
        y1: element.bounds.y,
        x2: element.bounds.x + element.bounds.width,
        y2: element.bounds.y + element.bounds.height,
      };
      const p1 = webPointToPdf(lp.x1, lp.y1, geom);
      const p2 = webPointToPdf(lp.x2, lp.y2, geom);
      const lineWidth = element.style.strokeWidth ?? 2;
      // The arrowhead is drawn at the (x2,y2) end — see SDK addLineAnnotation.
      doc.addLineAnnotation(
        pageNumber,
        p1.x,
        p1.y,
        p2.x,
        p2.y,
        rgb,
        lineWidth,
        element.annotationType === 'arrow',
      );
      break;
    }

    case 'note':
    case 'comment': {
      const icon = element.annotationType === 'comment' ? 'Comment' : 'Note';
      doc.addTextNote(pageNumber, rect, rgb, meta, icon, element.popup?.isOpen ?? false);
      break;
    }

    case 'freetext': {
      doc.addFreeText(pageNumber, rect[0], rect[1], rect[2], rect[3], element.content ?? '', 12, rgb);
      break;
    }

    case 'stamp': {
      doc.addStamp(pageNumber, rect[0], rect[1], rect[2], rect[3], element.content || 'STAMP', rgb);
      break;
    }

    case 'link': {
      if (!element.linkDestination) break;
      if (element.linkDestination.url) {
        doc.addUriLink(pageNumber, rect[0], rect[1], rect[2], rect[3], element.linkDestination.url);
      } else if (
        element.linkDestination.pageNumber !== null &&
        element.linkDestination.pageNumber >= 1 &&
        element.linkDestination.pageNumber <= handle.pageCount
      ) {
        doc.addGotoLink(pageNumber, rect[0], rect[1], rect[2], rect[3], element.linkDestination.pageNumber);
      }
      break;
    }

    default:
      break;
  }

  markDirty(doc);
}
