import { StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { AnnotationElement } from '@giga-pdf/types';
import { hexToRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import { PDFPageOutOfRangeError } from '../errors';

function getPage(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  return handle._pdfDoc.getPage(pageNumber - 1);
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

  const color = hexToRgb(element.style.color);
  const opacity = element.style.opacity;
  const { x, y, width, height } = pdfRect;

  switch (element.annotationType) {
    case 'highlight': {
      page.drawRectangle({
        x,
        y,
        width,
        height,
        color,
        opacity: opacity * 0.3,
      });
      break;
    }

    case 'underline': {
      page.drawLine({
        start: { x, y },
        end: { x: x + width, y },
        color,
        thickness: 1,
        opacity,
      });
      break;
    }

    case 'strikeout':
    case 'strikethrough': {
      const midY = y + height / 2;
      page.drawLine({
        start: { x, y: midY },
        end: { x: x + width, y: midY },
        color,
        thickness: 1,
        opacity,
      });
      break;
    }

    case 'squiggly': {
      page.drawLine({
        start: { x, y },
        end: { x: x + width, y },
        color,
        thickness: 1,
        opacity,
        dashArray: [3, 2],
      });
      break;
    }

    case 'note':
    case 'comment': {
      page.drawRectangle({
        x,
        y,
        width: 20,
        height: 20,
        color: rgb(1, 0.9, 0.3),
        borderColor: rgb(0.8, 0.7, 0),
        borderWidth: 1,
        opacity,
      });
      break;
    }

    case 'freetext': {
      const font = await handle._pdfDoc.embedFont(StandardFonts.Helvetica);
      page.drawText(element.content, {
        x,
        y: y + height - 12,
        size: 12,
        font,
        color,
        opacity,
        maxWidth: width,
      });
      break;
    }

    case 'stamp': {
      const font = await handle._pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontSize = Math.min(height * 0.6, 36);
      page.drawText(element.content || 'STAMP', {
        x,
        y: y + height / 2 - fontSize / 2,
        size: fontSize,
        font,
        color,
        opacity,
        maxWidth: width,
      });
      break;
    }

    case 'link': {
      if (element.linkDestination) {
        const { context } = handle._pdfDoc;

        const linkDict = context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [x, y, x + width, y + height],
          Border: [0, 0, 0],
        });

        if (element.linkDestination.url) {
          linkDict.set(
            PDFName.of('A'),
            context.obj({
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
              context.obj([destPage.ref, PDFName.of('XYZ'), null, null, null]),
            );
          }
        }

        const linkRef = context.register(linkDict);

        const annotsKey = PDFName.of('Annots');
        const existingAnnots = page.node.lookup(annotsKey);

        if (existingAnnots && 'push' in existingAnnots) {
          (existingAnnots as { push: (ref: typeof linkRef) => void }).push(linkRef);
        } else {
          page.node.set(annotsKey, context.obj([linkRef]));
        }
      }
      break;
    }

    default:
      break;
  }

  markDirty(handle._pdfDoc);
}
