"use client";

/**
 * Micro-animation perpétuelle : une ligne de scan balaie un faux document
 * scanné, dont certaines lignes apparaissent « reconnues » (teinte primary).
 * CSS keyframes uniquement (transform), figée par `prefers-reduced-motion`.
 */
export function AnimOcr() {
  return (
    <div
      aria-hidden="true"
      className="relative h-full min-h-40 overflow-hidden rounded-md border border-border bg-card"
    >
      {/* Faux document scanné */}
      <div className="absolute inset-x-5 inset-y-5 space-y-2">
        <div className="h-1.5 w-1/2 rounded-sm bg-muted-foreground/30" />
        <div className="h-1.5 w-full rounded-sm bg-primary/35" />
        <div className="h-1.5 w-11/12 rounded-sm bg-primary/35" />
        <div className="h-1.5 w-full rounded-sm bg-muted-foreground/25" />
        <div className="h-1.5 w-4/5 rounded-sm bg-muted-foreground/25" />
        <div className="h-1.5 w-full rounded-sm bg-muted-foreground/25" />
        <div className="h-1.5 w-2/3 rounded-sm bg-muted-foreground/25" />
        <div className="h-1.5 w-11/12 rounded-sm bg-muted-foreground/25" />
      </div>

      {/* Track de scan pleine hauteur : la ligne est portée par son bord bas */}
      <div className="lp-anim-ocr absolute inset-0">
        <div className="absolute inset-x-0 bottom-0 h-px bg-primary" />
        <div className="absolute inset-x-0 bottom-0 h-5 bg-primary/10" />
      </div>
    </div>
  );
}
