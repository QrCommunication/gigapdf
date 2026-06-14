import { cn } from "@giga-pdf/ui/lib/utils";

/**
 * Illustration de la page Open Source, dans l'esthétique « atelier d'impression »
 * du reste du site : fenêtre de code (la base de code publique), un graphe git
 * (les contributions), un sceau AGPL et des repères de coupe. Purement décoratif
 * (aria-hidden). Couleurs liées au thème via les utilitaires Tailwind
 * `stroke-*` / `fill-*` → s'adapte automatiquement clair / sombre.
 */
export function OpenSourceIllustration({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      aria-hidden="true"
      viewBox="0 0 560 460"
      className={cn("h-auto w-full", className)}
      fill="none"
    >
      {/* Règle verticale + ticks (rappel du ScrollRuler) */}
      <g className="stroke-border">
        <line x1="22" y1="40" x2="22" y2="420" strokeWidth="1" />
        {Array.from({ length: 20 }).map((_, i) => (
          <line
            key={i}
            x1="22"
            y1={48 + i * 19}
            x2={i % 5 === 0 ? 36 : 29}
            y2={48 + i * 19}
            strokeWidth="1"
          />
        ))}
      </g>

      {/* Grille de points discrète en fond */}
      <g className="fill-border">
        {Array.from({ length: 6 }).map((_, r) =>
          Array.from({ length: 9 }).map((_, c) => (
            <circle key={`${r}-${c}`} cx={70 + c * 52} cy={60 + r * 64} r="1" />
          )),
        )}
      </g>

      {/* ── Carte principale : fenêtre de code (source publique) ───────────── */}
      <g>
        {/* Repères de coupe autour de la carte */}
        <g className="stroke-foreground/40">
          <line x1="96" y1="78" x2="110" y2="78" strokeWidth="1" />
          <line x1="96" y1="78" x2="96" y2="92" strokeWidth="1" />
          <line x1="446" y1="78" x2="432" y2="78" strokeWidth="1" />
          <line x1="446" y1="78" x2="446" y2="92" strokeWidth="1" />
          <line x1="96" y1="350" x2="110" y2="350" strokeWidth="1" />
          <line x1="96" y1="350" x2="96" y2="336" strokeWidth="1" />
          <line x1="446" y1="350" x2="432" y2="350" strokeWidth="1" />
          <line x1="446" y1="350" x2="446" y2="336" strokeWidth="1" />
        </g>

        <rect
          x="110"
          y="92"
          width="322"
          height="232"
          rx="10"
          className="fill-background stroke-border"
          strokeWidth="1.5"
        />
        {/* Barre de titre */}
        <path
          d="M110 102 a10 10 0 0 1 10-10 h302 a10 10 0 0 1 10 10 v22 h-322 z"
          className="fill-muted"
        />
        <g className="fill-muted-foreground/60">
          <circle cx="128" cy="108" r="3.5" />
          <circle cx="142" cy="108" r="3.5" />
          <circle cx="156" cy="108" r="3.5" />
        </g>
        <rect x="246" y="103" width="92" height="10" rx="3" className="fill-muted-foreground/25" />

        {/* Lignes de code */}
        <g strokeWidth="6" strokeLinecap="round">
          <line x1="134" y1="150" x2="208" y2="150" className="stroke-primary" />
          <line x1="218" y1="150" x2="300" y2="150" className="stroke-muted-foreground/35" />
          <line x1="150" y1="172" x2="232" y2="172" className="stroke-muted-foreground/35" />
          <line x1="242" y1="172" x2="288" y2="172" className="stroke-primary/60" />
          <line x1="150" y1="194" x2="206" y2="194" className="stroke-muted-foreground/35" />
          <line x1="134" y1="216" x2="180" y2="216" className="stroke-primary" />
          <line x1="190" y1="216" x2="320" y2="216" className="stroke-muted-foreground/35" />
          <line x1="150" y1="238" x2="262" y2="238" className="stroke-muted-foreground/35" />
          <line x1="134" y1="260" x2="196" y2="260" className="stroke-muted-foreground/35" />
        </g>
        {/* tag </> en mono dessiné */}
        <text
          x="330"
          y="290"
          className="fill-primary font-mono"
          fontSize="22"
          fontWeight="700"
        >
          &lt;/&gt;
        </text>
      </g>

      {/* ── Graphe git (contributions) en bas à gauche ────────────────────── */}
      <g transform="translate(150 332)">
        <path
          d="M0 0 V64 M0 28 q0 16 26 16 H42"
          className="stroke-primary"
          strokeWidth="2"
          fill="none"
        />
        <circle cx="0" cy="0" r="6" className="fill-background stroke-primary" strokeWidth="2" />
        <circle cx="0" cy="32" r="6" className="fill-background stroke-primary" strokeWidth="2" />
        <circle cx="0" cy="64" r="6" className="fill-primary" />
        <circle cx="48" cy="44" r="6" className="fill-background stroke-primary" strokeWidth="2" />
      </g>

      {/* ── Sceau AGPL en haut à droite ──────────────────────────────────── */}
      <g transform="translate(470 96) rotate(-8)">
        <circle r="48" className="fill-background stroke-primary" strokeWidth="2" />
        <circle r="40" className="stroke-primary/40" strokeWidth="1" fill="none" />
        <text
          x="0"
          y="-4"
          textAnchor="middle"
          className="fill-primary font-display"
          fontSize="22"
          fontWeight="800"
        >
          AGPL
        </text>
        <text
          x="0"
          y="18"
          textAnchor="middle"
          className="fill-muted-foreground font-mono"
          fontSize="11"
          letterSpacing="2"
        >
          3.0
        </text>
      </g>

      {/* ── Nœuds communauté (contributeurs) en bas à droite ──────────────── */}
      <g transform="translate(396 332)">
        <g className="stroke-border" strokeWidth="1.5">
          <line x1="0" y1="0" x2="56" y2="-18" />
          <line x1="0" y1="0" x2="48" y2="36" />
          <line x1="56" y1="-18" x2="48" y2="36" />
          <line x1="0" y1="0" x2="-16" y2="40" />
        </g>
        <g className="fill-primary">
          <circle cx="0" cy="0" r="9" />
          <circle cx="56" cy="-18" r="7" className="fill-background stroke-primary" strokeWidth="2" />
          <circle cx="48" cy="36" r="7" className="fill-background stroke-primary" strokeWidth="2" />
          <circle cx="-16" cy="40" r="6" className="fill-background stroke-primary" strokeWidth="2" />
        </g>
      </g>
    </svg>
  );
}
