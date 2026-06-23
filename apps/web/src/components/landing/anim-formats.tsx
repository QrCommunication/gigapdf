"use client";

/** Formats pris en charge (import Office/OpenDocument/texte/web/image + sorties). */
const FORMATS = [
  ".docx",
  ".odt",
  ".xlsx",
  ".ods",
  ".pptx",
  ".odp",
  ".rtf",
  ".md",
  ".csv",
  ".html",
  ".epub",
  ".txt",
  ".pdf/a",
  ".png",
  ".jpeg",
];

/**
 * Micro-animation perpétuelle : marquee des extensions de fichiers.
 * Le contenu est dupliqué deux fois et translaté de -50% en boucle.
 * CSS keyframes uniquement (transform), figée par `prefers-reduced-motion`.
 */
export function AnimFormats() {
  const items = [...FORMATS, ...FORMATS];

  return (
    <div aria-hidden="true" className="relative overflow-hidden py-1">
      <div className="lp-anim-marquee flex w-max gap-2.5 pr-2.5">
        {items.map((format, index) => (
          <span
            key={`${format}-${index}`}
            className="whitespace-nowrap rounded-sm border border-border bg-muted/50 px-2.5 py-1 font-mono text-xs text-muted-foreground"
          >
            {format}
          </span>
        ))}
      </div>
    </div>
  );
}
