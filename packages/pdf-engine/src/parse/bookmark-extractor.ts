import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type { BookmarkObject, BookmarkDestination, BookmarkStyle } from '@giga-pdf/types';
import { rgbToHex } from '../utils';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; }

interface OutlineItem {
  title: string;
  bold?: boolean;
  italic?: boolean;
  color?: Uint8ClampedArray | null;
  dest?: string | unknown[] | null;
  url?: string | null;
  items?: OutlineItem[];
}

async function resolveDestination(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null | undefined,
): Promise<BookmarkDestination> {
  if (!dest) {
    return { pageNumber: 1, position: null, zoom: null };
  }

  try {
    let destArray: unknown[] | null = null;

    if (typeof dest === 'string') {
      destArray = await doc.getDestination(dest);
    } else if (Array.isArray(dest)) {
      destArray = dest;
    }

    if (!destArray || destArray.length === 0) {
      return { pageNumber: 1, position: null, zoom: null };
    }

    const pageRef = destArray[0] as { num: number; gen: number };
    const pageIndex = await doc.getPageIndex(pageRef);
    const pageNumber = pageIndex + 1;

    const fitType = destArray[1] as { name?: string } | string | undefined;
    const fitName = typeof fitType === 'object' && fitType?.name ? fitType.name : String(fitType ?? '');

    let position: { x: number; y: number } | null = null;
    let zoom: number | 'fit' | 'fit-width' | 'fit-height' | null = null;

    if (fitName === 'XYZ') {
      const x = destArray[2] as number | null;
      const y = destArray[3] as number | null;
      const z = destArray[4] as number | null;
      if (x !== null && y !== null) position = { x: x ?? 0, y: y ?? 0 };
      if (z !== null && z !== undefined) zoom = z;
    } else if (fitName === 'Fit') {
      zoom = 'fit';
    } else if (fitName === 'FitH') {
      zoom = 'fit-width';
    } else if (fitName === 'FitV') {
      zoom = 'fit-height';
    }

    return { pageNumber, position, zoom };
  } catch {
    return { pageNumber: 1, position: null, zoom: null };
  }
}

async function mapOutlineItem(
  doc: PDFDocumentProxy,
  item: OutlineItem,
): Promise<BookmarkObject> {
  const destination = await resolveDestination(doc, item.dest);

  const color = item.color
    ? rgbToHex(item.color[0]! / 255, item.color[1]! / 255, item.color[2]! / 255)
    : '#000000';

  const style: BookmarkStyle = {
    bold: item.bold ?? false,
    italic: item.italic ?? false,
    color,
  };

  const children: BookmarkObject[] = [];
  if (item.items && item.items.length > 0) {
    for (const child of item.items) {
      children.push(await mapOutlineItem(doc, child));
    }
  }

  return {
    bookmarkId: randomUUID(),
    title: item.title ?? '',
    destination,
    style,
    children,
  };
}

export async function extractBookmarks(doc: PDFDocumentProxy): Promise<BookmarkObject[]> {
  const outline = await doc.getOutline();
  if (!outline || outline.length === 0) return [];

  const bookmarks: BookmarkObject[] = [];
  for (const item of outline as OutlineItem[]) {
    bookmarks.push(await mapOutlineItem(doc, item));
  }

  return bookmarks;
}
