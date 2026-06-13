"use client";

import { useEffect, useRef } from "react";

/**
 * Règle graduée verticale fixe (côté gauche, desktop xl+ uniquement) qui
 * matérialise la progression de scroll façon table de montage d'imprimeur.
 * Mise à jour via requestAnimationFrame (throttlée), sans re-render React.
 */
export function ScrollRuler() {
  const progressRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let rafId = 0;

    const update = () => {
      rafId = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const progress =
        max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;

      if (progressRef.current) {
        progressRef.current.style.transform = `scaleY(${progress})`;
      }
      if (labelRef.current) {
        labelRef.current.textContent = `${String(Math.round(progress * 100)).padStart(3, "0")}%`;
      }
    };

    const requestUpdate = () => {
      if (rafId === 0) {
        rafId = requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });

    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (rafId !== 0) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-y-0 left-0 z-40 hidden w-10 select-none xl:block"
    >
      {/* Graduations */}
      <div className="lp-ruler-ticks absolute inset-y-0 right-2 w-3.5" />
      {/* Ligne de progression */}
      <div
        ref={progressRef}
        className="absolute inset-y-0 right-2 w-px origin-top bg-primary"
        style={{ transform: "scaleY(0)" }}
      />
      {/* Pourcentage de scroll */}
      <span
        ref={labelRef}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[10px] tabular-nums text-muted-foreground"
      >
        000%
      </span>
    </div>
  );
}
