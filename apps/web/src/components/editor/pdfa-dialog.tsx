"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, FileCheck2, AlertCircle, Accessibility } from "lucide-react";
import { downloadBlob } from "@giga-pdf/api";
import type { DocumentLanguageInfo } from "@giga-pdf/types";

export interface PdfADialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  baseFilename?: string;
  /**
   * Detected document language. Shown read-only for the accessible (tagged)
   * outputs: the engine writes `/Lang` from this signal automatically — the SDK
   * exposes no language setter, so it is informative, not editable.
   */
  documentLanguage?: DocumentLanguageInfo;
}

/** The six ISO 19005 PDF/A conformance levels the engine emits. */
type Variant = "pdfa-1b" | "pdfa-1a" | "pdfa-2b" | "pdfa-2u" | "pdfa-2a" | "pdfa-3b";

/** Display order: recommended first, then the rest by ISO part. */
const VARIANTS: Variant[] = [
  "pdfa-2u",
  "pdfa-2b",
  "pdfa-2a",
  "pdfa-1b",
  "pdfa-1a",
  "pdfa-3b",
];

/** Level-A PDF/A variants carry a logical structure tree (Tagged PDF). */
const TAGGED_VARIANTS = new Set<Variant>(["pdfa-1a", "pdfa-2a"]);

/** Bearer token for the expo/widget auth path; cookie session is sent anyway. */
function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * PdfADialog — convert the current PDF to a PDF/A archival flavour, or to an
 * accessible Tagged / PDF/UA-1 document, via the engine. The variant choice
 * controls which source features survive and whether the output is tagged
 * (level-A / PDF/UA); figure alt-text only applies to tagged outputs. We default
 * to pdfa-2u (recommended for most legal/archival use cases) and surface the
 * trade-offs inline so the user picks knowingly.
 */
export function PdfADialog({
  open,
  onClose,
  currentFile,
  baseFilename = "document",
  documentLanguage,
}: PdfADialogProps) {
  const t = useTranslations("editor.pdfa");
  const [variant, setVariant] = useState<Variant>("pdfa-2u");
  const [pdfUa, setPdfUa] = useState(false);
  const [figureAltsText, setFigureAltsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The output is tagged (and so honours figure alt-text + writes /Lang) when
  // PDF/UA is requested or a level-A PDF/A variant is chosen.
  const isTagged = pdfUa || TAGGED_VARIANTS.has(variant);

  // Clear transient state whenever the dialog is reopened.
  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile || busy) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", currentFile);
      form.append("variant", variant);
      if (pdfUa) form.append("pdfUa", "true");

      // One alt description per line, mapped to figure 0, 1, 2…; trailing blank
      // lines are dropped, interior blanks keep the engine's placeholder.
      if (isTagged && figureAltsText.trim() !== "") {
        const alts = figureAltsText.split("\n").map((s) => s.trim());
        while (alts.length > 0 && alts[alts.length - 1] === "") alts.pop();
        if (alts.length > 0) form.append("figureAlts", JSON.stringify(alts));
      }

      const response = await fetch("/api/pdf/pdfa", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const json = (await response.json()) as { error?: string };
          if (json?.error) message = json.error;
        } catch {
          // non-JSON error body — keep the status message
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const suffix = pdfUa ? ".ua.pdf" : `.${variant}.pdf`;
      downloadBlob(blob, baseFilename.replace(/\.pdf$/i, "") + suffix);
      onClose();
    } catch (err) {
      // Keep the dialog open so the user can pick a different level.
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const detectedLang = documentLanguage?.lang;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdfa-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md max-h-[90vh] rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <FileCheck2 size={18} className="text-muted-foreground" />
            <h2
              id="pdfa-dialog-title"
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

        <form
          onSubmit={submit}
          className="px-6 pb-6 pt-2 space-y-4 overflow-y-auto min-h-0"
        >
          <div>
            <label
              htmlFor="pdfa-variant"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("variantLabel")}
            </label>
            <select
              id="pdfa-variant"
              value={variant}
              onChange={(e) => setVariant(e.target.value as Variant)}
              disabled={pdfUa}
              title={pdfUa ? t("variantDisabledByUa") : undefined}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {VARIANTS.map((v) => (
                <option key={v} value={v}>
                  {t(`level.${v}.label`)}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {pdfUa ? t("variantDisabledByUa") : t(`level.${variant}.desc`)}
            </p>
          </div>

          {/* PDF/UA — accessible tagged PDF (supersedes the PDF/A level). */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pdfUa}
              onChange={(e) => setPdfUa(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Accessibility size={14} className="text-muted-foreground" />
                {t("pdfUaLabel")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("pdfUaHint")}
              </span>
            </span>
          </label>

          {/* Accessibility extras — only meaningful for a tagged output. */}
          {isTagged && (
            <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">
                {detectedLang
                  ? t("languageDetected", { lang: detectedLang })
                  : t("languageAuto")}
              </p>
              <div>
                <label
                  htmlFor="pdfa-figure-alts"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t("figureAltsLabel")}
                </label>
                <textarea
                  id="pdfa-figure-alts"
                  value={figureAltsText}
                  onChange={(e) => setFigureAltsText(e.target.value)}
                  rows={3}
                  placeholder={t("figureAltsPlaceholder")}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("figureAltsHint")}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <AlertCircle
                size={16}
                className="text-destructive shrink-0 mt-0.5"
              />
              <p className="text-xs text-destructive">{error}</p>
            </div>
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
              disabled={!currentFile || busy}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t("convert")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
