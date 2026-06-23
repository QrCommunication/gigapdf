import { cn } from "@giga-pdf/ui/lib/utils";

/**
 * Repères de coupe d'imprimerie (crop marks) : 8 traits fins positionnés
 * à l'extérieur des 4 coins du parent (qui doit être `relative` et ne pas
 * masquer son overflow). Purement décoratif.
 *
 * Masqués sous le breakpoint `sm` : leurs décalages négatifs (`-left-5`/
 * `-right-5`) débordent du viewport sur mobile (le contenu y est déjà collé
 * aux bords après le padding du conteneur) et créent une bande vide
 * horizontale. Ils n'ont de sens visuel que sur les mises en page larges.
 */
export function CropMarks({ className }: { className?: string }) {
  const mark = "absolute bg-foreground/30 dark:bg-foreground/40";

  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none hidden sm:block", className)}
    >
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
