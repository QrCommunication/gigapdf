import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type { AnnotationElement, AnnotationType, LinkDestination } from '@giga-pdf/types';
import { pdfToWeb, rgbToHex } from '../utils';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; }

const ANNOTATION_TYPE_MAP: Record<number, AnnotationType> = {
  1: 'note',
  2: 'link',
  3: 'freetext',
  8: 'highlight',
  9: 'underline',
  10: 'squiggly',
  11: 'strikeout',
  13: 'stamp',
};

function colorFromUint8(color: Uint8ClampedArray | null | undefined): string {
  if (!color || color.length < 3) return '#000000';
  return rgbToHex(color[0]! / 255, color[1]! / 255, color[2]! / 255);
}

export async function extractAnnotationElements(
  page: PDFPageProxy,
  _pageNumber: number,
  pageHeight: number,
): Promise<AnnotationElement[]> {
  const annotations = await page.getAnnotations();
  const elements: AnnotationElement[] = [];

  for (const annotation of annotations) {
    if (annotation.subtype === 'Widget') continue;

    const annotationType = ANNOTATION_TYPE_MAP[annotation.annotationType as number];
    if (!annotationType) continue;

    const [x1, y1, x2, y2] = annotation.rect as number[];
    const width = Math.abs((x2 ?? 0) - (x1 ?? 0));
    const height = Math.abs((y2 ?? 0) - (y1 ?? 0));
    const bounds = pdfToWeb(x1 ?? 0, y1 ?? 0, width, height, pageHeight);

    const color = colorFromUint8(annotation.color as Uint8ClampedArray | null | undefined);

    const contentObj = annotation.contentsObj as { str?: string } | undefined;
    const content: string =
      contentObj?.str ?? (typeof annotation.contents === 'string' ? annotation.contents : '');

    let linkDestination: LinkDestination | null = null;
    if (annotationType === 'link') {
      if (annotation.url) {
        linkDestination = {
          type: 'external',
          pageNumber: null,
          url: annotation.url as string,
          position: null,
        };
      } else if (annotation.dest) {
        linkDestination = {
          type: 'internal',
          pageNumber: null,
          url: null,
          position: null,
        };
      }
    }

    elements.push({
      elementId: randomUUID(),
      type: 'annotation',
      bounds,
      transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      layerId: null,
      locked: false,
      visible: true,
      annotationType,
      content,
      style: { color, opacity: 1 },
      linkDestination,
      popup: null,
    });
  }

  return elements;
}
