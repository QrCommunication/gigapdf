import { cn } from "@giga-pdf/ui/lib/utils";

interface SectionHeadingProps {
  /** Numéro façon cahier d'impression : "01", "02"… */
  number: string;
  /** Étiquette mono uppercase : "ÉDITION", "COLLABORATION"… */
  label: string;
  title: string;
  description?: string;
  className?: string;
}

/**
 * Tête de section numérotée façon cahier d'impression :
 * `01 ──── ÉDITION` puis titre display et description.
 */
export function SectionHeading({
  number,
  label,
  title,
  description,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("max-w-xl", className)}>
      <div className="mb-5 flex items-center gap-4">
        <span className="font-mono text-sm font-medium tabular-nums text-primary">
          {number}
        </span>
        <span aria-hidden="true" className="lp-rule w-10 shrink-0" />
        <span className="lp-label">{label}</span>
      </div>
      <h2 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}
