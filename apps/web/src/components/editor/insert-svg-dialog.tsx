"use client";

import React, { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Shapes, Upload, X } from "lucide-react";

/** Placement of the SVG on the page, in PDF points (origin bottom-left, Y up). */
export interface InsertSvgPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InsertSvgValue {
  /** Inline SVG markup. */
  svg: string;
  /** Explicit placement; omitted means "centre on the current page". */
  placement?: InsertSvgPlacement;
}

export interface InsertSvgDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (value: InsertSvgValue) => void;
}

// Accepts a leading XML prolog or the root <svg> element — same guard the
// /api/pdf/insert-svg route enforces server-side.
const SVG_PREFIX = /^\s*(<\?xml[\s>]|<svg[\s>])/i;

// Sensible non-centred defaults (points). 1in margin, a square-ish graphic.
const DEFAULT_PLACEMENT: InsertSvgPlacement = { x: 72, y: 72, w: 200, h: 200 };

/**
 * Dialog to insert an SVG graphic onto the current page. The user pastes markup
 * or uploads a `.svg` file; placement defaults to "centred" (computed by the
 * editor from the page dimensions) or can be entered explicitly in PDF points.
 * Mirrors {@link InsertLinkDialog}: a fixed overlay modal with apply/cancel.
 */
export function InsertSvgDialog({ open, onClose, onApply }: InsertSvgDialogProps) {
  const t = useTranslations("editor.insert.svgDialog");
  const [svg, setSvg] = useState("");
  const [centered, setCentered] = useState(true);
  const [placement, setPlacement] = useState<InsertSvgPlacement>(DEFAULT_PLACEMENT);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-seed the form each time the dialog OPENS (idiomatic render-time reset).
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setSvg("");
    setCentered(true);
    setPlacement(DEFAULT_PLACEMENT);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  if (!open) return null;

  const trimmed = svg.trim();
  const svgValid = SVG_PREFIX.test(trimmed);
  const placementValid =
    centered ||
    (Number.isFinite(placement.x) &&
      Number.isFinite(placement.y) &&
      placement.w > 0 &&
      placement.h > 0);
  const canApply = svgValid && placementValid;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setSvg(await f.text());
    // Allow re-selecting the same file later.
    e.target.value = "";
  };

  const setNum = (key: keyof InsertSvgPlacement) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPlacement((prev) => ({ ...prev, [key]: Number(e.target.value) }));

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canApply) return;
    onApply({ svg: trimmed, placement: centered ? undefined : placement });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insert-svg-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <Shapes size={18} className="text-muted-foreground" />
            <h2
              id="insert-svg-dialog-title"
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
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="insert-svg-code"
                className="block text-sm font-medium text-foreground"
              >
                {t("codeLabel")}
              </label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-input text-xs text-muted-foreground hover:bg-muted"
              >
                <Upload size={13} />
                {t("upload")}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".svg,image/svg+xml"
                className="hidden"
                onChange={handleFile}
              />
            </div>
            <textarea
              id="insert-svg-code"
              value={svg}
              onChange={(e) => setSvg(e.target.value)}
              placeholder={t("codePlaceholder")}
              rows={6}
              spellCheck={false}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
            {trimmed && !svgValid ? (
              <p className="mt-1 text-xs text-destructive">{t("codeInvalid")}</p>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={centered}
              onChange={(e) => setCentered(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            {t("centered")}
          </label>

          {!centered ? (
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="col-span-2 text-sm font-medium text-foreground mb-1">
                {t("placementLabel")}
              </legend>
              {(["x", "y", "w", "h"] as const).map((k) => (
                <div key={k}>
                  <label
                    htmlFor={`insert-svg-${k}`}
                    className="block text-xs text-muted-foreground mb-1"
                  >
                    {t(`field_${k}`)}
                  </label>
                  <input
                    id={`insert-svg-${k}`}
                    type="number"
                    value={placement[k]}
                    onChange={setNum(k)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              ))}
            </fieldset>
          ) : null}

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
              disabled={!canApply}
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
