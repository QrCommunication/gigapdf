"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, Minimize2 } from "lucide-react";
import { useCompressPdf, downloadBlob } from "@giga-pdf/api";

export interface CompressDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  /** Suggested filename for the resulting download. */
  baseFilename?: string;
  /**
   * Called with the compressed PDF when the user chooses to apply the
   * compression to the current document (instead of downloading a copy).
   * When omitted, the dialog falls back to download-only behaviour.
   */
  onApplied?: (blob: Blob) => void;
}

/** What to do with the compressed PDF once produced. */
type OutputMode = "apply" | "download";

/**
 * How to serialise the output:
 *   standard  — default recompression pipeline (maximum size reduction)
 *   optimize  — compact object streams + xref stream (ISO 32000)
 *   linearize — linearized / Fast Web View (progressive web rendering)
 */
type StructureMode = "standard" | "optimize" | "linearize";

/** %PDF header banner for the optimized / linearized output. */
type PdfVersion = "1.7" | "2.0";

/** Human-readable byte size (fr-style separator handled by toLocaleString). */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

/**
 * CompressDialog — run the dedicated compression pipeline (native
 * normalisation + garbage collection / compression) on the current PDF and
 * either swap the live document with the compressed binary or download a
 * compressed copy. Mirrors the WatermarkDialog apply/download pattern.
 */
export function CompressDialog({
  open,
  onClose,
  currentFile,
  baseFilename = "document.pdf",
  onApplied,
}: CompressDialogProps) {
  const t = useTranslations("editor.compress");
  const [outputMode, setOutputMode] = useState<OutputMode>("apply");
  const [structure, setStructure] = useState<StructureMode>("standard");
  const [version, setVersion] = useState<PdfVersion>("1.7");
  const compress = useCompressPdf();

  // Without an onApplied callback there is nothing to apply the result to —
  // the dialog degrades to download-only behaviour.
  const canApplyToDocument = Boolean(onApplied);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile || compress.isPending) return;
    const result = await compress.mutateAsync({
      file: currentFile,
      optimize: structure === "optimize",
      linearize: structure === "linearize",
      version,
    });
    if (canApplyToDocument && outputMode === "apply") {
      // Hand the compressed binary to the editor so it replaces the live
      // document (and gets persisted) instead of only producing a download.
      onApplied?.(result.blob);
    } else {
      downloadBlob(
        result.blob,
        baseFilename.replace(/\.pdf$/i, "") + ".compressed.pdf",
      );
    }
    // Keep the dialog open: the before→after summary below tells the user
    // what the compression actually gained.
  };

  const handleClose = () => {
    compress.reset();
    onClose();
  };

  if (!open) return null;

  const result = compress.data;
  const percent =
    result && result.originalSize > 0
      ? Math.round(
          ((result.originalSize - result.compressedSize) / result.originalSize) *
            100,
        )
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compress-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <Minimize2 size={18} className="text-muted-foreground" />
            <h2
              id="compress-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("close")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="px-6 pb-6 pt-2 space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("currentSize", {
              size: currentFile ? formatBytes(currentFile.size) : "—",
            })}
          </p>

          <fieldset>
            <legend className="block text-sm font-medium text-foreground mb-1">
              {t("structureLabel")}
            </legend>
            <div className="space-y-2">
              {(
                [
                  {
                    value: "standard",
                    label: t("structureStandard"),
                    hint: t("structureStandardHint"),
                  },
                  {
                    value: "optimize",
                    label: t("structureOptimize"),
                    hint: t("structureOptimizeHint"),
                  },
                  {
                    value: "linearize",
                    label: t("structureLinearize"),
                    hint: t("structureLinearizeHint"),
                  },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                    structure === option.value
                      ? "border-primary bg-primary/5"
                      : "border-input hover:bg-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="compress-structure"
                    value={option.value}
                    checked={structure === option.value}
                    onChange={() => setStructure(option.value)}
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

          {structure !== "standard" && (
            <div>
              <label
                htmlFor="compress-version"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t("versionLabel")}
              </label>
              <select
                id="compress-version"
                value={version}
                onChange={(e) => setVersion(e.target.value as PdfVersion)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="1.7">PDF 1.7</option>
                <option value="2.0">PDF 2.0</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("versionHint")}
              </p>
            </div>
          )}

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
                      name="compress-output-mode"
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

          {result && (
            <div className="rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
              {result.compressedSize < result.originalSize ? (
                <p className="text-foreground">
                  {t("resultSmaller", {
                    before: formatBytes(result.originalSize),
                    after: formatBytes(result.compressedSize),
                    percent,
                  })}
                </p>
              ) : (
                <p className="text-muted-foreground">
                  {t("resultNotSmaller", {
                    before: formatBytes(result.originalSize),
                    after: formatBytes(result.compressedSize),
                  })}
                </p>
              )}
            </div>
          )}

          {compress.isError && (
            <p className="text-sm text-destructive">
              {(compress.error as Error)?.message ?? t("failed")}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-md border border-input hover:bg-muted"
            >
              {result ? t("close") : t("cancel")}
            </button>
            <button
              type="submit"
              disabled={!currentFile || compress.isPending}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {compress.isPending && (
                <Loader2 size={14} className="animate-spin" />
              )}
              {t("compressButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
