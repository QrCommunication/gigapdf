"use client";

interface AnimCompressionProps {
  /** Taille avant compression, ex. « 24,8 Mo ». */
  before: string;
  /** Taille après compression, ex. « 3,1 Mo ». */
  after: string;
}

/**
 * Micro-animation perpétuelle : la jauge de taille de fichier oscille entre
 * « avant » et « après » compression. CSS keyframes uniquement (transform
 * scaleX), figée par `prefers-reduced-motion`.
 */
export function AnimCompression({ before, after }: AnimCompressionProps) {
  return (
    <div aria-hidden="true" className="space-y-2">
      <div className="flex items-center justify-between font-mono text-[10px] tabular-nums">
        <span className="text-muted-foreground line-through decoration-muted-foreground/60">
          {before}
        </span>
        <span className="font-semibold text-primary">{after}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-sm border border-border bg-muted/60">
        <div className="lp-anim-gauge absolute inset-y-0 left-0 w-full bg-primary/70" />
      </div>
      {/* Graduations sous la jauge, façon règle */}
      <div className="flex justify-between">
        {Array.from({ length: 11 }).map((_, index) => (
          <span
            key={index}
            className={
              index % 5 === 0
                ? "h-1.5 w-px bg-muted-foreground/50"
                : "h-1 w-px bg-muted-foreground/25"
            }
          />
        ))}
      </div>
    </div>
  );
}
