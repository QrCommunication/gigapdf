"use client";

import { useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, Scissors, Download, Loader2, FileUp, AlertCircle } from "lucide-react";
import { useSplitPdf, downloadBlob } from "@giga-pdf/api";
import type { SplitPdfResult } from "@giga-pdf/api";

type SplitMode = "splitPoints" | "ranges";

export interface SplitDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile?: File | null;
}

function base64ToBlob(base64: string, mimeType = "application/pdf"): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function parseSplitPoints(raw: string): number[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(",").map((s) => s.trim());
  const nums: number[] = [];
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n <= 0) return null;
    nums.push(n);
  }
  return nums.length > 0 ? nums : null;
}

function parseRanges(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(",").map((s) => s.trim());
  const rangePattern = /^\d+-\d+$/;
  for (const part of parts) {
    if (!rangePattern.test(part)) return null;
    const [start, end] = part.split("-").map(Number) as [number, number];
    if (start > end) return null;
  }
  return parts.length > 0 ? parts : null;
}

export function SplitDialog({ open, onClose, currentFile }: SplitDialogProps) {
  const t = useTranslations("editor.split");
  const [mode, setMode] = useState<SplitMode>("splitPoints");
  const [splitPointsInput, setSplitPointsInput] = useState("");
  const [rangesInput, setRangesInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<SplitPdfResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { mutate: splitPdf, isPending, error: mutationError, reset } = useSplitPdf();

  const activeFile = currentFile ?? selectedFile;

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      setSelectedFile(file);
      setValidationError(null);
      setResult(null);
      reset();
    },
    [reset],
  );

  const handleModeChange = useCallback(
    (newMode: SplitMode) => {
      setMode(newMode);
      setValidationError(null);
      setResult(null);
      reset();
    },
    [reset],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setValidationError(null);
      setResult(null);
      reset();

      if (!activeFile) {
        setValidationError(t("errorNoFile"));
        return;
      }

      if (mode === "splitPoints") {
        const points = parseSplitPoints(splitPointsInput);
        if (!points) {
          setValidationError(t("errorInvalidSplitPoints"));
          return;
        }
        splitPdf(
          { file: activeFile, options: { splitPoints: points } },
          {
            onSuccess: (data) => setResult(data),
          },
        );
      } else {
        const ranges = parseRanges(rangesInput);
        if (!ranges) {
          setValidationError(t("errorInvalidRanges"));
          return;
        }
        splitPdf(
          { file: activeFile, options: { ranges } },
          {
            onSuccess: (data) => setResult(data),
          },
        );
      }
    },
    [activeFile, mode, splitPointsInput, rangesInput, splitPdf, reset, t],
  );

  const handleDownloadPart = useCallback((base64: string, filename: string) => {
    const blob = base64ToBlob(base64);
    downloadBlob(blob, filename);
  }, []);

  const handleDownloadAll = useCallback(() => {
    if (!result) return;
    for (const part of result.parts) {
      const blob = base64ToBlob(part.data);
      downloadBlob(blob, part.filename);
    }
  }, [result]);

  const handleClose = useCallback(() => {
    setSplitPointsInput("");
    setRangesInput("");
    setSelectedFile(null);
    setValidationError(null);
    setResult(null);
    reset();
    onClose();
  }, [onClose, reset]);

  if (!open) return null;

  const errorMessage =
    validationError ??
    (mutationError instanceof Error ? mutationError.message : null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-dialog-title"
    >
      <div className="relative w-full max-w-lg rounded-xl bg-background shadow-2xl border border-border flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Scissors size={20} className="text-primary" />
            <h2
              id="split-dialog-title"
              className="text-base font-semibold text-foreground"
            >
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("closeDialog")}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          <form id="split-form" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-5">
              {/* File input — only shown when no currentFile prop */}
              {!currentFile && (
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="split-file-input"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("fileLabel")}
                  </label>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        fileInputRef.current?.click();
                      }
                    }}
                    className="flex items-center gap-3 rounded-lg border-2 border-dashed border-border px-4 py-3 cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors"
                  >
                    <FileUp size={18} className="text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground truncate">
                      {selectedFile ? selectedFile.name : t("filePlaceholder")}
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    id="split-file-input"
                    type="file"
                    accept=".pdf,application/pdf"
                    className="sr-only"
                    onChange={handleFileChange}
                    aria-label={t("fileInputAria")}
                  />
                </div>
              )}

              {/* Active file indicator when currentFile is provided */}
              {currentFile && (
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                  <FileUp size={15} className="text-muted-foreground shrink-0" />
                  <span className="text-sm text-muted-foreground truncate">
                    {currentFile.name}
                  </span>
                </div>
              )}

              {/* Mode toggle */}
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">
                  {t("modeLabel")}
                </span>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="split-mode"
                      value="splitPoints"
                      checked={mode === "splitPoints"}
                      onChange={() => handleModeChange("splitPoints")}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground">{t("modeByPages")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="split-mode"
                      value="ranges"
                      checked={mode === "ranges"}
                      onChange={() => handleModeChange("ranges")}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground">{t("modeByRanges")}</span>
                  </label>
                </div>
              </div>

              {/* Input based on mode */}
              {mode === "splitPoints" ? (
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="split-points-input"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("splitPointsLabel")}
                  </label>
                  <input
                    id="split-points-input"
                    type="text"
                    value={splitPointsInput}
                    onChange={(e) => {
                      setSplitPointsInput(e.target.value);
                      setValidationError(null);
                    }}
                    placeholder={t("splitPointsPlaceholder")}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                    aria-describedby="split-points-hint"
                  />
                  <p
                    id="split-points-hint"
                    className="text-xs text-muted-foreground"
                  >
                    {t("splitPointsHint")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="ranges-input"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("rangesLabel")}
                  </label>
                  <input
                    id="ranges-input"
                    type="text"
                    value={rangesInput}
                    onChange={(e) => {
                      setRangesInput(e.target.value);
                      setValidationError(null);
                    }}
                    placeholder={t("rangesPlaceholder")}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                    aria-describedby="ranges-hint"
                  />
                  <p
                    id="ranges-hint"
                    className="text-xs text-muted-foreground"
                  >
                    {t("rangesHint")}
                  </p>
                </div>
              )}

              {/* Error message */}
              {errorMessage && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5"
                >
                  <AlertCircle
                    size={16}
                    className="text-destructive shrink-0 mt-0.5"
                  />
                  <p className="text-sm text-destructive">{errorMessage}</p>
                </div>
              )}

              {/* Results */}
              {result && result.parts.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">
                      {t("partsCreated", { count: result.partsCount })}
                    </span>
                    {result.parts.length > 1 && (
                      <button
                        type="button"
                        onClick={handleDownloadAll}
                        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <Download size={13} />
                        {t("downloadAll")}
                      </button>
                    )}
                  </div>
                  <ul className="flex flex-col gap-1.5" role="list">
                    {result.parts.map((part, index) => (
                      <li
                        key={`${part.filename}-${index}`}
                        className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2"
                      >
                        <span className="text-sm text-foreground truncate mr-3">
                          {part.filename}
                          {part.pageCount !== null && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {t("pageCount", { count: part.pageCount })}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleDownloadPart(part.data, part.filename)
                          }
                          aria-label={t("downloadPart", { filename: part.filename })}
                          className="flex items-center gap-1.5 shrink-0 rounded-md px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <Download size={13} />
                          {t("download")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {result ? t("closeButton") : t("cancel")}
          </button>
          {!result && (
            <button
              type="submit"
              form="split-form"
              disabled={isPending || !activeFile}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {t("splitting")}
                </>
              ) : (
                <>
                  <Scissors size={15} />
                  {t("submit")}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
