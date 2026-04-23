"use client";

import { useEffect, useState } from "react";
import { clientLogger } from "@/lib/client-logger";

/**
 * Hook qui génère les thumbnails client-side depuis un Blob PDF via pdfjs.
 *
 * Charge le document une fois, génère toutes les thumbnails en parallèle,
 * et retourne un map pageNumber (1-indexed) → dataUrl PNG.
 *
 * Sans auth requise (rendering 100% client-side), économise des aller-retours
 * serveur par rapport au chargement d'images via endpoint distant.
 */
export function usePageThumbnails(
  pdfFile: File | null,
  pageCount: number,
  options: { scale?: number } = {},
): Map<number, string> {
  const { scale = 0.18 } = options;
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    if (!pdfFile || pageCount === 0) return;
    let cancelled = false;

    (async () => {
      try {
        const arrayBuffer = await pdfFile.arrayBuffer();
        if (cancelled) return;

        const { PDFRenderer } = await import("@giga-pdf/canvas");
        const renderer = new PDFRenderer();
        await renderer.loadDocument(arrayBuffer);
        if (cancelled) {
          renderer.dispose();
          return;
        }

        // Generate thumbnails page-by-page (not parallel — pdfjs prefers serial
        // for memory reasons on large documents)
        const map = new Map<number, string>();
        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
          if (cancelled) break;
          try {
            const dataUrl = await renderer.renderPageToDataURL(pageNum, { scale });
            map.set(pageNum, dataUrl);
            // Incrémental update: l'UI voit les thumbnails apparaître une par une
            if (!cancelled) {
              setThumbnails(new Map(map));
            }
          } catch (err) {
            clientLogger.warn(`[useThumbnails] failed for page ${pageNum}:`, err);
          }
        }

        renderer.dispose();
      } catch (err) {
        clientLogger.error("[useThumbnails] rendering failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfFile, pageCount, scale]);

  return thumbnails;
}
