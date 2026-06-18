"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, ScanText, Download, AlertCircle } from "lucide-react";
import {
  useOcrPdf,
  useMakeSearchablePdf,
  useIsOcrAvailable,
  downloadBlob,
} from "@giga-pdf/api";

export interface OcrDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  baseFilename?: string;
  /**
   * Called with the searchable PDF (invisible OCR text layer baked in) when
   * the user picks the "searchable" output mode. When omitted, the dialog
   * falls back to downloading the searchable copy.
   */
  onApplied?: (blob: Blob) => void;
}

type Lang = "fra+eng" | "fra" | "eng";
type Dpi = 144 | 200 | 300;
/** "text" extracts plain text; "searchable" bakes an invisible text layer. */
type OutputMode = "text" | "searchable";

const LANGS: { value: Lang; label: string }[] = [
  { value: "fra+eng", label: "Français + Anglais" },
  { value: "fra", label: "Français" },
  { value: "eng", label: "Anglais" },
];

/**
 * OcrDialog — run OCR on the current PDF. Two output modes:
 *   - "text" (historical): extracted text shown inline, downloadable .txt
 *   - "searchable": the OCR words are written back into the PDF as an
 *     INVISIBLE text layer (opacity 0) so scanned pages become selectable
 *     and searchable. The result replaces the live document via onApplied.
 * Higher DPI (200/300) takes longer but recovers low-resolution scans better.
 */
export function OcrDialog({
  open,
  onClose,
  currentFile,
  baseFilename = "document",
  onApplied,
}: OcrDialogProps) {
  const t = useTranslations("editor.ocr");
  const [lang, setLang] = useState<Lang>("fra+eng");
  const [dpi, setDpi] = useState<Dpi>(144);
  const [pagesInput, setPagesInput] = useState("");
  const [outputMode, setOutputMode] = useState<OutputMode>("text");

  const ocr = useOcrPdf();
  const makeSearchable = useMakeSearchablePdf();
  const availabilityCheck = useIsOcrAvailable();
  const [available, setAvailable] = useState<boolean | null>(null);

  // Probe availability once per opening.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    availabilityCheck.mutateAsync().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      ocr.reset();
      makeSearchable.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsePages = (raw: string): number[] | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const out = new Set<number>();
    for (const part of trimmed.split(",")) {
      const seg = part.trim();
      const range = seg.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        for (let i = Number(range[1]); i <= Number(range[2]); i++) out.add(i);
      } else if (/^\d+$/.test(seg)) {
        out.add(Number(seg));
      }
    }
    return out.size > 0 ? Array.from(out).sort((a, b) => a - b) : undefined;
  };

  const busy = ocr.isPending || makeSearchable.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile || available === false || busy) return;

    if (outputMode === "searchable") {
      const result = await makeSearchable.mutateAsync({
        file: currentFile,
        options: { lang, dpi },
      });
      if (onApplied) {
        // Hand the searchable binary to the editor so it replaces the live
        // document (and gets persisted), exactly like the watermark flow.
        onApplied(result.blob);
        onClose();
      } else {
        downloadBlob(
          result.blob,
          baseFilename.replace(/\.pdf$/i, "") + ".searchable.pdf",
        );
        onClose();
      }
      return;
    }

    await ocr.mutateAsync({
      file: currentFile,
      options: {
        lang,
        dpi,
        format: "text",
        pages: parsePages(pagesInput),
      },
    });
  };

  const downloadTxt = () => {
    if (!ocr.data) return;
    const blob = new Blob([ocr.data.fullText], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, baseFilename.replace(/\.pdf$/i, "") + ".ocr.txt");
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ocr-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <ScanText size={18} className="text-muted-foreground" />
            <h2
              id="ocr-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              Reconnaissance de texte (OCR)
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

        {available === false ? (
          <div className="px-6 py-6 flex items-start gap-3 text-sm">
            <AlertCircle size={18} className="text-destructive shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              Le moteur OCR n'est pas disponible. Réessayez plus tard ou
              contactez l'administrateur.
            </p>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="px-6 pb-4 pt-2 space-y-3 shrink-0 grid grid-cols-3 gap-3"
          >
            <fieldset className="col-span-3">
              <legend className="block text-xs font-medium text-foreground mb-1">
                {t("modeLabel")}
              </legend>
              <div className="space-y-2">
                {(
                  [
                    {
                      value: "text",
                      label: t("modeText"),
                      hint: t("modeTextHint"),
                    },
                    {
                      value: "searchable",
                      label: t("modeSearchable"),
                      hint: t("modeSearchableHint"),
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
                      name="ocr-output-mode"
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

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Langue(s)
              </label>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
                className="w-full px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Qualité (DPI)
              </label>
              <select
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value) as Dpi)}
                className="w-full px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value={144}>144 (rapide)</option>
                <option value={200}>200 (équilibré)</option>
                <option value={300}>300 (haute qualité)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Pages
              </label>
              <input
                value={pagesInput}
                onChange={(e) => setPagesInput(e.target.value)}
                placeholder="1-3, 5"
                disabled={outputMode === "searchable"}
                title={
                  outputMode === "searchable" ? t("pagesIgnoredHint") : undefined
                }
                className="w-full px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>
            <div className="col-span-3 flex items-center justify-end gap-3">
              {makeSearchable.isPending && (
                <p className="text-xs text-muted-foreground">
                  {t("searchableProcessing")}
                </p>
              )}
              <button
                type="submit"
                disabled={!currentFile || busy}
                className="px-4 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {outputMode === "searchable"
                  ? t("searchableButton")
                  : "Lancer l'OCR"}
              </button>
            </div>
          </form>
        )}

        {/* Results */}
        <div className="px-6 pb-6 flex-1 overflow-y-auto min-h-0">
          {ocr.isError && (
            <p className="text-sm text-destructive">
              {(ocr.error as Error)?.message ?? "L'OCR a échoué."}
            </p>
          )}
          {makeSearchable.isError && (
            <p className="text-sm text-destructive">
              {(makeSearchable.error as Error)?.message ?? t("searchableFailed")}
            </p>
          )}
          {ocr.data && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {ocr.data.pages.length} page(s) traitée(s) —{" "}
                  {ocr.data.fullText.length} caractères extraits
                </p>
                <button
                  type="button"
                  onClick={downloadTxt}
                  className="px-3 py-1.5 text-xs rounded-md border border-input hover:bg-muted flex items-center gap-1.5"
                >
                  <Download size={12} />
                  Télécharger .txt
                </button>
              </div>
              <textarea
                value={ocr.data.fullText}
                readOnly
                className="w-full h-64 px-3 py-2 rounded-md border border-input bg-muted/30 text-xs font-mono"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
