/**
 * Pure helpers for editing a document outline (table of contents).
 *
 * The external contract is a `BookmarkObject[]` tree (parse output + the
 * `/api/pdf/outline` payload). For editing we use a level-encoded FLAT list,
 * which makes reorder / indent / outdent trivial; we rebuild the tree on save.
 * Only `title`, `page` (destination) and depth are edited — label styling is
 * not persisted by the engine writer, so it is dropped on the round-trip.
 */

import type { BookmarkObject } from "@giga-pdf/types";

export interface FlatBookmark {
  /** Stable id for React keys + edit ops (reuses bookmarkId, or a synthetic). */
  id: string;
  title: string;
  /** 1-based destination page (>= 1). */
  page: number;
  /** Tree depth, 0 = top-level. */
  level: number;
}

let syntheticCounter = 0;
function nextId(): string {
  syntheticCounter += 1;
  return `new-${syntheticCounter}-${Date.now().toString(36)}`;
}

/** Flatten a bookmark tree to a pre-order, level-encoded list. */
export function treeToFlat(nodes: BookmarkObject[], level = 0, out: FlatBookmark[] = []): FlatBookmark[] {
  for (const node of nodes) {
    out.push({
      id: node.bookmarkId || nextId(),
      title: node.title ?? "",
      page: node.destination?.pageNumber ?? 1,
      level,
    });
    if (node.children && node.children.length > 0) {
      treeToFlat(node.children, level + 1, out);
    }
  }
  return out;
}

/**
 * Rebuild a `BookmarkObject[]` tree from a level-encoded flat list. Defensive
 * about malformed levels (clamps a child whose level jumps by more than 1 to
 * parent + 1) so a corrupted list can never produce a detached node.
 */
export function flatToTree(flat: FlatBookmark[]): BookmarkObject[] {
  const roots: BookmarkObject[] = [];
  const stack: { node: BookmarkObject; level: number }[] = [];

  for (const item of flat) {
    const level = Math.max(0, item.level);
    const node: BookmarkObject = {
      bookmarkId: item.id,
      title: item.title,
      destination: { pageNumber: item.page, position: null, zoom: null },
      style: { bold: false, italic: false, color: "#000000" },
      children: [],
    };

    // Pop until the stack top is a valid parent (level < this level).
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
      stack.push({ node, level: 0 });
    } else {
      const parent = stack[stack.length - 1]!;
      parent.node.children.push(node);
      // Effective level is parent + 1 even if the requested jump was larger.
      stack.push({ node, level: parent.level + 1 });
    }
  }

  return roots;
}

/** Insert a new bookmark at `index` (or end) with the given page, level 0. */
export function insertBookmark(
  flat: FlatBookmark[],
  page: number,
  title: string,
  index?: number,
): FlatBookmark[] {
  const item: FlatBookmark = { id: nextId(), title, page, level: 0 };
  const next = [...flat];
  const at = index === undefined ? next.length : Math.max(0, Math.min(index, next.length));
  next.splice(at, 0, item);
  return next;
}

export function removeBookmark(flat: FlatBookmark[], id: string): FlatBookmark[] {
  return flat.filter((b) => b.id !== id);
}

export function renameBookmark(flat: FlatBookmark[], id: string, title: string): FlatBookmark[] {
  return flat.map((b) => (b.id === id ? { ...b, title } : b));
}

/** Move an item up/down by one position (no level change). */
export function moveBookmark(flat: FlatBookmark[], id: string, dir: -1 | 1): FlatBookmark[] {
  const idx = flat.findIndex((b) => b.id === id);
  if (idx < 0) return flat;
  const target = idx + dir;
  if (target < 0 || target >= flat.length) return flat;
  const next = [...flat];
  const [item] = next.splice(idx, 1);
  next.splice(target, 0, item!);
  return next;
}

/**
 * Indent (+1) / outdent (-1) an item. Indent is only allowed when there is a
 * preceding item to nest under, and may not jump more than one level below the
 * previous item's level (keeps the tree well-formed). Outdent floors at 0.
 */
export function reindentBookmark(flat: FlatBookmark[], id: string, delta: -1 | 1): FlatBookmark[] {
  const idx = flat.findIndex((b) => b.id === id);
  if (idx < 0) return flat;
  const current = flat[idx]!;

  if (delta === 1) {
    if (idx === 0) return flat; // nothing to nest under
    const prevLevel = flat[idx - 1]!.level;
    const maxLevel = prevLevel + 1;
    if (current.level >= maxLevel) return flat;
    return flat.map((b) => (b.id === id ? { ...b, level: b.level + 1 } : b));
  }

  if (current.level === 0) return flat;
  return flat.map((b) => (b.id === id ? { ...b, level: b.level - 1 } : b));
}
