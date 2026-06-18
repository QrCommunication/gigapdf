import { randomUUID } from 'node:crypto';
import type { BookmarkObject, BookmarkDestination, BookmarkStyle } from '@giga-pdf/types';
import type { OutlineEntry } from '@qrcommunication/gigapdf-lib';
import { rgbToHex } from '../utils';
import { getEngine } from '../wasm';

/**
 * Extract the document outline (bookmarks) via the native engine — no pdfjs.
 * `outline()` returns a flat, pre-order list with a `level` per entry plus the
 * resolved destination page, `/XYZ` position/zoom, and `/F`/`/C` style; this
 * rebuilds the tree (by `level`) and maps each node to a `BookmarkObject`.
 */

function mapZoom(entry: OutlineEntry): BookmarkDestination['zoom'] {
  switch (entry.destKind) {
    case 'xyz':
      return typeof entry.zoom === 'number' && entry.zoom > 0 ? entry.zoom : null;
    case 'fit':
    case 'fitb':
      return 'fit';
    case 'fith':
    case 'fitbh':
      return 'fit-width';
    case 'fitv':
    case 'fitbv':
      return 'fit-height';
    default:
      return null;
  }
}

function mapEntry(entry: OutlineEntry): BookmarkObject {
  const position =
    entry.destKind === 'xyz' && typeof entry.x === 'number' && typeof entry.y === 'number'
      ? { x: entry.x, y: entry.y }
      : null;

  const destination: BookmarkDestination = {
    pageNumber: entry.page ?? 1,
    position,
    zoom: mapZoom(entry),
  };

  const style: BookmarkStyle = {
    bold: entry.bold ?? false,
    italic: entry.italic ?? false,
    color: entry.color ? rgbToHex(entry.color[0], entry.color[1], entry.color[2]) : '#000000',
  };

  return {
    bookmarkId: randomUUID(),
    title: entry.title ?? '',
    destination,
    style,
    children: [],
  };
}

export async function extractBookmarks(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<BookmarkObject[]> {
  try {
    const giga = await getEngine();
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = giga.open(bytes);
    try {
      const roots: BookmarkObject[] = [];
      // parents[level] = the most recent node at that depth; a node at `level`
      // attaches to parents[level - 1]. Entries arrive pre-order, so the parent
      // is always already present.
      const parents: BookmarkObject[] = [];
      for (const entry of doc.outline()) {
        const node = mapEntry(entry);
        const level = entry.level;
        if (level === 0) {
          roots.push(node);
        } else {
          const parent = parents[level - 1];
          if (parent) parent.children.push(node);
          else roots.push(node); // malformed level jump → treat as a root
        }
        parents[level] = node;
        parents.length = level + 1; // forget deeper levels
      }
      return roots;
    } finally {
      doc.close();
    }
  } catch {
    return [];
  }
}
