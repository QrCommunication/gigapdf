"use client";

import { useEffect, useRef } from "react";
import { useMakeEditableOcrPdf, useIsOcrAvailable } from "@giga-pdf/api";
import type { PageObject, Element } from "@giga-pdf/types";
import { clientLogger } from "@/lib/client-logger";

const AUTO_OCR_DISABLED_KEY = "gigapdf-auto-ocr-disabled";

/**
 * Returns true when the user has opted out of automatic OCR for image-only PDFs.
 * Reads from localStorage; safe to call during SSR (returns false).
 */
function isAutoOcrDisabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(AUTO_OCR_DISABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Persist the user's opt-out preference for automatic OCR.
 */
export function setAutoOcrDisabled(disabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (disabled) {
      localStorage.setItem(AUTO_OCR_DISABLED_KEY, "true");
    } else {
      localStorage.removeItem(AUTO_OCR_DISABLED_KEY);
    }
  } catch {
    // localStorage unavailable (private browsing, quota exceeded) — silent no-op.
  }
}

/**
 * Returns true when every page in the document contains zero text elements,
 * indicating a scanned / image-only PDF that would benefit from OCR.
 * Mixed documents (at least one page with text) return false to avoid
 * auto-triggering on partially-scanned files.
 */
function isImageOnlyDocument(pages: PageObject[]): boolean {
  if (pages.length === 0) return false;
  return pages.every((page) => {
    const textElements = page.elements.filter(
      (el: Element) => el.type === "text" && (el.content ?? "").trim().length > 0,
    );
    return textElements.length === 0;
  });
}

export interface UseAutoOcrOptions {
  /** Whether the initial document load has completed. */
  loading: boolean;
  /** Parsed pages from useDocument (available after load completes). */
  pages: PageObject[];
  /** The current PDF file backing the editor (fed to makeEditableOcrPdf). */
  currentFile: File | null;
  /**
   * Called with the OCR'd blob so the editor can adopt it as the live
   * document (same contract as OcrDialog.onApplied).
   */
  onApplied: (blob: Blob) => void;
  /**
   * Optional toast/notification bridge. When provided, the hook calls
   * `onNotify("start")` before OCR begins and `onNotify("complete")` after
   * success, or `onNotify("error", message)` on failure. The host component
   * maps these to Ant Design `message.info` / `message.success` / `message.error`.
   */
  onNotify?: (event: "start" | "complete" | "error", detail?: string) => void;
}

/**
 * Post-parse hook that automatically runs editable OCR on image-only PDFs.
 *
 * Trigger conditions (ALL must be met):
 *   - Initial load has completed (`loading === false`)
 *   - Every page has zero text elements (image-only document)
 *   - The OCR service is available (probed via useIsOcrAvailable)
 *   - The user has not opted out via localStorage (`gigapdf-auto-ocr-disabled`)
 *   - A currentFile is available to feed to the OCR pipeline
 *
 * The hook fires at most once per document identity (tracked by ref). Re-renders
 * caused by state updates during the OCR flow do not re-trigger it. Failures are
 * logged and surfaced via onNotify but never throw — the manual OcrDialog remains
 * the fallback.
 */
export function useAutoOcr({
  loading,
  pages,
  currentFile,
  onApplied,
  onNotify,
}: UseAutoOcrOptions): void {
  const makeEditable = useMakeEditableOcrPdf();
  const availabilityCheck = useIsOcrAvailable();

  // Track whether auto-OCR has already been attempted for this document load
  // cycle. Reset when pages identity changes (new document loaded).
  const attemptedRef = useRef(false);
  const pagesIdentityRef = useRef(pages);

  useEffect(() => {
    if (pages !== pagesIdentityRef.current) {
      pagesIdentityRef.current = pages;
      attemptedRef.current = false;
    }
  }, [pages]);

  useEffect(() => {
    // Gate: only run after initial load completes with pages available.
    if (loading || pages.length === 0 || !currentFile) return;
    if (attemptedRef.current) return;
    if (isAutoOcrDisabled()) return;
    if (!isImageOnlyDocument(pages)) return;

    let cancelled = false;
    attemptedRef.current = true;

    (async () => {
      try {
        const available = await availabilityCheck.mutateAsync();
        if (cancelled || !available) {
          if (!available) {
            clientLogger.debug("[useAutoOcr] OCR service unavailable — skipping auto-trigger");
          }
          return;
        }

        clientLogger.info("[useAutoOcr] Image-only document detected — triggering editable OCR", {
          pageCount: pages.length,
        });
        onNotify?.("start");

        const result = await makeEditable.mutateAsync({
          file: currentFile,
          options: { dpi: 144 },
        });

        if (cancelled) return;

        clientLogger.info("[useAutoOcr] Editable OCR complete", {
          pagesProcessed: result.pagesProcessed,
          wordsAdded: result.wordsAdded,
        });
        onNotify?.("complete");
        onApplied(result.blob);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        clientLogger.warn("[useAutoOcr] Auto-OCR failed — manual dialog remains available", err);
        onNotify?.("error", message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pages, currentFile]);
}