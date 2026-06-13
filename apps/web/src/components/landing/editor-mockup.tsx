"use client";

import { useTranslations } from "next-intl";
import {
  Droplets,
  Image as ImageIcon,
  PenLine,
  Square,
  Stamp,
  Type,
} from "lucide-react";
import { cn } from "@giga-pdf/ui/lib/utils";
import { CropMarks } from "./crop-marks";

const TOOLBAR_ICONS = [Type, ImageIcon, Square, PenLine, Stamp, Droplets];

/**
 * Mockup de l'éditeur GigaPDF en composition CSS pure (aucune image bitmap) :
 * fenêtre avec barre de titre, barre d'outils, vignettes, canvas A4 avec bloc
 * de texte sélectionné, panneau de propriétés et barre d'état. Légèrement
 * incliné, encadré de repères de coupe façon épreuve d'imprimerie.
 */
export function EditorMockup() {
  const t = useTranslations("landing.hero.mockup");

  return (
    <div className="relative rotate-[1.5deg]" role="img" aria-label={t("ariaLabel")}>
      <CropMarks />

      <div className="overflow-hidden rounded-md border border-border bg-card shadow-xl shadow-foreground/5">
        {/* Barre de titre */}
        <div className="flex h-9 items-center justify-between border-b border-border bg-muted/40 px-3">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs text-foreground">
              {t("filename")}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {t("saved")}
            </span>
          </div>
          {/* Présence : 2 collaborateurs */}
          <div className="flex -space-x-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-primary/15 font-mono text-[8px] font-semibold text-primary">
              RL
            </span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-secondary font-mono text-[8px] font-semibold text-secondary-foreground">
              CM
            </span>
          </div>
        </div>

        {/* Barre d'outils */}
        <div className="flex h-10 items-center gap-1 border-b border-border px-2">
          {TOOLBAR_ICONS.map((Icon, index) => (
            <span
              key={index}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-sm",
                index === 0
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
          ))}
          <span className="mx-1.5 h-5 w-px bg-border" />
          <span className="h-5 w-16 rounded-sm border border-border bg-muted/50" />
          <span className="h-5 w-8 rounded-sm border border-border bg-muted/50" />
        </div>

        {/* Corps : vignettes | canvas | propriétés */}
        <div className="grid grid-cols-[2.75rem_1fr] sm:grid-cols-[2.75rem_1fr_7rem]">
          {/* Vignettes de pages */}
          <div className="space-y-1.5 border-r border-border p-1.5">
            {[1, 2, 3].map((page) => (
              <div
                key={page}
                className={cn(
                  "flex aspect-[3/4] items-end justify-end rounded-sm border bg-background p-0.5",
                  page === 1 ? "border-primary" : "border-border",
                )}
              >
                <span className="font-mono text-[7px] leading-none text-muted-foreground">
                  {page}
                </span>
              </div>
            ))}
          </div>

          {/* Canvas */}
          <div className="flex justify-center bg-muted/50 px-4 py-5 sm:px-6">
            <div className="w-full max-w-60 space-y-2 bg-white p-4 shadow-sm">
              <div className="h-2.5 w-3/5 rounded-sm bg-zinc-800/85" />
              <div className="h-px w-full bg-zinc-200" />
              <div className="h-1.5 w-full rounded-sm bg-zinc-300" />
              <div className="h-1.5 w-11/12 rounded-sm bg-zinc-300" />
              <div className="h-1.5 w-4/5 rounded-sm bg-zinc-300" />

              {/* Bloc de texte sélectionné, poignées + caret */}
              <div className="relative my-2.5 rounded-[2px] bg-primary/5 p-2 ring-1 ring-primary">
                <span className="absolute -left-1 -top-1 h-1.5 w-1.5 border border-primary bg-white" />
                <span className="absolute -right-1 -top-1 h-1.5 w-1.5 border border-primary bg-white" />
                <span className="absolute -bottom-1 -left-1 h-1.5 w-1.5 border border-primary bg-white" />
                <span className="absolute -bottom-1 -right-1 h-1.5 w-1.5 border border-primary bg-white" />
                <div className="h-1.5 w-full rounded-sm bg-zinc-400" />
                <div className="mt-1.5 flex items-center gap-1">
                  <div className="h-1.5 w-2/3 rounded-sm bg-zinc-400" />
                  <span className="h-2.5 w-px animate-blink border-r border-primary" />
                </div>
              </div>

              <div className="h-1.5 w-full rounded-sm bg-zinc-300" />
              <div className="h-1.5 w-10/12 rounded-sm bg-zinc-300" />
              <div className="h-1.5 w-full rounded-sm bg-zinc-300" />
              <div className="h-1.5 w-1/2 rounded-sm bg-zinc-300" />
            </div>
          </div>

          {/* Panneau de propriétés */}
          <div className="hidden space-y-2.5 border-l border-border p-2.5 sm:block">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              {t("panel")}
            </p>
            {[1, 2, 3].map((field) => (
              <div key={field} className="space-y-1">
                <div className="h-1.5 w-9 rounded-sm bg-muted-foreground/25" />
                <div className="h-5 rounded-sm border border-border bg-muted/50" />
              </div>
            ))}
            <div className="flex gap-1 pt-0.5">
              <span className="h-3.5 w-3.5 rounded-sm border border-primary bg-primary/80" />
              <span className="h-3.5 w-3.5 rounded-sm border border-border bg-zinc-800" />
              <span className="h-3.5 w-3.5 rounded-sm border border-border bg-zinc-400" />
              <span className="h-3.5 w-3.5 rounded-sm border border-border bg-white" />
            </div>
          </div>
        </div>

        {/* Barre d'état */}
        <div className="flex h-7 items-center justify-between border-t border-border px-3 font-mono text-[10px] text-muted-foreground">
          <span>A4 · 100 %</span>
          <span>{t("pageIndicator")}</span>
        </div>
      </div>
    </div>
  );
}
