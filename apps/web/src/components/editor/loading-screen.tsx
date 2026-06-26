"use client";

import { useTranslations } from "next-intl";
import { Progress } from "@giga-pdf/ui";
import type { LoadPhase } from "@/hooks/use-document";

export interface LoadingScreenProps {
  /** Progression 0 → 100 (déjà bornée/monotone côté hook). */
  value: number;
  /** Phase courante du pipeline de chargement. */
  phase: LoadPhase;
  /** Pages dont les éléments ont été fusionnés (phase `elements`). */
  pagesParsed: number;
  /** Total de pages à fusionner (phase `elements`). */
  pagesTotal: number;
}

/**
 * Animation décorative : trois « pages » empilées qui défilent. Purement
 * visuelle (aria-hidden) ; figée sous prefers-reduced-motion via globals.css.
 */
function LoadingPagesAnimation() {
  return (
    <div className="gp-loading-stack" aria-hidden="true">
      <div className="gp-loading-page" />
      <div className="gp-loading-page" />
      <div className="gp-loading-page" />
    </div>
  );
}

/**
 * Écran de chargement de l'éditeur PDF : barre de progression synchronisée aux
 * jalons réels du chargement (connecting → analyzing → elements → building) +
 * animation de pages. Présentationnel — aucune logique, juste l'affichage de la
 * progression fournie par `useDocument().loadProgress`.
 */
export function LoadingScreen({
  value,
  phase,
  pagesParsed,
  pagesTotal,
}: LoadingScreenProps) {
  const t = useTranslations("editor");
  const pct = Math.round(value);
  // `idle` n'a pas de libellé dédié (phase transitoire avant tout chargement) :
  // on retombe sur `connecting` pour éviter une clé i18n manquante.
  const phaseKey = phase === "idle" ? "connecting" : phase;
  const label = t(`loadingScreen.${phaseKey}`);
  const showPages = phase === "elements" && pagesTotal > 0;

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <LoadingPagesAnimation />

        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {showPages && (
            <p className="text-xs text-muted-foreground">
              {t("loadingScreen.pages", { parsed: pagesParsed, total: pagesTotal })}
            </p>
          )}
        </div>

        <Progress value={pct} className="w-72" aria-label={t("loadingScreen.aria")} />

        <p className="text-xs tabular-nums text-muted-foreground">
          {t("loadingScreen.percent", { value: pct })}
        </p>

        {/* Statut accessible : annonce la phase + la valeur aux lecteurs d'écran. */}
        <span className="sr-only" aria-live="polite">
          {t("loadingScreen.srStatus", { phase: label, value: pct })}
        </span>
      </div>
    </div>
  );
}
