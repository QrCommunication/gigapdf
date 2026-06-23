"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, CardHeader } from "@giga-pdf/ui";
import { ArrowUp, ArrowDown, RotateCw, Trash2 } from "lucide-react";

/**
 * page-organizer.tsx
 *
 * The visual page-organization grid and its page-operation logic, factored out
 * of the standalone `/organize-pages` tool so the EXACT same affordance can be
 * reused from the GED document menu ("Transformer › Organiser les pages") with
 * zero duplicated logic.
 *
 * Two pieces:
 *   - {@link usePageOrganizer}: a hook that owns the working page model (read
 *     the page count once from `/api/pdf/open`, then reorder / rotate / delete),
 *     and `buildOrganizedBlob()` which realizes the final state into a new PDF
 *     by REUSING the existing `/api/pdf/pages` operations — ONE `extract`
 *     (delete-dropped + reorder in a single pass) followed by an absolute
 *     `rotate` per page left at a non-zero angle.
 *   - {@link PageOrganizerBoard}: the presentational grid (one card per page,
 *     reorder with up/down arrows, rotate 0→90→180→270, delete).
 *
 * Each consumer renders its OWN chrome (dropzone + output-name for the
 * standalone tool; a Dialog + replace/download radio for the GED dialog) and
 * supplies the localized strings via the shared `organizePages` namespace.
 */

/** Absolute page rotation, in degrees. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * A page in the working model. `originalPageNumber` is the 1-based index in the
 * source PDF; `id` is stable so React keys survive reorders and deletions.
 */
export interface PageItem {
  id: string;
  originalPageNumber: number;
  rotation: Rotation;
}

let pageSeq = 0;
function nextPageId(): string {
  pageSeq = (pageSeq + 1) % Number.MAX_SAFE_INTEGER;
  return `pg-${Date.now().toString(36)}-${pageSeq}`;
}

/** Next rotation in the 0 → 90 → 180 → 270 → 0 cycle. */
function nextRotation(current: Rotation): Rotation {
  return ((current + 90) % 360) as Rotation;
}

/** What the page-organizer hook exposes to its host component. */
export interface PageOrganizer {
  /** Working page list; its order IS the output order. */
  pages: PageItem[];
  /** True while the page count is being read from the source PDF. */
  loading: boolean;
  /** Localized message when the source PDF could not be opened, else null. */
  loadError: string | null;
  /** Move the page at `index` up (-1) or down (+1); no-op at the boundaries. */
  movePage: (index: number, direction: -1 | 1) => void;
  /** Cycle the page's rotation 0 → 90 → 180 → 270 → 0. */
  rotatePage: (id: string) => void;
  /** Drop the page from the working model. */
  deletePage: (id: string) => void;
  /** True once at least one page is loaded. */
  hasPages: boolean;
  /**
   * Realize the current page model into a new PDF Blob via the `/api/pdf/pages`
   * operations. Throws on a failed operation (the caller surfaces the error).
   */
  buildOrganizedBlob: (outputName: string) => Promise<Blob>;
}

/**
 * Own the working page model for a single source PDF (`source`, a Blob/File of
 * the original document) plus the logic that turns it into an organized PDF.
 *
 * The page count is read once from `POST /api/pdf/open` (no extra client deps).
 * The caller decides when a source is available; passing `null` resets the
 * model (used by the standalone tool when the user clears the document).
 */
export function usePageOrganizer(source: Blob | null): PageOrganizer {
  const t = useTranslations("organizePages");

  const [pages, setPages] = useState<PageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Guard against a stale `/api/pdf/open` response overwriting a newer source.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    if (!source) {
      setPages([]);
      setLoadError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const form = new FormData();
        form.append("file", source, "document.pdf");
        // We only need the page count; skip the heavy extraction passes.
        form.append("extractText", "false");
        form.append("extractImages", "false");
        form.append("extractAnnotations", "false");
        form.append("extractFormFields", "false");

        const response = await fetch("/api/pdf/open", {
          method: "POST",
          body: form,
        });

        if (cancelled || requestId !== requestIdRef.current) return;

        if (!response.ok) {
          setLoadError(t("loadError"));
          setPages([]);
          return;
        }

        const data = (await response.json()) as {
          data?: { pageCount?: number };
        };
        if (cancelled || requestId !== requestIdRef.current) return;

        const pageCount = data.data?.pageCount ?? 0;
        if (pageCount < 1) {
          setLoadError(t("loadError"));
          setPages([]);
          return;
        }

        setPages(
          Array.from({ length: pageCount }, (_, i) => ({
            id: nextPageId(),
            originalPageNumber: i + 1,
            rotation: 0 as Rotation,
          })),
        );
      } catch {
        if (!cancelled && requestId === requestIdRef.current) {
          setLoadError(t("loadError"));
          setPages([]);
        }
      } finally {
        if (!cancelled && requestId === requestIdRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, t]);

  const movePage = useCallback((index: number, direction: -1 | 1) => {
    setPages((prev) => {
      const target = index + direction;
      if (index < 0 || index >= prev.length) return prev;
      if (target < 0 || target >= prev.length) return prev;
      // Swap adjacent items; both lookups checked under noUncheckedIndexedAccess.
      const next = [...prev];
      const a = next[index];
      const b = next[target];
      if (!a || !b) return prev;
      next[index] = b;
      next[target] = a;
      return next;
    });
  }, []);

  const rotatePage = useCallback((id: string) => {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rotation: nextRotation(p.rotation) } : p)),
    );
  }, []);

  const deletePage = useCallback((id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const buildOrganizedBlob = useCallback(
    async (outputName: string): Promise<Blob> => {
      if (!source) throw new Error(t("loadError"));
      if (pages.length === 0) throw new Error(t("allDeletedError"));

      const failMessage = async (res: Response): Promise<string> => {
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) return data.error;
        } catch {
          /* keep generic */
        }
        return t("toastError");
      };

      // 1) One `extract` pass: keep the chosen pages in the user's final order.
      //    This deletes dropped pages AND reorders in a single round-trip; the
      //    result is renumbered 1..N in that order.
      const extractForm = new FormData();
      extractForm.append("file", source, outputName);
      extractForm.append("operation", "extract");
      extractForm.append(
        "params",
        JSON.stringify({ pageNumbers: pages.map((p) => p.originalPageNumber) }),
      );

      const extractRes = await fetch("/api/pdf/pages", {
        method: "POST",
        body: extractForm,
      });
      if (!extractRes.ok) throw new Error(await failMessage(extractRes));
      let workingBlob = await extractRes.blob();

      // 2) Absolute rotation per page (skip pages left at 0°). The result of one
      //    request feeds the next request's `file`, so rotations compose safely.
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (!page || page.rotation === 0) continue;
        const rotateForm = new FormData();
        rotateForm.append("file", workingBlob, outputName);
        rotateForm.append("operation", "rotate");
        rotateForm.append(
          "params",
          JSON.stringify({ pageNumber: i + 1, degrees: page.rotation, mode: "set" }),
        );

        const rotateRes = await fetch("/api/pdf/pages", {
          method: "POST",
          body: rotateForm,
        });
        if (!rotateRes.ok) throw new Error(await failMessage(rotateRes));
        workingBlob = await rotateRes.blob();
      }

      return workingBlob;
    },
    [source, pages, t],
  );

  return {
    pages,
    loading,
    loadError,
    movePage,
    rotatePage,
    deletePage,
    hasPages: pages.length > 0,
    buildOrganizedBlob,
  };
}

export interface PageOrganizerBoardProps {
  organizer: PageOrganizer;
  /** Disable every per-page control (e.g. while applying). */
  disabled?: boolean;
  /** Optional header rendered above the page list (file name, size, reset…). */
  header?: React.ReactNode;
}

/**
 * Presentational page grid: one card per page, in output order, with up/down
 * reorder, a rotate-90° cycle, and delete. Reads everything from {@link organizer}.
 */
export function PageOrganizerBoard({
  organizer,
  disabled = false,
  header,
}: PageOrganizerBoardProps) {
  const t = useTranslations("organizePages");
  const { pages, movePage, rotatePage, deletePage } = organizer;

  return (
    <Card>
      {header && <CardHeader>{header}</CardHeader>}
      <CardContent className="space-y-2 pt-6">
        <ul className="space-y-2">
          {pages.map((page, index) => (
            <li
              key={page.id}
              className="flex items-center gap-3 rounded-md border bg-background px-3 py-2"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted text-sm font-semibold text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {t("pageLabel", { number: page.originalPageNumber })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("rotationBadge", { degrees: page.rotation })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => movePage(index, -1)}
                  disabled={index === 0 || disabled}
                  title={t("moveUp")}
                  aria-label={t("moveUpPage", { number: index + 1 })}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => movePage(index, 1)}
                  disabled={index === pages.length - 1 || disabled}
                  title={t("moveDown")}
                  aria-label={t("moveDownPage", { number: index + 1 })}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => rotatePage(page.id)}
                  disabled={disabled}
                  title={t("rotatePage")}
                  aria-label={t("rotatePageNumbered", { number: index + 1 })}
                >
                  <RotateCw className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => deletePage(page.id)}
                  disabled={disabled}
                  title={t("deletePage")}
                  aria-label={t("deletePageNumbered", { number: index + 1 })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
