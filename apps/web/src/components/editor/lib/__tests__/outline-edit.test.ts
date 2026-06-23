import { describe, it, expect } from "vitest";
import type { BookmarkObject } from "@giga-pdf/types";
import {
  treeToFlat,
  flatToTree,
  insertBookmark,
  removeBookmark,
  renameBookmark,
  moveBookmark,
  reindentBookmark,
  type FlatBookmark,
} from "../outline-edit";

function bm(title: string, page: number, children: BookmarkObject[] = []): BookmarkObject {
  return {
    bookmarkId: `id-${title}`,
    title,
    destination: { pageNumber: page, position: null, zoom: null },
    style: { bold: false, italic: false, color: "#000000" },
    children,
  };
}

const TREE: BookmarkObject[] = [
  bm("Chapter 1", 1, [bm("Section 1.1", 2), bm("Section 1.2", 3)]),
  bm("Chapter 2", 4),
];

describe("treeToFlat / flatToTree", () => {
  it("flattens a tree to a level-encoded pre-order list", () => {
    const flat = treeToFlat(TREE);
    expect(flat.map((b) => [b.title, b.level, b.page])).toEqual([
      ["Chapter 1", 0, 1],
      ["Section 1.1", 1, 2],
      ["Section 1.2", 1, 3],
      ["Chapter 2", 0, 4],
    ]);
  });

  it("round-trips tree -> flat -> tree (structure preserved)", () => {
    const rebuilt = flatToTree(treeToFlat(TREE));
    expect(rebuilt).toHaveLength(2);
    expect(rebuilt[0]!.title).toBe("Chapter 1");
    expect(rebuilt[0]!.children.map((c) => c.title)).toEqual([
      "Section 1.1",
      "Section 1.2",
    ]);
    expect(rebuilt[0]!.destination.pageNumber).toBe(1);
    expect(rebuilt[1]!.title).toBe("Chapter 2");
    expect(rebuilt[1]!.children).toHaveLength(0);
  });

  it("clamps a level jump greater than +1 to parent + 1", () => {
    const flat: FlatBookmark[] = [
      { id: "a", title: "A", page: 1, level: 0 },
      { id: "b", title: "B", page: 2, level: 5 }, // illegal jump
    ];
    const tree = flatToTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.title).toBe("B");
  });

  it("a leading non-zero level becomes a root", () => {
    const flat: FlatBookmark[] = [{ id: "a", title: "A", page: 1, level: 3 }];
    const tree = flatToTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.title).toBe("A");
  });
});

describe("edit operations", () => {
  it("insertBookmark appends at the end by default", () => {
    const flat = insertBookmark(treeToFlat(TREE), 9, "New");
    expect(flat[flat.length - 1]!.title).toBe("New");
    expect(flat[flat.length - 1]!.page).toBe(9);
    expect(flat[flat.length - 1]!.level).toBe(0);
  });

  it("removeBookmark drops the matching id", () => {
    const flat = treeToFlat(TREE);
    const next = removeBookmark(flat, flat[1]!.id);
    expect(next.map((b) => b.title)).not.toContain("Section 1.1");
  });

  it("renameBookmark changes only the targeted title", () => {
    const flat = treeToFlat(TREE);
    const next = renameBookmark(flat, flat[0]!.id, "Renamed");
    expect(next[0]!.title).toBe("Renamed");
    expect(next[1]!.title).toBe("Section 1.1");
  });

  it("moveBookmark swaps positions and is bounded", () => {
    const flat = treeToFlat(TREE);
    const down = moveBookmark(flat, flat[0]!.id, 1);
    expect(down[0]!.title).toBe("Section 1.1");
    // moving the first item up is a no-op
    expect(moveBookmark(flat, flat[0]!.id, -1)).toEqual(flat);
  });

  it("reindent indent only when a valid parent precedes", () => {
    const flat = treeToFlat(TREE);
    // index 0 cannot indent (nothing before)
    expect(reindentBookmark(flat, flat[0]!.id, 1)).toEqual(flat);
    // index 3 (Chapter 2, level 0) can indent under index 2 (level 1) -> level 1
    const indented = reindentBookmark(flat, flat[3]!.id, 1);
    expect(indented[3]!.level).toBe(1);
  });

  it("reindent outdent floors at level 0", () => {
    const flat = treeToFlat(TREE);
    expect(reindentBookmark(flat, flat[0]!.id, -1)).toEqual(flat); // already 0
    const out = reindentBookmark(flat, flat[1]!.id, -1); // 1 -> 0
    expect(out[1]!.level).toBe(0);
  });
});
