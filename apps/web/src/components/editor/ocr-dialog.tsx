"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, ScanText, Download, AlertCircle } from "lucide-react";
import {
  useOcrPdf,
  useMakeSearchablePdf,
  useMakeEditableOcrPdf,
  useIsOcrAvailable,
  downloadBlob,
} from "@giga-pdf/api";

export interface OcrDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  baseFilename?: string;
  /**
   * 1-based number of the page currently focused in the editor. Drives the
   * "current page only" scope for the searchable/editable modes. Defaults to 1
   * when omitted (e.g. a non-editor caller).
   */
  currentPageNumber?: number;
  /**
   * Called with the searchable PDF (invisible OCR text layer baked in) when
   * the user picks the "searchable" output mode. When omitted, the dialog
   * falls back to downloading the searchable copy.
   */
  onApplied?: (blob: Blob) => void;
}

type Dpi = 144 | 200 | 300;
/**
 * "text" extracts plain text; "searchable" bakes an invisible text layer
 * (appearance preserved); "editable" masks the scan and lays REAL editable text
 * on top so the recognized text can be corrected in the editor.
 */
type OutputMode = "text" | "searchable" | "editable";

/**
 * OCR scope for the binary (searchable/editable) modes: the whole document
 * (historical default) or only the page currently focused in the editor.
 */
type OcrScope = "document" | "currentPage";

/**
 * The 12 writing systems offered in the UI. Several distinct user choices share
 * a single bundled OCR model (Latin and Cyrillic both use "alpha"; Arabic and
 * Hebrew both use "arabic"; Chinese simplified and traditional both use "cjk"),
 * so each choice maps to the concrete OcrScript identifiers the engine loads.
 * `scripts` is threaded through to makeSearchablePdf / makeEditableOcrPdf so the
 * engine only loads the relevant model(s) instead of every bundled one.
 */
type ScriptChoice =
  | "latin"
  | "cyrillic"
  | "arabic"
  | "hebrew"
  | "devanagari"
  | "tamil"
  | "telugu"
  | "kannada"
  | "chinese_simplified"
  | "chinese_traditional"
  | "japanese"
  | "korean";

/** UI choice → bundled OcrScript identifier(s) understood by the engine. */
const SCRIPT_CHOICES: { value: ScriptChoice; scripts: string[] }[] = [
  { value: "latin", scripts: ["alpha"] },
  { value: "cyrillic", scripts: ["alpha"] },
  { value: "arabic", scripts: ["arabic"] },
  { value: "hebrew", scripts: ["arabic"] },
  { value: "devanagari", scripts: ["devanagari"] },
  { value: "tamil", scripts: ["tamil"] },
  { value: "telugu", scripts: ["telugu"] },
  { value: "kannada", scripts: ["kannada"] },
  { value: "chinese_simplified", scripts: ["cjk"] },
  { value: "chinese_traditional", scripts: ["cjk"] },
  { value: "japanese", scripts: ["japanese"] },
  { value: "korean", scripts: ["korean"] },
];

const SCRIPTS_FOR_CHOICE: Record<ScriptChoice, string[]> = Object.fromEntries(
  SCRIPT_CHOICES.map((c) => [c.value, c.scripts]),
) as Record<ScriptChoice, string[]>;

/**
 * OcrDialog — run OCR on the current PDF. Three output modes:
 *   - "text" (historical): extracted text shown inline, downloadable .txt
 *   - "searchable": the OCR words are written back into the PDF as an
 *     INVISIBLE text layer (opacity 0) so scanned pages become selectable
 *     and searchable. The page appearance is preserved.
 *   - "editable": each scanned text zone is masked with its local background
 *     colour and a REAL, visible OCR text run is laid on top, so the recognized
 *     text can be edited in the editor (no scan showing through).
 * The "searchable"/"editable" results replace the live document via onApplied.
 * Higher DPI (200/300) takes longer but recovers low-resolution scans better.
 */
export function OcrDialog({
  open,
  onClose,
  currentFile,
  baseFilename = "document",
  currentPageNumber = 1,
  onApplied,
}: OcrDialogProps) {
  const t = useTranslations("editor.ocr");
  const [script, setScript] = useState<ScriptChoice>("latin");
  const [dpi, setDpi] = useState<Dpi>(144);
  const [pagesInput, setPagesInput] = useState("");
  const [outputMode, setOutputMode] = useState<OutputMode>("text");
  // Binary-mode scope: OCR the whole document (default) or just the page the
  // user is currently on. Threaded to the engine as a 1-page `pageRange`.
  const [scope, setScope] = useState<OcrScope>("document");
  // Opt-in handwriting recognition. The engine ships a single cursive model,
  // Latin only, so the option is offered only for the Latin writing system.
  const [handwriting, setHandwriting] = useState(false);

  const ocr = useOcrPdf();
  const makeSearchable = useMakeSearchablePdf();
  const makeEditable = useMakeEditableOcrPdf();
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
      makeEditable.reset();
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

  const busy = ocr.isPending || makeSearchable.isPending || makeEditable.isPending;
  /** Both binary modes (searchable/editable) bake an OCR PDF the editor adopts. */
  const isBinaryMode = outputMode === "searchable" || outputMode === "editable";
  /** 1-based page the "current page only" scope targets (always ≥ 1). */
  const targetPage = Math.max(1, Math.floor(currentPageNumber));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile || available === false || busy) return;

    if (isBinaryMode) {
      // Restrict the OCR engine to the chosen writing system's bundled model(s).
      const scripts = SCRIPTS_FOR_CHOICE[script];
      // Handwriting recognition is Latin-only — never send it for other scripts.
      const useHandwriting = handwriting && script === "latin";
      // "Current page only" scope → a single-page range; "document" → undefined
      // (whole document, historical default). The page is clamped to ≥ 1.
      const pageRange =
        scope === "currentPage"
          ? { from: targetPage, to: targetPage }
          : undefined;
      const result =
        outputMode === "editable"
          ? await makeEditable.mutateAsync({
              file: currentFile,
              options: { dpi, scripts, handwriting: useHandwriting, pageRange },
            })
          : await makeSearchable.mutateAsync({
              file: currentFile,
              options: { dpi, scripts, handwriting: useHandwriting, pageRange },
            });
      if (onApplied) {
        // Hand the OCR'd binary to the editor so it replaces the live document
        // (and gets persisted + re-parsed), exactly like the watermark flow.
        onApplied(result.blob);
        onClose();
      } else {
        const suffix = outputMode === "editable" ? ".editable.pdf" : ".searchable.pdf";
        downloadBlob(result.blob, baseFilename.replace(/\.pdf$/i, "") + suffix);
        onClose();
      }
      return;
    }

    await ocr.mutateAsync({
      file: currentFile,
      options: {
        // The plain-text extractor is script-agnostic (the engine loads every
        // bundled model); `lang` is kept only to satisfy the route contract.
        lang: "fra+eng",
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
                    {
                      value: "editable",
                      label: t("modeEditable"),
                      hint: t("modeEditableHint"),
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

            {/* OCR scope (binary modes only): whole document or current page. */}
            <fieldset className="col-span-3">
              <legend className="block text-xs font-medium text-foreground mb-1">
                {t("scopeLabel")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { value: "document", label: t("scopeDocument") },
                    {
                      value: "currentPage",
                      label: t("scopeCurrentPage", { page: targetPage }),
                    },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      !isBinaryMode
                        ? "border-input opacity-60 cursor-not-allowed"
                        : scope === option.value
                          ? "border-primary bg-primary/5 cursor-pointer"
                          : "border-input hover:bg-muted cursor-pointer"
                    }`}
                    title={!isBinaryMode ? t("scopeTextHint") : undefined}
                  >
                    <input
                      type="radio"
                      name="ocr-scope"
                      value={option.value}
                      checked={scope === option.value}
                      disabled={!isBinaryMode}
                      onChange={() => setScope(option.value)}
                      className="accent-primary"
                    />
                    <span className="text-foreground">{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="ocr-script"
                className="block text-xs font-medium text-foreground mb-1"
              >
                {t("scriptLabel")}
              </label>
              <select
                id="ocr-script"
                value={script}
                onChange={(e) => setScript(e.target.value as ScriptChoice)}
                disabled={!isBinaryMode}
                title={!isBinaryMode ? t("scriptTextHint") : undefined}
                className="w-full px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                {SCRIPT_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(`lang.${c.value}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <label
                className={`flex items-start gap-2 text-xs ${
                  isBinaryMode && script === "latin"
                    ? "text-foreground cursor-pointer"
                    : "text-muted-foreground cursor-not-allowed opacity-60"
                }`}
                title={
                  !isBinaryMode
                    ? t("scriptTextHint")
                    : script !== "latin"
                      ? t("handwritingLatinOnlyHint")
                      : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={handwriting && script === "latin"}
                  disabled={!isBinaryMode || script !== "latin"}
                  onChange={(e) => setHandwriting(e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{t("handwritingLabel")}</span>
                  <span className="block text-muted-foreground">
                    {t("handwritingHint")}
                  </span>
                </span>
              </label>
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
                disabled={isBinaryMode}
                title={isBinaryMode ? t("pagesIgnoredHint") : undefined}
                className="w-full px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>
            <div className="col-span-3 flex items-center justify-end gap-3">
              {makeSearchable.isPending && (
                <p className="text-xs text-muted-foreground">
                  {t("searchableProcessing")}
                </p>
              )}
              {makeEditable.isPending && (
                <p className="text-xs text-muted-foreground">
                  {t("editableProcessing")}
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
                  : outputMode === "editable"
                    ? t("editableButton")
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
          {makeEditable.isError && (
            <p className="text-sm text-destructive">
              {(makeEditable.error as Error)?.message ?? t("editableFailed")}
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
