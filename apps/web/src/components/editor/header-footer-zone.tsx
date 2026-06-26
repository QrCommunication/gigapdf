"use client";

/**
 * header-footer-zone.tsx
 *
 * The Word-like, in-place editable running header & footer bands of the active
 * sheet (SL2 — `default` zone only). It overlays the page: a header band pinned
 * to the top edge and a footer band pinned to the bottom edge, both inside the
 * sheet's margin strip. The middle of the overlay is click-through
 * (`pointer-events: none`) so the page BODY stays editable exactly as before;
 * only the two bands capture input.
 *
 * The bands render the items of `def.default` and edit them IN PLACE:
 *   - a text item is an uncontrolled `contentEditable` span (raw template text,
 *     so `{{page}}`/`{{date}}` stay editable; the engine substitutes them at
 *     bake time). Its character styling (bold/italic/colour/size) and anchor are
 *     read from the item, so the contextual FormattingToolbar — which page.tsx
 *     drives via the reported focus — round-trips through the definition.
 *   - an image item is a positioned `<img>` sourced from the editor's image
 *     {@link HFImageRegistry}; it carries a delete affordance.
 *
 * Every edit produces a NEW definition via the pure helpers in
 * `running-header-footer.ts` and is emitted through `onChange`; page.tsx adopts
 * it as the source of truth and debounces the bake. No content-edit-layer logic
 * is duplicated — the bands are a self-contained DOM editing surface.
 */

import React, { useCallback, useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  appendItemToZone,
  makeTextItem,
  removeItemFromZone,
  resolveZoneKeyForPage,
  updateItemInZone,
  zoneForKey,
  type HFBand,
  type HFImageItem,
  type HFImageRegistry,
  type HFTextItem,
  type HFZoneKey,
  type RunningHeaderFooter,
  DEFAULT_HEADER_BAND,
  DEFAULT_FOOTER_BAND,
} from "./lib/running-header-footer";

/** The text item currently focused in a band — reported up to drive the toolbar. */
export interface HFFocusedTextItem {
  band: HFBand;
  index: number;
  item: HFTextItem;
}

export interface HeaderFooterZoneProps {
  /**
   * The running-H/F definition (controlled). The band edits the ZONE the active
   * page is scoped to (SL3): `default`, or the `firstPage`/`evenPage`/`oddPage`
   * override resolved from `pageNumber` + the definition's flags.
   */
  def: RunningHeaderFooter;
  /** Emit the next definition after any edit — page.tsx adopts + debounces bake. */
  onChange: (def: RunningHeaderFooter) => void;
  /** Editor-owned image registry: holds image bytes referenced by image items. */
  registry: HFImageRegistry;
  /** CSS px per PDF point (zoom-aware): sizes the bands, fonts and images. */
  pxPerPt: number;
  /**
   * 1-based number of the active page (default 1). Together with the
   * definition's `differentFirstPage`/`differentOddEven` flags this selects the
   * zone the bands display + edit, so editing page 1 touches `firstPage`, an
   * even page touches `evenPage`, etc.
   */
  pageNumber?: number;
  /**
   * Optional, already-localised badge describing the active zone scope ("First
   * page", "Even pages", …). Rendered as a small chip atop the overlay so the
   * user knows which pages their edit applies to. Hidden when absent (SL2).
   */
  zoneLabel?: string;
  /**
   * Report which text item (if any) is focused, so page.tsx can feed the
   * FormattingToolbar a synthetic selection and route token inserts/styling to
   * this item. `null` when focus leaves all text items.
   */
  onFocusedTextItemChange?: (focus: HFFocusedTextItem | null) => void;
}

/** Map an `[r,g,b]` 0..255 triple to a CSS `rgb()` string (default black). */
function rgbCss(color: HFTextItem["color"]): string {
  if (!color) return "rgb(0,0,0)";
  const [r, g, b] = color;
  return `rgb(${r},${g},${b})`;
}

/** CSS `text-align`/justification for an item anchor. */
function anchorJustify(anchor: HFTextItem["anchor"]): React.CSSProperties {
  switch (anchor) {
    case "center":
      return { justifyContent: "center", textAlign: "center" };
    case "right":
      return { justifyContent: "flex-end", textAlign: "right" };
    case "left":
    default:
      return { justifyContent: "flex-start", textAlign: "left" };
  }
}

interface EditableTextItemProps {
  item: HFTextItem;
  pxPerPt: number;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onTextChange: (text: string) => void;
}

/**
 * One uncontrolled `contentEditable` text item. The DOM text is seeded from the
 * item and only re-synced from props while NOT focused, so typing never moves
 * the caret. Emits the raw template text on every input.
 */
function EditableTextItem({
  item,
  pxPerPt,
  focused,
  onFocus,
  onBlur,
  onTextChange,
}: EditableTextItemProps) {
  const ref = useRef<HTMLSpanElement>(null);

  // Seed / re-sync the DOM text from the definition only while not focused
  // (writing textContent under the caret would reset the selection).
  useEffect(() => {
    const el = ref.current;
    if (!el || focused) return;
    if (el.textContent !== item.text) el.textContent = item.text;
  }, [item.text, focused]);

  const style: React.CSSProperties = {
    fontWeight: item.bold ? 700 : 400,
    fontStyle: item.italic ? "italic" : "normal",
    textDecoration: "none",
    color: rgbCss(item.color),
    fontSize: (item.size ?? 10) * pxPerPt,
    lineHeight: 1.2,
    outline: "none",
    whiteSpace: "pre",
    cursor: "text",
  };

  return (
    <span
      ref={ref}
      role="textbox"
      aria-label="Header/footer text"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={style}
      onFocus={onFocus}
      onBlur={onBlur}
      onInput={(e) => onTextChange(e.currentTarget.textContent ?? "")}
    />
  );
}

interface ImageItemViewProps {
  item: HFImageItem;
  bytes: Uint8Array | undefined;
  pxPerPt: number;
  onDelete: () => void;
}

/** One positioned image item, sourced from the registry, with a delete button. */
function ImageItemView({ item, bytes, pxPerPt, onDelete }: ImageItemViewProps) {
  const urlRef = useRef<string | null>(null);
  const [src, setSrc] = React.useState<string | null>(null);

  useEffect(() => {
    if (!bytes || typeof URL === "undefined" || !URL.createObjectURL) {
      setSrc(null);
      return;
    }
    let url: string | null = null;
    try {
      const copy = new Uint8Array(bytes);
      url = URL.createObjectURL(new Blob([copy], { type: "image/png" }));
    } catch {
      // jsdom (and other non-browser hosts) may not implement createObjectURL —
      // fall back to the placeholder box instead of crashing the band.
      setSrc(null);
      return;
    }
    urlRef.current = url;
    setSrc(url);
    return () => {
      if (urlRef.current) {
        try {
          URL.revokeObjectURL(urlRef.current);
        } catch {
          /* ignore */
        }
      }
      urlRef.current = null;
    };
  }, [bytes]);

  return (
    <span className="group relative inline-flex items-center">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Header/footer image"
          aria-label="Header/footer image"
          style={{
            width: item.w * pxPerPt,
            height: item.h * pxPerPt,
            opacity: item.opacity ?? 1,
            objectFit: "contain",
            display: "block",
          }}
          draggable={false}
        />
      ) : (
        <span
          aria-label="Header/footer image"
          className="inline-block bg-muted"
          style={{ width: item.w * pxPerPt, height: item.h * pxPerPt }}
        />
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Remove image"
        className="absolute -right-2 -top-2 hidden rounded-full bg-destructive p-0.5 text-white group-hover:block"
      >
        <Trash2 size={12} />
      </button>
    </span>
  );
}

interface BandProps {
  band: HFBand;
  def: RunningHeaderFooter;
  /** The zone the active page edits (SL3) — `default` or an override key. */
  zoneKey: HFZoneKey;
  registry: HFImageRegistry;
  pxPerPt: number;
  heightPx: number;
  pinned: "top" | "bottom";
  focused: { band: HFBand; index: number } | null;
  onChange: (def: RunningHeaderFooter) => void;
  setFocus: (
    focus: { band: HFBand; index: number } | null,
    explicitItem?: HFTextItem,
  ) => void;
}

/** One band (header or footer): renders its items + an "add text" affordance. */
function Band({
  band,
  def,
  zoneKey,
  registry,
  pxPerPt,
  heightPx,
  pinned,
  focused,
  onChange,
  setFocus,
}: BandProps) {
  const zone = zoneForKey(def, zoneKey);
  const items = band === "header" ? zone.header : zone.footer;

  const addText = useCallback(() => {
    const item = makeTextItem("");
    onChange(appendItemToZone(def, zoneKey, band, item));
    // The new item exists only in the emitted def (parent re-renders later), so
    // report focus for it EXPLICITLY rather than looking it up in the stale def.
    setFocus({ band, index: items.length }, item);
  }, [def, zoneKey, band, items.length, onChange, setFocus]);

  return (
    <div
      data-hf-band={band}
      className="pointer-events-auto absolute left-0 right-0 flex items-center gap-2 border border-dashed border-primary/40 bg-primary/[0.03] px-2"
      style={{
        height: heightPx,
        ...(pinned === "top" ? { top: 0 } : { bottom: 0 }),
      }}
    >
      <button
        type="button"
        onClick={addText}
        aria-label="Add text"
        title="Add text"
        className="pointer-events-auto rounded p-1 text-primary/70 hover:bg-primary/10 hover:text-primary"
      >
        <Plus size={14} />
      </button>
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {items.map((raw, index) => {
          const item = raw as HFTextItem | HFImageItem;
          const key = `${band}-${index}`;
          if (item.type === "image") {
            return (
              <span key={key} style={anchorJustify(item.anchor)}>
                <ImageItemView
                  item={item}
                  bytes={registry.get(item.imageId)}
                  pxPerPt={pxPerPt}
                  onDelete={() =>
                    onChange(removeItemFromZone(def, zoneKey, band, index))
                  }
                />
              </span>
            );
          }
          return (
            <span
              key={key}
              className="inline-flex"
              style={anchorJustify(item.anchor)}
            >
              <EditableTextItem
                item={item}
                pxPerPt={pxPerPt}
                focused={
                  focused?.band === band && focused?.index === index
                }
                onFocus={() => setFocus({ band, index })}
                onBlur={() => setFocus(null)}
                onTextChange={(text) =>
                  onChange(updateItemInZone(def, zoneKey, band, index, { text }))
                }
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The editable running header & footer bands overlaying the active sheet. The
 * root is click-through; only the two pinned bands capture input so the page
 * body keeps its existing edit behaviour.
 */
export function HeaderFooterZone({
  def,
  onChange,
  registry,
  pxPerPt,
  pageNumber = 1,
  zoneLabel,
  onFocusedTextItemChange,
}: HeaderFooterZoneProps) {
  const [focused, setFocusedState] = React.useState<{
    band: HFBand;
    index: number;
  } | null>(null);

  // The zone this page edits/displays (SL3): `default`, or a first-page/odd-even
  // override resolved from the page number + the definition's flags.
  const zoneKey = resolveZoneKeyForPage(def, pageNumber);

  const setFocus = useCallback(
    (next: { band: HFBand; index: number } | null, explicitItem?: HFTextItem) => {
      setFocusedState(next);
      if (!onFocusedTextItemChange) return;
      if (!next) {
        onFocusedTextItemChange(null);
        return;
      }
      // Prefer an explicitly-passed item (a just-added one not yet in `def`);
      // otherwise resolve it from the ACTIVE zone of the current definition.
      const zone = zoneForKey(def, zoneKey);
      const list = next.band === "header" ? zone.header : zone.footer;
      const item = explicitItem ?? list[next.index];
      if (item && item.type === "text") {
        onFocusedTextItemChange({ band: next.band, index: next.index, item });
      } else {
        onFocusedTextItemChange(null);
      }
    },
    [def, zoneKey, onFocusedTextItemChange],
  );

  const headerPx = (def.headerBand ?? DEFAULT_HEADER_BAND) * pxPerPt;
  const footerPx = (def.footerBand ?? DEFAULT_FOOTER_BAND) * pxPerPt;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      data-testid="header-footer-zone"
    >
      {zoneLabel ? (
        <div
          data-testid="hf-zone-indicator"
          className="pointer-events-none absolute left-1/2 top-1 z-30 -translate-x-1/2 rounded bg-primary/80 px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow"
        >
          {zoneLabel}
        </div>
      ) : null}
      <Band
        band="header"
        def={def}
        zoneKey={zoneKey}
        registry={registry}
        pxPerPt={pxPerPt}
        heightPx={headerPx}
        pinned="top"
        focused={focused}
        onChange={onChange}
        setFocus={setFocus}
      />
      <Band
        band="footer"
        def={def}
        zoneKey={zoneKey}
        registry={registry}
        pxPerPt={pxPerPt}
        heightPx={footerPx}
        pinned="bottom"
        focused={focused}
        onChange={onChange}
        setFocus={setFocus}
      />
    </div>
  );
}
