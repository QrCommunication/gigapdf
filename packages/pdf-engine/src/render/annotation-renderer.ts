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

function pageHeightOf(handle: PDFDocumentHandle, pageNumber: number): number {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  return handle._doc.pageInfo(pageNumber).height;
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
 * (bottom-left origin, y growing upward) for the engine's markup API.
 */
function webQuadToPdfRect(
  quad: AnnotationQuad,
  pageH: number,
): [number, number, number, number] {
  const xs = [quad.x1, quad.x2, quad.x3, quad.x4];
  const ys = [quad.y1, quad.y2, quad.y3, quad.y4];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yTopWeb = Math.min(...ys); // smaller web-y = visually higher
  const yBotWeb = Math.max(...ys);
  return [x0, pageH - yBotWeb, x1, pageH - yTopWeb];
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
  const pageH = pageHeightOf(handle, pageNumber);
  const doc = handle._doc;
  const rgb = hexToPackedRgb(element.style.color);

  const pdf = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    pageH,
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
      const pdfQuads = quads.map((q) => webQuadToPdfRect(q, pageH));
      doc.addMarkupAnnotation(pageNumber, subtype, pdfQuads, rgb, element.style.opacity, meta);
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
