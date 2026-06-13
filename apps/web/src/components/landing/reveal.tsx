"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@giga-pdf/ui";

interface RevealProps {
  children: ReactNode;
  /** Délai d'apparition en ms (stagger 50ms recommandé). */
  delay?: number;
  className?: string;
}

/**
 * Reveal à l'entrée dans le viewport (IntersectionObserver).
 * Durée ≤ 300ms, ease-out custom — voir `.lp-reveal` dans globals.css.
 * `prefers-reduced-motion` : contenu affiché immédiatement, sans transition.
 */
export function Reveal({ children, delay = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      element.classList.add("lp-visible");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            element.classList.add("lp-visible");
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("lp-reveal", className)}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
