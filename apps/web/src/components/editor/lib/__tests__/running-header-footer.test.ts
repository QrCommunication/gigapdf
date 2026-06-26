/**
 * running-header-footer.test.ts
 *
 * Pure-helper coverage for the SL2 running-H/F model: token substitution,
 * anchor → px placement, zone selection, immutable item edits, the
 * style ↔ item mapping (FormattingToolbar bridge) and the image registry.
 */
import { describe, it, expect } from "vitest";
import {
  substituteHFTokens,
  resolveAnchorLeftPx,
  resolveAnchorTopPx,
  selectZoneForPage,
  resolveZoneKeyForPage,
  ensureZone,
  zoneForKey,
  appendItemToZone,
  updateItemInZone,
  removeItemFromZone,
  emptyRunningHeaderFooter,
  isRunningHeaderFooterEmpty,
  appendItemToDefault,
  updateItemInDefault,
  removeItemFromDefault,
  makeTextItem,
  makeImageItem,
  hfColorToHex,
  hexToHfColor,
  anchorFromTextAlign,
  textAlignFromAnchor,
  applyTextStylePatch,
  appendTokenToText,
  HFImageRegistry,
  type HFZone,
  type RunningHeaderFooter,
} from "../running-header-footer";

describe("substituteHFTokens", () => {
  it("substitutes the four tokens", () => {
    const out = substituteHFTokens(
      "{{title}} — {{page}}/{{pages}} ({{date}})",
      { page: 3, pages: 10, date: "2026-06-26", title: "Report" },
    );
    expect(out).toBe("Report — 3/10 (2026-06-26)");
  });

  it("renders missing date/title as empty and leaves other text verbatim", () => {
    expect(substituteHFTokens("Page {{page}} of {{pages}}", { page: 1, pages: 1 }))
      .toBe("Page 1 of 1");
    expect(substituteHFTokens("[{{date}}][{{title}}]", { page: 1, pages: 1 }))
      .toBe("[][]");
  });

  it("tolerates inner whitespace in the token braces", () => {
    expect(substituteHFTokens("{{ page }}", { page: 7, pages: 9 })).toBe("7");
  });
});

describe("resolveAnchorLeftPx", () => {
  // Band 600px, item 100px, 2 px per point.
  it("places left/center/right at the right base", () => {
    expect(resolveAnchorLeftPx("left", 0, 600, 100, 2)).toBe(0);
    expect(resolveAnchorLeftPx("center", 0, 600, 100, 2)).toBe(250);
    expect(resolveAnchorLeftPx("right", 0, 600, 100, 2)).toBe(500);
  });

  it("adds the dx nudge in px (+dx → right)", () => {
    expect(resolveAnchorLeftPx("left", 10, 600, 100, 2)).toBe(20);
    expect(resolveAnchorLeftPx("center", -5, 600, 100, 2)).toBe(240);
  });
});

describe("resolveAnchorTopPx", () => {
  it("anchors header to the top and footer to the bottom; +dy nudges up", () => {
    expect(resolveAnchorTopPx("header", 0, 72, 12, 2)).toBe(0);
    expect(resolveAnchorTopPx("header", 5, 72, 12, 2)).toBe(-10);
    expect(resolveAnchorTopPx("footer", 0, 72, 12, 2)).toBe(60);
    expect(resolveAnchorTopPx("footer", 5, 72, 12, 2)).toBe(50);
  });
});

describe("selectZoneForPage", () => {
  const def: RunningHeaderFooter = {
    default: { header: [makeTextItem("D")], footer: [] },
    firstPage: { header: [makeTextItem("F")], footer: [] },
    evenPage: { header: [makeTextItem("E")], footer: [] },
    oddPage: { header: [makeTextItem("O")], footer: [] },
  };

  it("always returns default in SL2 (no override flags set)", () => {
    expect(selectZoneForPage(def, 1).header[0]).toMatchObject({ text: "D" });
    expect(selectZoneForPage(def, 2).header[0]).toMatchObject({ text: "D" });
  });

  it("resolves firstPage / even / odd when the flags are set (SL3-ready)", () => {
    const first = { ...def, differentFirstPage: true };
    expect(selectZoneForPage(first, 1).header[0]).toMatchObject({ text: "F" });
    expect(selectZoneForPage(first, 2).header[0]).toMatchObject({ text: "D" });

    const oddEven = { ...def, differentOddEven: true };
    expect(selectZoneForPage(oddEven, 2).header[0]).toMatchObject({ text: "E" });
    expect(selectZoneForPage(oddEven, 3).header[0]).toMatchObject({ text: "O" });
  });

  it("falls back to default when an override zone is omitted", () => {
    const partial: RunningHeaderFooter = {
      default: { header: [makeTextItem("D")], footer: [] },
      differentOddEven: true,
      evenPage: null,
    };
    expect(selectZoneForPage(partial, 2).header[0]).toMatchObject({ text: "D" });
  });
});

describe("resolveZoneKeyForPage (SL3 editing target)", () => {
  const base: RunningHeaderFooter = {
    default: { header: [], footer: [] },
  };

  it("returns default when no flags are set", () => {
    expect(resolveZoneKeyForPage(base, 1)).toBe("default");
    expect(resolveZoneKeyForPage(base, 2)).toBe("default");
  });

  it("scopes page 1 to firstPage when differentFirstPage", () => {
    const def = { ...base, differentFirstPage: true };
    expect(resolveZoneKeyForPage(def, 1)).toBe("firstPage");
    // page 2 falls through to default (no odd/even flag)
    expect(resolveZoneKeyForPage(def, 2)).toBe("default");
  });

  it("scopes even/odd pages when differentOddEven", () => {
    const def = { ...base, differentOddEven: true };
    expect(resolveZoneKeyForPage(def, 2)).toBe("evenPage");
    expect(resolveZoneKeyForPage(def, 3)).toBe("oddPage");
  });

  it("firstPage wins over odd/even on page 1 when both flags set", () => {
    const def = { ...base, differentFirstPage: true, differentOddEven: true };
    expect(resolveZoneKeyForPage(def, 1)).toBe("firstPage");
    expect(resolveZoneKeyForPage(def, 2)).toBe("evenPage");
    expect(resolveZoneKeyForPage(def, 3)).toBe("oddPage");
  });

  it("unlike selectZoneForPage, returns the key even when the zone is absent", () => {
    const def = { ...base, differentFirstPage: true };
    // The override is omitted: selectZoneForPage falls back to default…
    expect(selectZoneForPage(def, 1)).toBe(def.default);
    // …but the editing key still points at firstPage so we initialise + write it.
    expect(resolveZoneKeyForPage(def, 1)).toBe("firstPage");
  });
});

describe("ensureZone", () => {
  it("seeds a missing override zone from a copy of default", () => {
    const def = appendItemToDefault(
      emptyRunningHeaderFooter(),
      "header",
      makeTextItem("D"),
    );
    const next = ensureZone(def, "firstPage");
    expect(next.firstPage).toBeDefined();
    expect(next.firstPage?.header).toHaveLength(1);
    expect(next.firstPage?.header[0]).toMatchObject({ text: "D" });
    // Deep copy: mutating the seed never reaches default (immutability contract).
    expect(next.firstPage?.header[0]).not.toBe(def.default.header[0]);
    expect(next).not.toBe(def);
  });

  it("is a no-op for default and for an already-present zone", () => {
    const def = emptyRunningHeaderFooter();
    expect(ensureZone(def, "default")).toBe(def);
    const seeded = ensureZone(def, "evenPage");
    // calling again returns the same object (idempotent)
    expect(ensureZone(seeded, "evenPage")).toBe(seeded);
  });
});

describe("zone-addressed item edits", () => {
  it("appendItemToZone seeds + writes an absent override zone", () => {
    const def = emptyRunningHeaderFooter();
    const next = appendItemToZone(def, "firstPage", "header", makeTextItem("F"));
    expect(next.firstPage?.header).toHaveLength(1);
    expect(next.firstPage?.header[0]).toMatchObject({ text: "F" });
    // default zone untouched
    expect(next.default.header).toHaveLength(0);
  });

  it("updateItemInZone / removeItemFromZone edit only the targeted zone", () => {
    let def = appendItemToZone(
      emptyRunningHeaderFooter(),
      "evenPage",
      "footer",
      makeTextItem("a"),
    );
    def = appendItemToZone(def, "evenPage", "footer", makeTextItem("b"));
    const updated = updateItemInZone(def, "evenPage", "footer", 1, {
      text: "B",
    });
    expect(updated.evenPage?.footer[1]).toMatchObject({ text: "B" });
    const removed = removeItemFromZone(updated, "evenPage", "footer", 0);
    expect(removed.evenPage?.footer).toHaveLength(1);
    expect(removed.evenPage?.footer[0]).toMatchObject({ text: "B" });
  });

  it("updateItemInZone is a no-op (identity) for an out-of-range index", () => {
    const def = appendItemToZone(
      emptyRunningHeaderFooter(),
      "oddPage",
      "header",
      makeTextItem("x"),
    );
    expect(updateItemInZone(def, "oddPage", "header", 9, { text: "z" })).toBe(
      def,
    );
  });

  it("zoneForKey returns default for 'default' and empty for an absent override", () => {
    const def = emptyRunningHeaderFooter();
    expect(zoneForKey(def, "default")).toBe(def.default);
    const empty = zoneForKey(def, "firstPage");
    expect(empty.header).toEqual([]);
    expect(empty.footer).toEqual([]);
  });
});

describe("immutable zone/item edits", () => {
  it("appendItemToDefault adds without mutating the source", () => {
    const def = emptyRunningHeaderFooter();
    const next = appendItemToDefault(def, "header", makeTextItem("Hi"));
    expect(def.default.header).toHaveLength(0); // unchanged
    expect(next.default.header).toHaveLength(1);
    expect(next.default.header[0]).toMatchObject({ type: "text", text: "Hi" });
    expect(next).not.toBe(def);
  });

  it("updateItemInDefault patches the addressed item, leaves others", () => {
    let def = emptyRunningHeaderFooter();
    def = appendItemToDefault(def, "footer", makeTextItem("a"));
    def = appendItemToDefault(def, "footer", makeTextItem("b"));
    const next = updateItemInDefault(def, "footer", 1, { text: "B" });
    expect(next.default.footer[0]).toMatchObject({ text: "a" });
    expect(next.default.footer[1]).toMatchObject({ text: "B" });
  });

  it("updateItemInDefault is a no-op for an out-of-range index", () => {
    const def = appendItemToDefault(
      emptyRunningHeaderFooter(),
      "header",
      makeTextItem("x"),
    );
    expect(updateItemInDefault(def, "header", 9, { text: "z" })).toBe(def);
  });

  it("removeItemFromDefault drops the addressed item", () => {
    let def = emptyRunningHeaderFooter();
    def = appendItemToDefault(def, "header", makeTextItem("a"));
    def = appendItemToDefault(def, "header", makeTextItem("b"));
    const next = removeItemFromDefault(def, "header", 0);
    expect(next.default.header).toHaveLength(1);
    expect(next.default.header[0]).toMatchObject({ text: "b" });
  });
});

describe("isRunningHeaderFooterEmpty", () => {
  it("is empty for null and for an all-empty definition", () => {
    expect(isRunningHeaderFooterEmpty(null)).toBe(true);
    expect(isRunningHeaderFooterEmpty(emptyRunningHeaderFooter())).toBe(true);
  });

  it("is non-empty once any band carries an item", () => {
    const def = appendItemToDefault(
      emptyRunningHeaderFooter(),
      "footer",
      makeImageItem(1, 80, 24),
    );
    expect(isRunningHeaderFooterEmpty(def)).toBe(false);
  });
});

describe("style ↔ item mapping", () => {
  it("round-trips colour hex ↔ rgb", () => {
    expect(hfColorToHex([255, 0, 128])).toBe("#ff0080");
    expect(hexToHfColor("#ff0080")).toEqual([255, 0, 128]);
    expect(hexToHfColor("bad")).toEqual([0, 0, 0]);
  });

  it("maps text-align ↔ anchor (justify collapses to left)", () => {
    expect(anchorFromTextAlign("center")).toBe("center");
    expect(anchorFromTextAlign("justify")).toBe("left");
    expect(textAlignFromAnchor("right")).toBe("right");
    expect(textAlignFromAnchor(undefined)).toBe("left");
  });

  it("applyTextStylePatch maps the supported fields and ignores the rest", () => {
    const item = makeTextItem("hi");
    const next = applyTextStylePatch(item, {
      fontWeight: "bold",
      fontStyle: "italic",
      color: "#112233",
      fontSize: 14,
      textAlign: "center",
      // unsupported by the H/F model — must be ignored, not crash:
      lineHeight: 2,
    } as never);
    expect(next).toMatchObject({
      bold: true,
      italic: true,
      color: [0x11, 0x22, 0x33],
      size: 14,
      anchor: "center",
    });
    expect(item.bold).toBeUndefined(); // source untouched
  });

  it("appendTokenToText appends with a single separating space", () => {
    expect(appendTokenToText("", "page")).toBe("{{page}}");
    expect(appendTokenToText("Page", "page")).toBe("Page {{page}}");
    expect(appendTokenToText("Page ", "page")).toBe("Page {{page}}");
  });
});

describe("HFImageRegistry", () => {
  it("allocates monotonic ids and reads them back", () => {
    const reg = new HFImageRegistry();
    const a = reg.add(new Uint8Array([1]));
    const b = reg.add(new Uint8Array([2]));
    expect([a, b]).toEqual([1, 2]);
    expect(reg.get(a)).toEqual(new Uint8Array([1]));
    expect(reg.has(b)).toBe(true);
    expect(reg.has(99)).toBe(false);
    expect(reg.size).toBe(2);
  });

  it("toMap returns an independent snapshot", () => {
    const reg = new HFImageRegistry();
    reg.add(new Uint8Array([1]));
    const snap = reg.toMap();
    reg.add(new Uint8Array([2]));
    expect(snap.size).toBe(1); // snapshot frozen at capture time
    expect(reg.size).toBe(2);
  });
});

// Shape sanity: an empty definition carries the default band heights + zone.
describe("emptyRunningHeaderFooter", () => {
  it("has an empty default zone and default band heights", () => {
    const def = emptyRunningHeaderFooter();
    const zone: HFZone = def.default;
    expect(zone.header).toEqual([]);
    expect(zone.footer).toEqual([]);
    expect(def.headerBand).toBe(36);
    expect(def.footerBand).toBe(36);
  });
});
