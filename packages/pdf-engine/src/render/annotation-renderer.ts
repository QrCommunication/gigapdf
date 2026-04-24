/**
 * Annotation renderer — creates REAL PDF annotations (not baked content).
 *
 * Each annotation is added to the page's /Annots array as a standalone
 * PDF object so Adobe Reader, Preview, Chrome, etc. recognize them as
 * editable annotations (highlightable, deletable, commentable, printable
 * independently, etc.) rather than fixed ink on the page.
 *
 * Spec references: ISO 32000-1:2008 §12.5.6 (annotation types) — each
 * subtype section linked in the individual case below.
 */

import { StandardFonts, PDFName, PDFString, PDFArray, PDFHexString, type PDFRef, type PDFPage } from 'pdf-lib';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { AnnotationElement, AnnotationQuad, Bounds } from '@giga-pdf/types';
import { hexToRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';

/**
 * Parse a hex color to 0-1 components. We need plain numbers for PDF
 * dictionary /C entries; hexToRgb returns a pdf-lib Color opaque object
 * that can't be serialized into a dict.
 */
function hexTo01(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return {
    r: parseInt(full.substring(0, 2), 16) / 255,
    g: parseInt(full.substring(2, 4), 16) / 255,
    b: parseInt(full.substring(4, 6), 16) / 255,
  };
}

function getPage(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  return handle._pdfDoc.getPage(pageNumber - 1);
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

/**
 * Convert a web-coords quad (y growing downward) to PDF-coords quad
 * (y growing upward) relative to the page height.
 */
function quadToPdf(quad: AnnotationQuad, pageH: number): number[] {
  // PDF /QuadPoints order (spec): x1 y1 x2 y2 x3 y3 x4 y4
  // where points are typically tl, tr, bl, br of the highlighted rectangle.
  return [
    quad.x1, pageH - quad.y1,
    quad.x2, pageH - quad.y2,
    quad.x3, pageH - quad.y3,
    quad.x4, pageH - quad.y4,
  ];
}

/**
 * Build a default single-quad from bounds when the caller didn't provide
 * multiple runs (e.g., the old Fabric-shape path).
 */
function boundsToSingleQuad(bounds: Bounds): AnnotationQuad {
  const { x, y, width, height } = bounds;
  return {
    x1: x,          y1: y,
    x2: x + width,  y2: y,
    x3: x,          y3: y + height,
    x4: x + width,  y4: y + height,
  };
}

/** Append `annotRef` to the page's /Annots array (creates the array if missing). */
function appendAnnot(page: PDFPage, annotRef: PDFRef): void {
  const ctx = page.doc.context;
  const key = PDFName.of('Annots');
  const existing = page.node.lookup(key);
  if (existing instanceof PDFArray) {
    existing.push(annotRef);
  } else {
    page.node.set(key, ctx.obj([annotRef]));
  }
}

/** Shared base dictionary for every annotation subtype. */
function baseAnnotDict(
  subtype: string,
  rect: [number, number, number, number],
  element: AnnotationElement,
): Record<string, unknown> {
  const { r, g, b } = hexTo01(element.style.color);
  return {
    Type: 'Annot',
    Subtype: subtype,
    Rect: rect,
    F: 4, // printable
    M: PDFString.of(pdfDateNow()),
    Contents: PDFHexString.fromText(element.content ?? ''),
    T: PDFHexString.fromText(element.author ?? 'GigaPDF'),
    C: [r, g, b],
    CA: element.style.opacity,
    NM: PDFString.of(element.elementId),
  };
}

export async function addAnnotation(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: AnnotationElement,
): Promise<void> {
  const page = getPage(handle, pageNumber);
  const pageH = page.getHeight();
  const pdfRect = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    pageH,
  );
  const ctx = handle._pdfDoc.context;
  const { x, y, width, height } = pdfRect;
  const rect: [number, number, number, number] = [x, y, x + width, y + height];

  switch (element.annotationType) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'strikethrough':
    case 'squiggly': {
      const subtypeMap: Record<string, string> = {
        highlight: 'Highlight',
        underline: 'Underline',
        strikeout: 'StrikeOut',
        strikethrough: 'StrikeOut',
        squiggly: 'Squiggly',
      };
      const subtype = subtypeMap[element.annotationType] ?? 'Highlight';

      const quads = (element.quads && element.quads.length > 0)
        ? element.quads
        : [boundsToSingleQuad(element.bounds)];
      const quadPoints = quads.flatMap((q) => quadToPdf(q, pageH));

      const dict = ctx.obj({
        ...baseAnnotDict(subtype, rect, element),
        QuadPoints: quadPoints,
      });
      appendAnnot(page, ctx.register(dict));
      break;
    }

    case 'note':
    case 'comment': {
      // Sticky note — /Text annotation. Spec §12.5.6.4.
      // Rect is small & square; double-clicking in a viewer opens the
      // popup with Contents.
      const dict = ctx.obj({
        ...baseAnnotDict('Text', rect, element),
        Name: element.annotationType === 'comment' ? 'Comment' : 'Note',
        Open: element.popup?.isOpen ?? false,
      });
      appendAnnot(page, ctx.register(dict));
      break;
    }

    case 'freetext': {
      // Free text / BD-style bubble — /FreeText annotation. Spec §12.5.6.6.
      // DA = default appearance: font + size + color.
      const { r, g, b } = hexTo01(element.style.color);
      const da = `/Helv 12 Tf ${r} ${g} ${b} rg`;
      const dict = ctx.obj({
        ...baseAnnotDict('FreeText', rect, element),
        DA: PDFString.of(da),
        Q: 0, // left-aligned
      });
      appendAnnot(page, ctx.register(dict));
      break;
    }

    case 'stamp': {
      // /Stamp annotation with the text baked into the appearance stream.
      // pdf-lib doesn't expose AP streams easily; we still draw for now and
      // register a Stamp annot without AP (viewers will show a default icon).
      const font = await handle._pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontSize = Math.min(height * 0.6, 36);
      const color = hexToRgb(element.style.color);
      page.drawText(element.content || 'STAMP', {
        x,
        y: y + height / 2 - fontSize / 2,
        size: fontSize,
        font,
        color,
        opacity: element.style.opacity,
        maxWidth: width,
      });
      const dict = ctx.obj({
        ...baseAnnotDict('Stamp', rect, element),
        Name: 'Draft',
      });
      appendAnnot(page, ctx.register(dict));
      break;
    }

    case 'link': {
      if (!element.linkDestination) break;
      const linkDict = ctx.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: rect,
        Border: [0, 0, 0],
        F: 4,
        NM: PDFString.of(element.elementId),
      });

      if (element.linkDestination.url) {
        linkDict.set(
          PDFName.of('A'),
          ctx.obj({
            Type: 'Action',
            S: 'URI',
            URI: PDFString.of(element.linkDestination.url),
          }),
        );
      } else if (element.linkDestination.pageNumber !== null) {
        const destPageIndex = element.linkDestination.pageNumber - 1;
        if (destPageIndex >= 0 && destPageIndex < handle.pageCount) {
          const destPage = handle._pdfDoc.getPage(destPageIndex);
          linkDict.set(
            PDFName.of('Dest'),
            ctx.obj([destPage.ref, PDFName.of('XYZ'), null, null, null]),
          );
        }
      }

      appendAnnot(page, ctx.register(linkDict));
      break;
    }

    default:
      break;
  }

  markDirty(handle._pdfDoc);
}
