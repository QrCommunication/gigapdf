/**
 * running-header-footer.ts
 *
 * Pure, framework-free model + helpers for the editor's Word-like *running*
 * headers & footers (SL2). A {@link RunningHeaderFooter} *definition* is the
 * single source of truth: the engine stores it in its editor-meta sidecar and
 * regenerates the visible `/GPHF` band from it on every bake
 * ({@link import("@qrcommunication/gigapdf-lib").GigaPdfDoc.setRunningHeaderFooter}).
 *
 * This module owns:
 *   - the TS mirror of the lib's RHF types (re-exported, so passing our values
 *     straight to `setRunningHeaderFooter` stays type-exact);
 *   - per-page **token substitution** (`{{page}}` / `{{pages}}` / `{{date}}` /
 *     `{{title}}`) — what the editor band shows live, mirroring the bake;
 *   - **anchor → position** resolution (left/center/right + `(dx, dy)` nudge →
 *     CSS px inside a band box) so the editable band lays items out exactly
 *     where the bake will draw them;
 *   - **zone selection** by 1-based page (SL2 always resolves the `default`
 *     zone; the `firstPage`/`evenPage`/`oddPage` resolution is wired but only
 *     reachable once SL3 sets the `differentFirstPage`/`differentOddEven` flags);
 *   - immutable zone/item edit helpers (add / update / remove an item);
 *   - an in-memory **image registry** (`imageId → bytes`) the band uses to keep
 *     image pixels around between edits and to feed the bake's `images` map.
 *
 * No React, no DOM — trivially unit-testable.
 */

import type {
  HFAlign,
  HFItem,
  HFZone,
  RunningHeaderFooter,
} from "@qrcommunication/gigapdf-lib";

// Re-export the lib's RHF types as the canonical editor-side types so a value
// built here is assignable to `setRunningHeaderFooter(def)` without a cast.
export type { HFAlign, HFItem, HFZone, RunningHeaderFooter };

/** Narrowed text variant of {@link HFItem} (discriminated on `type`). */
export type HFTextItem = Extract<HFItem, { type: "text" }>;
/** Narrowed image variant of {@link HFItem} (discriminated on `type`). */
export type HFImageItem = Extract<HFItem, { type: "image" }>;

/** Which band of a zone an edit targets. */
export type HFBand = "header" | "footer";

/** Default band height (top-edge → baseline / bottom-edge → baseline), points. */
export const DEFAULT_HEADER_BAND = 36;
export const DEFAULT_FOOTER_BAND = 36;

/** Default font size for a freshly-inserted text item (points). */
export const DEFAULT_HF_FONT_SIZE = 10;

/** The four tokens substituted in a running-H/F text item at draw time. */
export interface HFTokenContext {
  /** 1-based page number. */
  page: number;
  /** Total page count. */
  pages: number;
  /** Bake date string for `{{date}}` (e.g. `2026-06-26`). */
  date?: string;
  /** Document title for `{{title}}`. */
  title?: string;
}

const TOKEN_RE = /\{\{\s*(page|pages|date|title)\s*\}\}/g;

/**
 * Substitute the running-H/F tokens in `template` for `ctx` — the same
 * substitution the engine performs at bake time, so the editable band shows the
 * resolved text. Unknown/absent values render as the empty string; any text not
 * matching a token is left verbatim.
 */
export function substituteHFTokens(
  template: string,
  ctx: HFTokenContext,
): string {
  return template.replace(TOKEN_RE, (_match, token: string) => {
    switch (token) {
      case "page":
        return String(ctx.page);
      case "pages":
        return String(ctx.pages);
      case "date":
        return ctx.date ?? "";
      case "title":
        return ctx.title ?? "";
      default:
        return "";
    }
  });
}

/** An empty header/footer zone (no items in either band). */
export function emptyHFZone(): HFZone {
  return { header: [], footer: [] };
}

/** An empty running-H/F definition (a single empty `default` zone). */
export function emptyRunningHeaderFooter(): RunningHeaderFooter {
  return {
    default: emptyHFZone(),
    headerBand: DEFAULT_HEADER_BAND,
    footerBand: DEFAULT_FOOTER_BAND,
  };
}

/** `true` when neither band of `def`'s `default` zone carries any item. */
export function isRunningHeaderFooterEmpty(
  def: RunningHeaderFooter | null | undefined,
): boolean {
  if (!def) return true;
  const zones: Array<HFZone | null | undefined> = [
    def.default,
    def.firstPage,
    def.evenPage,
    def.oddPage,
  ];
  return zones.every(
    (z) => !z || (z.header.length === 0 && z.footer.length === 0),
  );
}

/**
 * Resolve which {@link HFZone} a 1-based `pageNumber` uses, mirroring the lib's
 * documented rule: page 1 → `firstPage` when `differentFirstPage` (else
 * `default`); otherwise, when `differentOddEven`, even pages → `evenPage` and
 * odd pages → `oddPage` (each falling back to `default` when omitted); otherwise
 * `default` everywhere.
 *
 * SL2 never sets `differentFirstPage`/`differentOddEven`, so this always returns
 * the `default` zone today; SL3 will populate the overrides.
 */
export function selectZoneForPage(
  def: RunningHeaderFooter,
  pageNumber: number,
): HFZone {
  if (def.differentFirstPage && pageNumber === 1) {
    return def.firstPage ?? def.default;
  }
  if (def.differentOddEven) {
    const override = pageNumber % 2 === 0 ? def.evenPage : def.oddPage;
    return override ?? def.default;
  }
  return def.default;
}

// ─── Zone addressing (SL3 — first-page / odd-even overrides) ──────────────────

/** The four addressable zones of a {@link RunningHeaderFooter} definition. */
export type HFZoneKey = "default" | "firstPage" | "evenPage" | "oddPage";

/**
 * The zone KEY a 1-based `pageNumber` is *scoped* to given the override flags —
 * the editing counterpart of {@link selectZoneForPage}. Unlike that reader
 * (which falls back to `default` when an override zone is absent), this returns
 * the slot the page edits so callers initialise + write the right zone: page 1
 * → `firstPage` when `differentFirstPage`; otherwise even/odd →
 * `evenPage`/`oddPage` when `differentOddEven`; otherwise `default`.
 */
export function resolveZoneKeyForPage(
  def: RunningHeaderFooter,
  pageNumber: number,
): HFZoneKey {
  if (def.differentFirstPage && pageNumber === 1) return "firstPage";
  if (def.differentOddEven) {
    return pageNumber % 2 === 0 ? "evenPage" : "oddPage";
  }
  return "default";
}

/**
 * The {@link HFZone} stored at `key`: the always-present `default`, or an
 * override zone (an empty zone when that override is absent — the safe base for
 * both display and the first edit on a freshly-toggled flag).
 */
export function zoneForKey(def: RunningHeaderFooter, key: HFZoneKey): HFZone {
  if (key === "default") return def.default;
  return def[key] ?? emptyHFZone();
}

/** Return a copy of `def` with `zone` written at `key`. */
function withZone(
  def: RunningHeaderFooter,
  key: HFZoneKey,
  zone: HFZone,
): RunningHeaderFooter {
  if (key === "default") return { ...def, default: zone };
  return { ...def, [key]: zone };
}

/**
 * Return a copy of `def` with the zone at `key` initialised — a copy of the
 * `default` zone's items — when it is missing/null, so toggling a
 * `differentFirstPage`/`differentOddEven` flag gives the new zone the same
 * starting content, ready to diverge. A no-op for `default` (always present) or
 * an already-present override zone.
 */
export function ensureZone(
  def: RunningHeaderFooter,
  key: HFZoneKey,
): RunningHeaderFooter {
  if (key === "default") return def;
  if (def[key]) return def;
  const src = def.default;
  const seeded: HFZone = {
    header: src.header.map((it) => ({ ...it })),
    footer: src.footer.map((it) => ({ ...it })),
  };
  return { ...def, [key]: seeded };
}

/** Return a copy of `def` with `item` appended to the `band` of the `key` zone. */
export function appendItemToZone(
  def: RunningHeaderFooter,
  key: HFZoneKey,
  band: HFBand,
  item: HFItem,
): RunningHeaderFooter {
  const zone = zoneForKey(def, key);
  const nextZone: HFZone = {
    header: band === "header" ? [...zone.header, item] : zone.header,
    footer: band === "footer" ? [...zone.footer, item] : zone.footer,
  };
  return withZone(def, key, nextZone);
}

/** Return a copy of `def` with the `index`-th item of the `key` zone's `band` patched. */
export function updateItemInZone(
  def: RunningHeaderFooter,
  key: HFZoneKey,
  band: HFBand,
  index: number,
  patch: Partial<HFItem>,
): RunningHeaderFooter {
  const zone = zoneForKey(def, key);
  const list = band === "header" ? zone.header : zone.footer;
  if (index < 0 || index >= list.length) return def;
  const nextList = list.map((it, i) =>
    // Same-variant patch only: merging keeps the discriminant `type` intact.
    i === index ? ({ ...it, ...patch } as HFItem) : it,
  );
  const nextZone: HFZone = {
    header: band === "header" ? nextList : zone.header,
    footer: band === "footer" ? nextList : zone.footer,
  };
  return withZone(def, key, nextZone);
}

/** Return a copy of `def` with the `index`-th item of the `key` zone's `band` removed. */
export function removeItemFromZone(
  def: RunningHeaderFooter,
  key: HFZoneKey,
  band: HFBand,
  index: number,
): RunningHeaderFooter {
  const zone = zoneForKey(def, key);
  const list = band === "header" ? zone.header : zone.footer;
  if (index < 0 || index >= list.length) return def;
  const nextList = list.filter((_it, i) => i !== index);
  const nextZone: HFZone = {
    header: band === "header" ? nextList : zone.header,
    footer: band === "footer" ? nextList : zone.footer,
  };
  return withZone(def, key, nextZone);
}

/**
 * Horizontal placement of an item inside a band box, in CSS px. The anchor sets
 * the base (`left` → 0, `center` → centred, `right` → flush-right) and `dxPts`
 * (PDF points, `+dx` → right) nudges it, converted to px via `pxPerPt`. Pure
 * math (no clamping) — the band component clamps to its box when laying out.
 */
export function resolveAnchorLeftPx(
  anchor: HFAlign,
  dxPts: number,
  bandWidthPx: number,
  itemWidthPx: number,
  pxPerPt: number,
): number {
  let base: number;
  switch (anchor) {
    case "center":
      base = (bandWidthPx - itemWidthPx) / 2;
      break;
    case "right":
      base = bandWidthPx - itemWidthPx;
      break;
    case "left":
    default:
      base = 0;
      break;
  }
  return base + dxPts * pxPerPt;
}

/**
 * Vertical placement of an item inside a band box, in CSS px. A header item
 * anchors to the band top, a footer item to the band bottom; `dyPts` (PDF
 * points, `+dy` → up) nudges it upward, converted to px via `pxPerPt`.
 */
export function resolveAnchorTopPx(
  band: HFBand,
  dyPts: number,
  bandHeightPx: number,
  itemHeightPx: number,
  pxPerPt: number,
): number {
  const dyPx = dyPts * pxPerPt;
  if (band === "header") {
    return 0 - dyPx;
  }
  return bandHeightPx - itemHeightPx - dyPx;
}

// ─── Immutable zone/item edit helpers ────────────────────────────────────────

/** Build a fresh text item with sensible defaults. */
export function makeTextItem(
  text: string,
  overrides: Partial<Omit<HFTextItem, "type">> = {},
): HFTextItem {
  return {
    type: "text",
    text,
    anchor: overrides.anchor ?? "left",
    size: overrides.size ?? DEFAULT_HF_FONT_SIZE,
    ...overrides,
  };
}

/** Build a fresh image item referencing a registry `imageId`. */
export function makeImageItem(
  imageId: number,
  w: number,
  h: number,
  overrides: Partial<Omit<HFImageItem, "type" | "imageId">> = {},
): HFImageItem {
  return {
    type: "image",
    imageId,
    w,
    h,
    anchor: overrides.anchor ?? "left",
    ...overrides,
  };
}

/** Return a copy of `def` with `item` appended to the `band` of its `default` zone. */
export function appendItemToDefault(
  def: RunningHeaderFooter,
  band: HFBand,
  item: HFItem,
): RunningHeaderFooter {
  return appendItemToZone(def, "default", band, item);
}

/** Return a copy of `def` with the `index`-th item of the `default` zone's `band` patched. */
export function updateItemInDefault(
  def: RunningHeaderFooter,
  band: HFBand,
  index: number,
  patch: Partial<HFItem>,
): RunningHeaderFooter {
  return updateItemInZone(def, "default", band, index, patch);
}

/** Return a copy of `def` with the `index`-th item of the `default` zone's `band` removed. */
export function removeItemFromDefault(
  def: RunningHeaderFooter,
  band: HFBand,
  index: number,
): RunningHeaderFooter {
  return removeItemFromZone(def, "default", band, index);
}

// ─── Style ↔ text-item mapping (FormattingToolbar bridge) ────────────────────

/** A `#rrggbb` hex string for an `[r,g,b]` 0..255 triple (default black). */
export function hfColorToHex(color: HFTextItem["color"]): string {
  const [r, g, b] = color ?? [0, 0, 0];
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** An `[r,g,b]` 0..255 triple for a `#rrggbb` hex string (black on parse error). */
export function hexToHfColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return [0, 0, 0];
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** Map a text-align to an item anchor (`justify` collapses to `left`). */
export function anchorFromTextAlign(
  align: "left" | "center" | "right" | "justify",
): HFAlign {
  return align === "center" || align === "right" ? align : "left";
}

/** Map an item anchor back to a text-align for the synthetic toolbar element. */
export function textAlignFromAnchor(
  anchor: HFAlign | undefined,
): "left" | "center" | "right" {
  return anchor === "center" || anchor === "right" ? anchor : "left";
}

/**
 * A minimal text-style patch the FormattingToolbar emits. Structurally a subset
 * of `TextStyle` (so a `Partial<TextStyle>` is assignable), kept import-free so
 * this module stays dependency-light.
 */
export interface HFTextStylePatch {
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  color?: string;
  fontSize?: number;
  textAlign?: "left" | "center" | "right" | "justify";
}

/**
 * Apply a FormattingToolbar style `patch` to a text `item`, mapping its fields
 * to the {@link HFTextItem} model (`fontWeight` → `bold`, `fontStyle` →
 * `italic`, hex `color` → `[r,g,b]`, `fontSize` → `size`, `textAlign` →
 * `anchor`). Fields the running-H/F model has no slot for (underline, lists,
 * spacing…) are ignored. Returns a new item.
 */
export function applyTextStylePatch(
  item: HFTextItem,
  patch: HFTextStylePatch,
): HFTextItem {
  const next: HFTextItem = { ...item };
  if (patch.fontWeight !== undefined) next.bold = patch.fontWeight === "bold";
  if (patch.fontStyle !== undefined) next.italic = patch.fontStyle === "italic";
  if (patch.color !== undefined) next.color = hexToHfColor(patch.color);
  if (patch.fontSize !== undefined) next.size = patch.fontSize;
  if (patch.textAlign !== undefined) {
    next.anchor = anchorFromTextAlign(patch.textAlign);
  }
  return next;
}

/** Append a `{{token}}` to a text item's template (with a leading space if non-empty). */
export function appendTokenToText(text: string, token: string): string {
  const tok = `{{${token}}}`;
  if (text.length === 0) return tok;
  return /\s$/.test(text) ? `${text}${tok}` : `${text} ${tok}`;
}

// ─── In-memory image registry ────────────────────────────────────────────────

/**
 * A small, editor-side registry mapping a monotonic `imageId` to its raw pixel
 * bytes. {@link HFImageItem}s reference an `imageId`; the registry holds the
 * bytes between edits and produces the `Map<number, Uint8Array>` the bake's
 * `images` option expects. IDs start at 1 (the lib treats them as opaque keys).
 */
export class HFImageRegistry {
  private readonly map = new Map<number, Uint8Array>();
  private nextId = 1;

  /** Register `bytes`, returning the newly-allocated `imageId`. */
  add(bytes: Uint8Array): number {
    const id = this.nextId;
    this.nextId += 1;
    this.map.set(id, bytes);
    return id;
  }

  /** The bytes registered for `imageId`, or `undefined` if unknown. */
  get(imageId: number): Uint8Array | undefined {
    return this.map.get(imageId);
  }

  /** `true` when `imageId` is registered. */
  has(imageId: number): boolean {
    return this.map.has(imageId);
  }

  /** Number of registered images. */
  get size(): number {
    return this.map.size;
  }

  /**
   * A `Map` snapshot suitable for the bake's `images` option. A fresh copy so
   * later registry mutations don't leak into an in-flight bake.
   */
  toMap(): Map<number, Uint8Array> {
    return new Map(this.map);
  }
}
