"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { X, Ruler } from "lucide-react";

export interface ResizePageDialogProps {
  open: boolean;
  onClose: () => void;
  /** 0-based index of the page being resized (for the title). */
  pageIndex: number;
  /** Current page size in points (pre-fills the custom fields). */
  currentWidth?: number;
  currentHeight?: number;
  /** Apply the new size (points). The editor handles the bake + reload. */
  onApply: (size: { width: number; height: number }) => void;
}

type PresetId = "a4" | "letter" | "legal" | "a3" | "a5" | "custom";
type Orientation = "portrait" | "landscape";

/** Page size presets in PDF points (1 pt = 1/72 in). Portrait dimensions. */
const PRESETS: Record<Exclude<PresetId, "custom">, { width: number; height: number }> = {
  a4: { width: 595, height: 842 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  a3: { width: 842, height: 1191 },
  a5: { width: 420, height: 595 },
};

const PRESET_ORDER: PresetId[] = ["a4", "letter", "legal", "a3", "a5", "custom"];

/**
 * ResizePageDialog — pick a standard page size (A4/Letter/Legal/A3/A5) or a
 * custom size and orientation, then resize the page's MediaBox via the existing
 * `resize` page operation. Mirrors the CompressDialog apply pattern.
 */
export function ResizePageDialog({
  open,
  onClose,
  pageIndex,
  currentWidth,
  currentHeight,
  onApply,
}: ResizePageDialogProps) {
  const t = useTranslations("editor.resizePage");
  const [preset, setPreset] = useState<PresetId>("a4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [customWidth, setCustomWidth] = useState<string>(
    currentWidth ? String(Math.round(currentWidth)) : "595",
  );
  const [customHeight, setCustomHeight] = useState<string>(
    currentHeight ? String(Math.round(currentHeight)) : "842",
  );

  if (!open) return null;

  const resolveSize = (): { width: number; height: number } | null => {
    if (preset === "custom") {
      const w = Number(customWidth);
      const h = Number(customHeight);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
      return { width: Math.round(w), height: Math.round(h) };
    }
    const base = PRESETS[preset];
    return orientation === "landscape"
      ? { width: base.height, height: base.width }
      : { width: base.width, height: base.height };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const size = resolveSize();
    if (!size) return;
    onApply(size);
    onClose();
  };

  const size = resolveSize();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resize-page-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <Ruler size={18} className="text-muted-foreground" />
            <h2
              id="resize-page-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("title", { page: pageIndex + 1 })}
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

        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-2 space-y-4">
          <div>
            <label
              htmlFor="resize-page-preset"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("sizeLabel")}
            </label>
            <select
              id="resize-page-preset"
              value={preset}
              onChange={(e) => setPreset(e.target.value as PresetId)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {PRESET_ORDER.map((id) => (
                <option key={id} value={id}>
                  {t(`presets.${id}`)}
                </option>
              ))}
            </select>
          </div>

          {preset !== "custom" ? (
            <fieldset>
              <legend className="block text-sm font-medium text-foreground mb-1">
                {t("orientationLabel")}
              </legend>
              <div className="flex gap-2">
                {(["portrait", "landscape"] as const).map((o) => (
                  <label
                    key={o}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-sm transition-colors ${
                      orientation === o
                        ? "border-primary bg-primary/5"
                        : "border-input hover:bg-muted"
                    }`}
                  >
                    <input
                      type="radio"
                      name="resize-page-orientation"
                      value={o}
                      checked={orientation === o}
                      onChange={() => setOrientation(o)}
                      className="accent-primary"
                    />
                    {t(`orientation.${o}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="resize-page-width"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("widthLabel")}
                </label>
                <input
                  id="resize-page-width"
                  type="number"
                  min={1}
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="resize-page-height"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("heightLabel")}
                </label>
                <input
                  id="resize-page-height"
                  type="number"
                  min={1}
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {size && (
            <p className="text-xs text-muted-foreground">
              {t("summary", { width: size.width, height: size.height })}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border border-input hover:bg-muted"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={!size}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t("apply")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
