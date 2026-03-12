import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type { ImageElement } from '@giga-pdf/types';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; }

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

export async function extractImageElements(
  page: PDFPageProxy,
  pageNumber: number,
  pageHeight: number,
  baseUrl?: string | null,
  documentId?: string,
): Promise<ImageElement[]> {
  const ops = await page.getOperatorList();
  const images: ImageElement[] = [];
  let imageIndex = 0;
  const fnArray = ops.fnArray;
  const argsArray = ops.argsArray;

  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const matrixStack: number[][] = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === OPS.save) {
      matrixStack.push([...ctm]);
    } else if (fn === OPS.restore) {
      ctm = matrixStack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.transform) {
      const [a, b, c, d, e, f] = argsArray[i] as number[];
      ctm = multiplyMatrices(ctm, [a!, b!, c!, d!, e!, f!]);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const width = Math.abs(ctm[0]!);
      const height = Math.abs(ctm[3]!);
      const x = ctm[4]!;
      const y = pageHeight - ctm[5]! - height;

      const dataUrl =
        baseUrl && documentId
          ? `${baseUrl}/api/pdf/${documentId}/pages/${pageNumber}/images/${imageIndex}`
          : '';

      images.push({
        elementId: randomUUID(),
        type: 'image',
        bounds: { x, y, width, height },
        transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
        layerId: null,
        locked: false,
        visible: true,
        source: {
          type: 'embedded',
          dataUrl,
          originalFormat: 'unknown',
          originalDimensions: { width, height },
        },
        style: { opacity: 1, blendMode: 'normal' },
        crop: null,
      });
      imageIndex++;
    }
  }

  return images;
}
