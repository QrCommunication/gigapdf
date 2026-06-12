"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, Droplet } from "lucide-react";
import { useAddWatermark, downloadBlob } from "@giga-pdf/api";

export interface WatermarkDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  /** Suggested filename for the resulting download. */
  baseFilename?: string;
  /**
   * Called with the watermarked PDF when the user chooses to apply the
   * watermark to the current document (instead of downloading a copy).
   * When omitted, the dialog falls back to download-only behaviour.
   */
  onApplied?: (blob: Blob) => void;
}

/** What to do with the watermarked PDF once produced. */
type OutputMode = "apply" | "download";

type Position =
  | "center-diagonal"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "header"
  | "footer";

const POSITIONS: { value: Position; label: string }[] = [
  { value: "center-diagonal", label: "Diagonale centrale" },
  { value: "header", label: "En-tête" },
  { value: "footer", label: "Pied de page" },
  { value: "top-left", label: "Coin haut gauche" },
  { value: "top-right", label: "Coin haut droit" },
  { value: "bottom-left", label: "Coin bas gauche" },
  { value: "bottom-right", label: "Coin bas droit" },
];

/**
 * WatermarkDialog — stamp text on every page (or a selected range) of the
 * current PDF. Position presets cover the 90% use case; advanced custom
 * positioning lives behind the API but is intentionally hidden from the
 * dialog for now (most users don't need it).
 */
export function WatermarkDialog({
  open,
  onClose,
  currentFile,
  baseFilename = "watermarked.pdf",
  onApplied,
}: WatermarkDialogProps) {
  const t = useTranslations("editor.watermark");
  const [text, setText] = useState("CONFIDENTIEL");
  const [position, setPosition] = useState<Position>("center-diagonal");
  const [opacity, setOpacity] = useState(25);
  const [pagesInput, setPagesInput] = useState("");
  const [outputMode, setOutputMode] = useState<OutputMode>("apply");
  const addWatermark = useAddWatermark();

  // Without an onApplied callback there is nothing to apply the result to —
  // the dialog degrades to its historical download-only behaviour.
  const canApplyToDocument = Boolean(onApplied);

  const parsePages = (raw: string): number[] | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const out = new Set<number>();
    for (const part of trimmed.split(",")) {
      const seg = part.trim();
      const range = seg.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        for (let i = start; i <= end; i++) out.add(i);
      } else if (/^\d+$/.test(seg)) {
        out.add(Number(seg));
      }
    }
    return out.size > 0 ? Array.from(out).sort((a, b) => a - b) : undefined;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile || !text.trim()) return;
    const blob = await addWatermark.mutateAsync({
      file: currentFile,
      options: {
        text: text.trim(),
        position,
        opacity: opacity / 100,
        pages: parsePages(pagesInput),
      },
    });
    if (canApplyToDocument && outputMode === "apply") {
      // Hand the watermarked binary to the editor so it replaces the live
      // document (and gets persisted) instead of only producing a download.
      onApplied?.(blob);
    } else {
      downloadBlob(
        blob,
        baseFilename.replace(/\.pdf$/i, "") + ".watermarked.pdf",
      );
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="watermark-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <Droplet size={18} className="text-muted-foreground" />
            <h2
              id="watermark-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              Ajouter un filigrane
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="px-6 pb-6 pt-2 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Texte
            </label>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="ex. CONFIDENTIEL"
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Position
            </label>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as Position)}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Opacité : {opacity}%
            </label>
            <input
              type="range"
              min="5"
              max="80"
              step="5"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Pages (optionnel)
            </label>
            <input
              value={pagesInput}
              onChange={(e) => setPagesInput(e.target.value)}
              placeholder="ex. 1-3, 5, 7-9 (vide = toutes)"
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {canApplyToDocument && (
            <fieldset>
              <legend className="block text-sm font-medium text-foreground mb-1">
                {t("modeLabel")}
              </legend>
              <div className="space-y-2">
                {(
                  [
                    {
                      value: "apply",
                      label: t("applyToDocument"),
                      hint: t("applyToDocumentHint"),
                    },
                    {
                      value: "download",
                      label: t("downloadOnly"),
                      hint: t("downloadOnlyHint"),
                    },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                      outputMode === option.value
                        ? "border-primary bg-primary/5"
                        : "border-input hover:bg-muted"
                    }`}
                  >
                    <input
                      type="radio"
                      name="watermark-output-mode"
                      value={option.value}
                      checked={outputMode === option.value}
                      onChange={() => setOutputMode(option.value)}
                      className="mt-0.5 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {option.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {addWatermark.isError && (
            <p className="text-sm text-destructive">
              {(addWatermark.error as Error)?.message ?? "Échec du filigrane."}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border border-input hover:bg-muted"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!currentFile || !text.trim() || addWatermark.isPending}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {addWatermark.isPending && (
                <Loader2 size={14} className="animate-spin" />
              )}
              Appliquer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
