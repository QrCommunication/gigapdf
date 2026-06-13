"use client";

import { Check } from "lucide-react";

interface AnimSignatureProps {
  /** Texte du tampon, ex. « SIGNÉ » / "SIGNED". */
  stampText: string;
}

/**
 * Micro-animation perpétuelle : un tampon « SIGNÉ » s'appose sur un bas de
 * page (apposition, tenue, disparition). CSS keyframes uniquement
 * (transform/opacity), figée par `prefers-reduced-motion`.
 */
export function AnimSignature({ stampText }: AnimSignatureProps) {
  return (
    <div
      aria-hidden="true"
      className="relative flex h-full min-h-40 items-center justify-center overflow-hidden rounded-md border border-border bg-card"
    >
      {/* Bas de page : cartouche de signature */}
      <div className="absolute inset-x-6 bottom-6 space-y-2">
        <div className="h-1.5 w-2/3 rounded-sm bg-muted-foreground/20" />
        <div className="h-px w-full bg-border" />
        <div className="h-1.5 w-1/3 rounded-sm bg-muted-foreground/20" />
      </div>

      {/* Tampon */}
      <span className="lp-anim-stamp inline-flex -translate-y-2 items-center gap-1.5 rounded-sm border-2 border-primary px-3 py-1.5 font-mono text-sm font-bold uppercase tracking-[0.2em] text-primary">
        {stampText}
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    </div>
  );
}
