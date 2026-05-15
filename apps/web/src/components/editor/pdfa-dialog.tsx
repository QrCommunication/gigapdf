"use client";

import React, { useState } from "react";
import { X, Loader2, FileCheck2, AlertCircle } from "lucide-react";
import { useConvertToPdfA, downloadBlob } from "@giga-pdf/api";

export interface PdfADialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  baseFilename?: string;
}

type Variant = "pdfa-1b" | "pdfa-1a" | "pdfa-2b" | "pdfa-2u" | "pdfa-3b";

const VARIANTS: { value: Variant; label: string; desc: string }[] = [
  {
    value: "pdfa-2u",
    label: "PDF/A-2u (recommandé)",
    desc: "PDF 1.7 + Unicode. Convient à la plupart des cas d'archivage légal.",
  },
  {
    value: "pdfa-3b",
    label: "PDF/A-3b",
    desc: "PDF/A-2 + fichiers embarqués (ZUGFeRD, factures électroniques).",
  },
  {
    value: "pdfa-2b",
    label: "PDF/A-2b",
    desc: "PDF 1.7, fidélité visuelle uniquement. Compatible avec la plupart des PDF modernes.",
  },
  {
    value: "pdfa-1b",
    label: "PDF/A-1b (Basic)",
    desc: "PDF 1.4. Le plus contraint : pas de transparence ni JavaScript.",
  },
  {
    value: "pdfa-1a",
    label: "PDF/A-1a (Accessible)",
    desc: "PDF/A-1b + arbre de structure (Tagged PDF). Requis pour accessibilité.",
  },
];

/**
 * PdfADialog — convert the current PDF to a PDF/A archival flavour via
 * MuPDF. Variant choice affects which source features survive the
 * conversion. We default to pdfa-2u (recommended for most legal/archival
 * use cases) and surface the trade-offs inline so the user picks knowingly.
 */
export function PdfADialog({
  open,
  onClose,
  currentFile,
  baseFilename = "document",
}: PdfADialogProps) {
  const [variant, setVariant] = useState<Variant>("pdfa-2u");
  const convert = useConvertToPdfA();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile) return;
    try {
      const blob = await convert.mutateAsync({ file: currentFile, variant });
      downloadBlob(
        blob,
        baseFilename.replace(/\.pdf$/i, "") + "." + variant + ".pdf",
      );
      onClose();
    } catch {
      // error is surfaced via convert.error below — keep dialog open so
      // the user can pick a different variant.
    }
  };

  if (!open) return null;

  const selected = VARIANTS.find((v) => v.value === variant);

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
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <FileCheck2 size={18} className="text-muted-foreground" />
            <h2
              id="pdfa-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              Convertir en PDF/A (archivage)
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
              Variant
            </label>
            <select
              value={variant}
              onChange={(e) => setVariant(e.target.value as Variant)}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {VARIANTS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
            {selected && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {selected.desc}
              </p>
            )}
          </div>

          {convert.isError && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <AlertCircle
                size={16}
                className="text-destructive shrink-0 mt-0.5"
              />
              <p className="text-xs text-destructive">
                {(convert.error as Error)?.message ?? "Conversion échouée."}
              </p>
            </div>
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
              disabled={!currentFile || convert.isPending}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {convert.isPending && (
                <Loader2 size={14} className="animate-spin" />
              )}
              Convertir
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
