"use client";

import { MousePointer2 } from "lucide-react";

interface AnimCollaborationProps {
  labelA: string;
  labelB: string;
}

/**
 * Micro-animation perpétuelle : deux curseurs de collaborateurs se déplacent
 * en boucle sur un faux document. CSS keyframes uniquement (transform),
 * figée par `prefers-reduced-motion` (voir globals.css).
 */
export function AnimCollaboration({ labelA, labelB }: AnimCollaborationProps) {
  return (
    <div
      aria-hidden="true"
      className="relative h-full min-h-44 w-full overflow-hidden rounded-md border border-border bg-muted/40"
    >
      {/* Faux document */}
      <div className="absolute inset-x-6 top-6 space-y-2.5">
        <div className="h-2 w-2/5 rounded-sm bg-muted-foreground/30" />
        <div className="h-1.5 w-full rounded-sm bg-muted-foreground/20" />
        <div className="h-1.5 w-11/12 rounded-sm bg-muted-foreground/20" />
        <div className="h-1.5 w-full rounded-sm bg-muted-foreground/20" />
        <div className="h-1.5 w-3/4 rounded-sm bg-muted-foreground/20" />
        <div className="h-1.5 w-full rounded-sm bg-muted-foreground/20" />
        <div className="h-1.5 w-5/6 rounded-sm bg-muted-foreground/20" />
      </div>

      {/* Curseur A — accent emerald */}
      <div className="lp-anim-cursor-a absolute inset-0">
        <span className="absolute left-0 top-0 inline-flex items-start">
          <MousePointer2 className="h-4 w-4 fill-primary stroke-primary" />
          <span className="ml-1 mt-2.5 whitespace-nowrap rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide text-primary-foreground">
            {labelA}
          </span>
        </span>
      </div>

      {/* Curseur B — neutre zinc */}
      <div className="lp-anim-cursor-b absolute inset-0">
        <span className="absolute left-0 top-0 inline-flex items-start">
          <MousePointer2 className="h-4 w-4 fill-foreground stroke-foreground" />
          <span className="ml-1 mt-2.5 whitespace-nowrap rounded-sm bg-foreground px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide text-background">
            {labelB}
          </span>
        </span>
      </div>
    </div>
  );
}
