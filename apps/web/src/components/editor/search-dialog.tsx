"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Search, X, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { useSearchPdf } from "@giga-pdf/api";

export interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  /** Called when user clicks a hit — caller is expected to navigate to that page. */
  onGoToPage?: (pageNumber: number, hit: SearchHitDisplay) => void;
}

export interface SearchHitDisplay {
  pageNumber: number;
  matchIndex: number;
  /** PDF user-space bbox [x0, y0, x1, y1] for highlight overlay. */
  bbox: [number, number, number, number];
}

/**
 * SearchDialog — full-text search in the current PDF via the engine.
 *
 * The dialog stays open while the user navigates hits so they can iterate
 * (Prev/Next, clicking a hit, refining the query). Each hit click forwards
 * the bounding box to the parent so it can scroll the canvas to the match
 * and optionally draw a highlight overlay.
 */
export function SearchDialog({
  open,
  onClose,
  currentFile,
  onGoToPage,
}: SearchDialogProps) {
  const t = useTranslations("editor.search");
  const [needle, setNeedle] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useSearchPdf();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Reset when reopening with a different file.
  useEffect(() => {
    if (!open) {
      search.reset();
      setActiveIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentFile]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile || !needle.trim()) return;
    await search.mutateAsync({ file: currentFile, needle: needle.trim() });
    setActiveIndex(0);
  };

  const hits = search.data?.hits ?? [];

  const goTo = (i: number) => {
    if (hits.length === 0) return;
    const wrapped = ((i % hits.length) + hits.length) % hits.length;
    setActiveIndex(wrapped);
    const hit = hits[wrapped];
    if (hit && onGoToPage) {
      onGoToPage(hit.pageNumber, {
        pageNumber: hit.pageNumber,
        matchIndex: hit.matchIndex,
        bbox: hit.bbox,
      });
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-background shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={18} className="text-muted-foreground shrink-0" />
          <h2 id="search-dialog-title" className="sr-only">
            {t("title")}
          </h2>
          <form onSubmit={submit} className="flex-1">
            <input
              ref={inputRef}
              value={needle}
              onChange={(e) => setNeedle(e.target.value)}
              placeholder={t("placeholder")}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label={t("inputAria")}
            />
          </form>
          {hits.length > 0 && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {activeIndex + 1} / {hits.length}
            </span>
          )}
          {search.isPending && (
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          )}
          <button
            type="button"
            onClick={() => goTo(activeIndex - 1)}
            disabled={hits.length === 0}
            aria-label={t("previousResult")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            onClick={() => goTo(activeIndex + 1)}
            disabled={hits.length === 0}
            aria-label={t("nextResult")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-2 py-2 max-h-[60vh]">
          {search.isError && (
            <p className="px-3 py-4 text-sm text-destructive">
              {(search.error as Error)?.message ?? t("searchFailed")}
            </p>
          )}
          {!search.isPending &&
            search.isSuccess &&
            hits.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                {t("noResults", { needle })}
              </p>
            )}
          {hits.length > 0 && (
            <ul className="space-y-1">
              {hits.map((h, i) => (
                <li key={`${h.pageNumber}-${h.matchIndex}`}>
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      i === activeIndex
                        ? "bg-primary/10 text-foreground border border-primary/20"
                        : "hover:bg-muted text-foreground/80"
                    }`}
                  >
                    <span className="font-medium">{t("page", { pageNumber: h.pageNumber })}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      bbox {h.bbox.map((n) => n.toFixed(0)).join(", ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
          {t("hint")}
        </div>
      </div>
    </div>
  );
}
