"use client";

import type { ReactNode } from "react";
import {
  AlignLeft,
  Bold,
  FileCheck2,
  FileText,
  Folder,
  FolderOpen,
  History,
  Italic,
  Lock,
  Search,
  Underline,
} from "lucide-react";
import { cn } from "@giga-pdf/ui/lib/utils";
import { CropMarks } from "./crop-marks";

/* ──────────────────────────────────────────────────────────────────────────
   Vignettes statiques (CSS pur, aria-hidden) illustrant les sections
   numérotées du cahier. Aucune animation : les mouvements vivent dans la
   section bento. Aucune image bitmap.
   ────────────────────────────────────────────────────────────────────────── */

function Frame({
  children,
  className,
  withCropMarks = false,
}: {
  children: ReactNode;
  className?: string;
  withCropMarks?: boolean;
}) {
  return (
    <div aria-hidden="true" className="relative">
      {withCropMarks ? <CropMarks /> : null}
      <div
        className={cn(
          "overflow-hidden rounded-md border border-border bg-card p-5 shadow-sm sm:p-6",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** 01 — ÉDITION : page + barre de formatage flottante + bloc sélectionné. */
export function VignetteEditing() {
  return (
    <Frame withCropMarks>
      <div className="relative mx-auto max-w-65 space-y-2 bg-white p-4 shadow-sm">
        {/* Barre de formatage flottante */}
        <div className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-sm border border-border bg-card p-1 shadow-md">
          <span className="flex h-5 w-5 items-center justify-center rounded-[2px] bg-primary/10 text-primary">
            <Bold className="h-3 w-3" />
          </span>
          <span className="flex h-5 w-5 items-center justify-center rounded-[2px] text-muted-foreground">
            <Italic className="h-3 w-3" />
          </span>
          <span className="flex h-5 w-5 items-center justify-center rounded-[2px] text-muted-foreground">
            <Underline className="h-3 w-3" />
          </span>
          <span className="mx-0.5 h-3.5 w-px bg-border" />
          <span className="flex h-5 w-5 items-center justify-center rounded-[2px] text-muted-foreground">
            <AlignLeft className="h-3 w-3" />
          </span>
          <span className="flex h-9 items-center rounded-[2px] px-1 font-mono text-[8px] text-muted-foreground">
            Lora · 11pt
          </span>
        </div>

        <div className="h-2.5 w-1/2 rounded-sm bg-zinc-800/85" />
        <div className="h-1.5 w-full rounded-sm bg-zinc-300" />
        <div className="h-1.5 w-11/12 rounded-sm bg-zinc-300" />

        <div className="relative my-2 rounded-[2px] bg-primary/5 p-2 ring-1 ring-primary">
          <span className="absolute -left-1 -top-1 h-1.5 w-1.5 border border-primary bg-white" />
          <span className="absolute -right-1 -top-1 h-1.5 w-1.5 border border-primary bg-white" />
          <span className="absolute -bottom-1 -left-1 h-1.5 w-1.5 border border-primary bg-white" />
          <span className="absolute -bottom-1 -right-1 h-1.5 w-1.5 border border-primary bg-white" />
          <div className="h-1.5 w-full rounded-sm bg-zinc-400" />
          <div className="mt-1.5 h-1.5 w-3/4 rounded-sm bg-zinc-400" />
        </div>

        <div className="h-1.5 w-full rounded-sm bg-zinc-300" />
        <div className="h-1.5 w-4/5 rounded-sm bg-zinc-300" />
        <div className="h-1.5 w-full rounded-sm bg-zinc-300" />
      </div>
    </Frame>
  );
}

/** 02 — COLLABORATION : présence, commentaire épinglé, historique. */
export function VignetteCollaboration({
  versionLabel,
}: {
  versionLabel: string;
}) {
  return (
    <Frame>
      <div className="flex items-start gap-4">
        <div className="flex-1 space-y-2 bg-white p-4 shadow-sm">
          <div className="h-2 w-2/5 rounded-sm bg-zinc-800/85" />
          <div className="h-1.5 w-full rounded-sm bg-zinc-300" />
          <div className="relative h-1.5 w-11/12 rounded-sm bg-zinc-300">
            {/* Sélection distante */}
            <span className="absolute inset-y-0 left-1/4 w-1/3 rounded-sm bg-primary/30 ring-1 ring-primary/60" />
          </div>
          <div className="h-1.5 w-full rounded-sm bg-zinc-300" />
          <div className="h-1.5 w-3/4 rounded-sm bg-zinc-300" />
          <div className="h-1.5 w-full rounded-sm bg-zinc-300" />
        </div>

        <div className="w-32 shrink-0 space-y-3">
          {/* Présence */}
          <div className="flex -space-x-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-primary/15 font-mono text-[9px] font-semibold text-primary">
              RL
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-secondary font-mono text-[9px] font-semibold text-secondary-foreground">
              CM
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted font-mono text-[9px] font-semibold text-muted-foreground">
              +2
            </span>
          </div>
          {/* Historique des versions */}
          <div className="space-y-1.5 rounded-sm border border-border p-2">
            <p className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              <History className="h-3 w-3" />
              {versionLabel}
            </p>
            {["v12", "v11", "v10"].map((version, index) => (
              <div key={version} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    index === 0 ? "bg-primary" : "bg-muted-foreground/40",
                  )}
                />
                <span className="font-mono text-[9px] text-muted-foreground">
                  {version}
                </span>
                <span className="h-1 flex-1 rounded-sm bg-muted-foreground/15" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

/** 03 — CONFIANCE : signature apposée, empreinte, badges PDF/A + AES. */
export function VignetteTrust({ stampText }: { stampText: string }) {
  return (
    <Frame withCropMarks>
      <div className="space-y-4">
        <div className="mx-auto max-w-65 space-y-2 bg-white p-4 shadow-sm">
          <div className="h-1.5 w-full rounded-sm bg-zinc-300" />
          <div className="h-1.5 w-5/6 rounded-sm bg-zinc-300" />
          <div className="mt-3 flex items-end justify-between gap-3 border-t border-zinc-200 pt-3">
            <div className="flex-1 space-y-1.5">
              <div className="h-1.5 w-2/3 rounded-sm bg-zinc-300" />
              <div className="h-1.5 w-1/2 rounded-sm bg-zinc-300" />
            </div>
            <span className="inline-flex rotate-[-8deg] items-center gap-1 rounded-sm border-2 border-primary px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
              {stampText}
              <FileCheck2 className="h-3 w-3" strokeWidth={2.5} />
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
            <Lock className="h-3 w-3" />
            AES-256
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
            PKCS#7
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
            PDF/A
          </span>
          <span className="truncate font-mono text-[9px] text-muted-foreground/70">
            sha256:9f2c…b41a
          </span>
        </div>
      </div>
    </Frame>
  );
}

/** 04 — FORMATS : fichiers Office vers la page PDF, et retour. */
export function VignetteFormats() {
  const inputs = [".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"];
  const outputs = [".docx", ".xlsx", ".pptx", ".odt", ".odp"];

  return (
    <Frame>
      <div className="flex items-center gap-4">
        <div className="grid flex-1 grid-cols-2 gap-1.5">
          {inputs.map((format) => (
            <span
              key={format}
              className="rounded-sm border border-border bg-muted/50 px-2 py-1 text-center font-mono text-[10px] text-muted-foreground"
            >
              {format}
            </span>
          ))}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1">
          <span className="font-mono text-[10px] text-primary">→</span>
          <span className="font-mono text-[10px] text-muted-foreground">←</span>
        </div>

        <div className="flex w-24 shrink-0 flex-col items-center gap-2">
          <div className="flex aspect-[3/4] w-16 flex-col justify-between border border-border bg-white p-2 shadow-sm">
            <div className="space-y-1">
              <div className="h-1 w-full rounded-sm bg-zinc-300" />
              <div className="h-1 w-4/5 rounded-sm bg-zinc-300" />
              <div className="h-1 w-full rounded-sm bg-zinc-300" />
            </div>
            <FileText className="h-4 w-4 self-end text-primary" />
          </div>
          <span className="font-mono text-[10px] font-semibold text-foreground">
            .pdf
          </span>
        </div>

        <div className="hidden flex-col gap-1.5 sm:flex">
          {outputs.map((format) => (
            <span
              key={format}
              className="rounded-sm border border-border bg-muted/50 px-2 py-0.5 text-center font-mono text-[10px] text-muted-foreground"
            >
              {format}
            </span>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/** 05 — GED : arborescence, tags, recherche plein texte. */
export function VignetteGed({
  searchPlaceholder,
}: {
  searchPlaceholder: string;
}) {
  return (
    <Frame>
      <div className="space-y-3">
        {/* Barre de recherche */}
        <div className="flex items-center gap-2 rounded-sm border border-border bg-muted/40 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[11px] text-muted-foreground">
            {searchPlaceholder}
          </span>
          <span className="h-3 w-px animate-blink border-r border-primary" />
        </div>

        <div className="flex gap-4">
          {/* Arborescence */}
          <div className="w-36 shrink-0 space-y-1.5">
            <div className="flex items-center gap-1.5 text-foreground">
              <FolderOpen className="h-3.5 w-3.5 text-primary" />
              <span className="h-1.5 w-16 rounded-sm bg-muted-foreground/40" />
            </div>
            <div className="ml-4 flex items-center gap-1.5">
              <Folder className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="h-1.5 w-14 rounded-sm bg-muted-foreground/25" />
            </div>
            <div className="ml-4 flex items-center gap-1.5">
              <Folder className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="h-1.5 w-18 rounded-sm bg-muted-foreground/25" />
            </div>
            <div className="ml-8 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="h-1.5 w-12 rounded-sm bg-muted-foreground/25" />
            </div>
          </div>

          {/* Miniatures + tags */}
          <div className="grid flex-1 grid-cols-3 gap-2">
            {[0, 1, 2].map((doc) => (
              <div key={doc} className="space-y-1">
                <div
                  className={cn(
                    "flex aspect-[3/4] items-center justify-center rounded-sm border bg-white shadow-sm",
                    doc === 0 ? "border-primary" : "border-border",
                  )}
                >
                  <div className="w-2/3 space-y-1">
                    <div className="h-0.5 w-full bg-zinc-300" />
                    <div className="h-0.5 w-4/5 bg-zinc-300" />
                    <div className="h-0.5 w-full bg-zinc-300" />
                  </div>
                </div>
                <span
                  className={cn(
                    "block h-1.5 w-3/4 rounded-full",
                    doc === 0 ? "bg-primary/50" : "bg-muted-foreground/25",
                  )}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}
