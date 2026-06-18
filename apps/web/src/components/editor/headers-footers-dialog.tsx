"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, PanelTop } from "lucide-react";
import type { HeaderFooterSpec } from "@qrcommunication/gigapdf-lib";
import type { HeaderFooterKind } from "./lib/page-headers-footers";

export interface HeadersFootersDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Apply a header/footer band to the current document. The editor bakes the
   * spec onto the live PDF and persists it (mirrors the watermark apply flow).
   */
  onApply: (kind: HeaderFooterKind, spec: HeaderFooterSpec) => void;
  /** Remove every header/footer band of the given kind from the document. */
  onRemove: (kind: HeaderFooterKind) => void;
  /**
   * Optional text to seed the editor with — used by the Word auto-detect flow
   * to pre-fill the band the document originally carried.
   */
  initialHeaderText?: string;
  initialFooterText?: string;
  /** Whether an apply/remove operation is currently running (disables actions). */
  busy?: boolean;
}

type Align = "left" | "center" | "right";

const ALIGNMENTS: Align[] = ["left", "center", "right"];

/** Clamp a 0–255 channel into the 0..1 range the engine expects. */
function channel01(value: number): number {
  return Math.min(1, Math.max(0, value / 255));
}

/** Map a `#rrggbb` hex string to an `[r, g, b]` triple in `0..1` per channel. */
function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return [0, 0, 0];
  const int = parseInt(m[1], 16);
  return [
    channel01((int >> 16) & 0xff),
    channel01((int >> 8) & 0xff),
    channel01(int & 0xff),
  ];
}

/**
 * HeadersFootersDialog — Word-style running headers & footers. Edits one
 * {@link HeaderFooterSpec} at a time, switching between the header and footer
 * "band". Text supports the `{{page}}` / `{{pages}}` tokens (substituted by the
 * engine per page). Colour is opt-in (a checkbox gates the picker; when off the
 * `color` field is omitted so the engine default — black — applies).
 */
export function HeadersFootersDialog({
  open,
  onClose,
  onApply,
  onRemove,
  initialHeaderText = "",
  initialFooterText = "",
  busy = false,
}: HeadersFootersDialogProps) {
  const t = useTranslations("editor.headersFooters");

  const [band, setBand] = useState<HeaderFooterKind>("header");
  const [headerText, setHeaderText] = useState(initialHeaderText);
  const [footerText, setFooterText] = useState(initialFooterText);
  const [align, setAlign] = useState<Align>("center");
  const [fontSize, setFontSize] = useState(10);
  const [useColor, setUseColor] = useState(false);
  const [color, setColor] = useState("#000000");
  const [pageRangeInput, setPageRangeInput] = useState("");
  const [showOnFirstPage, setShowOnFirstPage] = useState(true);

  const text = band === "header" ? headerText : footerText;
  const setText = band === "header" ? setHeaderText : setFooterText;

  // Parse an inclusive 1-based "first-last" range; a single number is treated as
  // [n, n]. Empty / unparsable input means "every page" (undefined → engine
  // default, which is the whole document).
  const parsePageRange = (raw: string): [number, number] | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const first = Number(range[1]);
      const last = Number(range[2]);
      return first <= last ? [first, last] : [last, first];
    }
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return [n, n];
    }
    return undefined;
  };

  const buildSpec = (): HeaderFooterSpec => {
    const spec: HeaderFooterSpec = {
      text: text.trim(),
      align,
      fontSize,
      showOnFirstPage,
    };
    const pageRange = parsePageRange(pageRangeInput);
    if (pageRange) spec.pageRange = pageRange;
    // Colour is opt-in: omit `color` entirely when unchecked so the engine
    // default (black) applies, rather than forcing [0,0,0].
    if (useColor) spec.color = hexToRgb01(color);
    return spec;
  };

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    onApply(band, buildSpec());
  };

  const handleRemove = () => {
    if (busy) return;
    onRemove(band);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="headers-footers-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <PanelTop size={18} className="text-muted-foreground" />
            <h2
              id="headers-footers-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleApply} className="px-6 pb-6 pt-2 space-y-4">
          {/* Band switch: header vs footer */}
          <fieldset>
            <legend className="block text-sm font-medium text-foreground mb-1">
              {t("bandLabel")}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(["header", "footer"] as const).map((b) => (
                <label
                  key={b}
                  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors text-sm ${
                    band === b
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-input text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="hf-band"
                    value={b}
                    checked={band === b}
                    onChange={() => setBand(b)}
                    className="sr-only"
                  />
                  {b === "header" ? t("bandHeader") : t("bandFooter")}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t("textLabel")}
            </label>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("textPlaceholder")}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("tokenHint")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("alignLabel")}
              </label>
              <select
                value={align}
                onChange={(e) => setAlign(e.target.value as Align)}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {ALIGNMENTS.map((a) => (
                  <option key={a} value={a}>
                    {t(`align.${a}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("fontSizeLabel")}
              </label>
              <input
                type="number"
                min={6}
                max={48}
                value={fontSize}
                onChange={(e) =>
                  setFontSize(
                    Math.min(48, Math.max(6, Number(e.target.value) || 10)),
                  )
                }
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={useColor}
                onChange={(e) => setUseColor(e.target.checked)}
                className="accent-primary"
              />
              {t("colorLabel")}
            </label>
            {useColor && (
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label={t("colorPickerLabel")}
                className="mt-2 h-9 w-16 cursor-pointer rounded-md border border-input bg-background"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t("pageRangeLabel")}
            </label>
            <input
              value={pageRangeInput}
              onChange={(e) => setPageRangeInput(e.target.value)}
              placeholder={t("pageRangePlaceholder")}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={showOnFirstPage}
              onChange={(e) => setShowOnFirstPage(e.target.checked)}
              className="accent-primary"
            />
            {t("showOnFirstPage")}
          </label>

          <div className="flex justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="px-4 py-2 text-sm rounded-md border border-input text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {band === "header" ? t("removeHeader") : t("removeFooter")}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md border border-input hover:bg-muted"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={!text.trim() || busy}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {t("apply")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
