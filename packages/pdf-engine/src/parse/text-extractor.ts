import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy, TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type { TextElement } from '@giga-pdf/types';
import { mapPdfFontToStandard } from '../utils';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; }

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item;
}

export async function extractTextElements(
  page: PDFPageProxy,
  _pageNumber: number,
  pageHeight: number,
): Promise<TextElement[]> {
  const textContent = await page.getTextContent();
  const elements: TextElement[] = [];

  for (const item of textContent.items) {
    if (!isTextItem(item)) continue;
    if (!item.str || item.str.trim() === '') continue;

    const [a, b, , , tx, ty] = item.transform as number[];
    const fontSize = Math.sqrt((a ?? 1) * (a ?? 1) + (b ?? 0) * (b ?? 0));
    const width = item.width;
    const height = item.height > 0 ? item.height : fontSize;
    const x = tx ?? 0;
    const y = pageHeight - (ty ?? 0) - height;

    const { fontFamily, fontWeight, fontStyle } = mapPdfFontToStandard(item.fontName ?? '');

    elements.push({
      elementId: randomUUID(),
      type: 'text',
      bounds: { x, y, width, height },
      transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      layerId: null,
      locked: false,
      visible: true,
      content: item.str,
      style: {
        fontFamily,
        fontWeight,
        fontStyle,
        fontSize,
        color: '#000000',
        opacity: 1,
        textAlign: 'left',
        lineHeight: 1.2,
        letterSpacing: 0,
        writingMode: 'horizontal-tb',
        underline: false,
        strikethrough: false,
        backgroundColor: null,
        verticalAlign: 'baseline',
        originalFont: item.fontName ?? null,
      },
      ocrConfidence: null,
      linkUrl: null,
      linkPage: null,
    });
  }

  return elements;
}
