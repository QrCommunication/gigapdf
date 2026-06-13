import { cn } from "@giga-pdf/ui";

/**
 * Repères de coupe d'imprimerie (crop marks) : 8 traits fins positionnés
 * à l'extérieur des 4 coins du parent (qui doit être `relative` et ne pas
 * masquer son overflow). Purement décoratif.
 */
export function CropMarks({ className }: { className?: string }) {
  const mark = "absolute bg-foreground/30 dark:bg-foreground/40";

  return (
    <span aria-hidden="true" className={cn("pointer-events-none", className)}>
      {/* Coin haut-gauche */}
      <span className={cn(mark, "-left-5 top-0 h-px w-3.5")} />
      <span className={cn(mark, "-top-5 left-0 h-3.5 w-px")} />
      {/* Coin haut-droit */}
      <span className={cn(mark, "-right-5 top-0 h-px w-3.5")} />
      <span className={cn(mark, "-top-5 right-0 h-3.5 w-px")} />
      {/* Coin bas-gauche */}
      <span className={cn(mark, "-left-5 bottom-0 h-px w-3.5")} />
      <span className={cn(mark, "-bottom-5 left-0 h-3.5 w-px")} />
      {/* Coin bas-droit */}
      <span className={cn(mark, "-right-5 bottom-0 h-px w-3.5")} />
      <span className={cn(mark, "-bottom-5 right-0 h-3.5 w-px")} />
    </span>
  );
}
