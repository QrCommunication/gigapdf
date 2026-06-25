"use client";

import React, { useState, useEffect, useCallback, useId } from "react";
import { useTranslations } from "next-intl";
import { downloadBlob } from "@giga-pdf/api";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Page-label numbering styles (ISO 32000-1 §12.4.2). Mirrors the SDK's
 * `PageLabelStyle` union; kept local so this client component never references
 * the engine package at runtime.
 */
const PAGE_LABEL_STYLES = [
  "decimal",
  "romanLower",
  "romanUpper",
  "alphaLower",
  "alphaUpper",
  "none",
] as const;

type PageLabelStyle = (typeof PAGE_LABEL_STYLES)[number];

/** One page-label range — mirrors the SDK's `PageLabelRange`. */
interface PageLabelRange {
  startPage: number;
  style: PageLabelStyle;
  prefix: string;
  startNumber: number;
}

/** A range row with a stable React key (never sent to the server). */
interface UiRange extends PageLabelRange {
  _id: string;
}

/** Shape returned by GET /api/pdf/page-labels. */
interface PageLabelsGetResult {
  ranges: PageLabelRange[];
  labels: string[];
  pageCount: number;
}

// First N pages shown in the live preview.
const PREVIEW_MAX_PAGES = 24;

// ─── Network helpers ──────────────────────────────────────────────────────────

/** Best-effort bearer header (cookie session still authenticates same-origin). */
function getAuthHeader(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response): Promise<string> {
  let message = `HTTP ${response.status}`;
  try {
    const json = (await response.json()) as { error?: string };
    if (json.error) message = json.error;
  } catch {
    // Non-JSON error body — keep the status-based message.
  }
  return message;
}

/** GET the current page labels for `file`. */
async function fetchPageLabels(file: File): Promise<PageLabelsGetResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("action", "get");

  const response = await fetch("/api/pdf/page-labels", {
    method: "POST",
    headers: getAuthHeader(),
    body: form,
  });
  if (!response.ok) throw new Error(await readError(response));

  const json = (await response.json()) as {
    success: boolean;
    data: PageLabelsGetResult;
  };
  return json.data;
}

/** POST a `set` operation and return the modified PDF as a Blob. */
async function postPageLabelsSet(
  file: File,
  ranges: PageLabelRange[],
): Promise<Blob> {
  const form = new FormData();
  form.append("file", file);
  form.append("action", "set");
  form.append("ranges", JSON.stringify(ranges));

  const response = await fetch("/api/pdf/page-labels", {
    method: "POST",
    headers: getAuthHeader(),
    body: form,
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.blob();
}

// ─── Label formatting (client-side preview) ───────────────────────────────────
// Mirrors the engine's numbering so the preview updates live as the user edits.
// The saved PDF remains the source of truth.

function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const table: ReadonlyArray<readonly [number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let rem = n;
  for (const [value, sym] of table) {
    while (rem >= value) {
      out += sym;
      rem -= value;
    }
  }
  return out;
}

/** Bijective base-26: 1→a, 26→z, 27→aa. */
function toAlpha(n: number): string {
  if (n <= 0) return String(n);
  let out = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    out = String.fromCharCode(97 + rem) + out;
    num = Math.floor((num - 1) / 26);
  }
  return out;
}

function formatNumber(style: PageLabelStyle, value: number): string {
  switch (style) {
    case "decimal":
      return String(value);
    case "romanLower":
      return toRoman(value);
    case "romanUpper":
      return toRoman(value).toUpperCase();
    case "alphaLower":
      return toAlpha(value);
    case "alphaUpper":
      return toAlpha(value).toUpperCase();
    case "none":
      return "";
  }
}

/**
 * Resolve the label for a 1-based `page` against `ranges`. The active range is
 * the one with the greatest `startPage <= page`; pages before the first range
 * (or when there are no ranges) fall back to the decimal page number — matching
 * the engine's `pageLabel()`.
 */
function resolveLabel(page: number, ranges: PageLabelRange[]): string {
  let active: PageLabelRange | null = null;
  for (const range of ranges) {
    if (
      range.startPage <= page &&
      (active === null || range.startPage > active.startPage)
    ) {
      active = range;
    }
  }
  if (!active) return String(page);
  const value = active.startNumber + (page - active.startPage);
  return active.prefix + formatNumber(active.style, value);
}

/** Strip the UI-only `_id` down to the wire `PageLabelRange` shape. */
function toPlainRanges(ranges: UiRange[]): PageLabelRange[] {
  return ranges.map((r) => ({
    startPage: r.startPage,
    style: r.style,
    prefix: r.prefix,
    startNumber: r.startNumber,
  }));
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PageLabelsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentFile: File | null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-medium text-muted-foreground mb-1"
    >
      {children}
    </label>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
    >
      <svg
        className="mt-0.5 h-4 w-4 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
          clipRule="evenodd"
        />
      </svg>
      <span>{message}</span>
    </div>
  );
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5 text-sm text-green-700 dark:text-green-400"
    >
      <svg
        className="h-4 w-4 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
          clipRule="evenodd"
        />
      </svg>
      <span>{message}</span>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
      <svg
        className="h-6 w-6 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <p className="text-sm">{label}</p>
    </div>
  );
}

interface RangeRowProps {
  index: number;
  range: UiRange;
  pageCount: number;
  styleOptions: ReadonlyArray<{ value: PageLabelStyle; label: string }>;
  disabled: boolean;
  onChange: (id: string, patch: Partial<PageLabelRange>) => void;
  onRemove: (id: string) => void;
}

function RangeRow({
  index,
  range,
  pageCount,
  styleOptions,
  disabled,
  onChange,
  onRemove,
}: RangeRowProps) {
  const t = useTranslations("editor.pageLabels");
  const baseId = `pl-range-${range._id}`;

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-foreground">
          {t("rangeN", { index: index + 1 })}
        </span>
        <button
          type="button"
          onClick={() => onRemove(range._id)}
          disabled={disabled}
          aria-label={t("removeRange", { index: index + 1 })}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor={`${baseId}-start`}>
            {t("fields.startPage")}
          </FieldLabel>
          <input
            id={`${baseId}-start`}
            type="number"
            min={1}
            max={pageCount || undefined}
            value={range.startPage}
            disabled={disabled}
            onChange={(e) =>
              onChange(range._id, {
                startPage: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
              })
            }
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div>
          <FieldLabel htmlFor={`${baseId}-style`}>
            {t("fields.style")}
          </FieldLabel>
          <select
            id={`${baseId}-style`}
            value={range.style}
            disabled={disabled}
            onChange={(e) =>
              onChange(range._id, { style: e.target.value as PageLabelStyle })
            }
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {styleOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel htmlFor={`${baseId}-prefix`}>
            {t("fields.prefix")}
          </FieldLabel>
          <input
            id={`${baseId}-prefix`}
            type="text"
            value={range.prefix}
            disabled={disabled}
            placeholder={t("placeholders.prefix")}
            onChange={(e) => onChange(range._id, { prefix: e.target.value })}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div>
          <FieldLabel htmlFor={`${baseId}-first`}>
            {t("fields.startNumber")}
          </FieldLabel>
          <input
            id={`${baseId}-first`}
            type="number"
            min={1}
            value={range.startNumber}
            disabled={disabled || range.style === "none"}
            onChange={(e) =>
              onChange(range._id, {
                startNumber: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
              })
            }
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}

interface PreviewProps {
  ranges: PageLabelRange[];
  pageCount: number;
}

function Preview({ ranges, pageCount }: PreviewProps) {
  const t = useTranslations("editor.pageLabels");
  const shown = Math.min(pageCount, PREVIEW_MAX_PAGES);
  const remaining = pageCount - shown;

  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        {t("preview.title")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: shown }, (_, i) => {
          const page = i + 1;
          return (
            <span
              key={page}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background border border-border text-xs"
              title={t("preview.pageTitle", { page })}
            >
              <span className="text-muted-foreground">{page}</span>
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
              <span className="font-medium text-foreground">
                {resolveLabel(page, ranges) || t("preview.emptyLabel")}
              </span>
            </span>
          );
        })}
      </div>
      {remaining > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("preview.more", { count: remaining })}
        </p>
      )}
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

/**
 * PageLabelsDialog — modal to view and edit the document's page-label ranges
 * (`/PageLabels`, ISO 32000-1 §12.4.2). Each range picks a numbering style
 * (decimal, roman, alpha or none), an optional prefix and a starting number;
 * the live preview resolves each page to its viewer-visible label. Applying the
 * change downloads a PDF with the updated page labels.
 */
export function PageLabelsDialog({
  isOpen,
  onClose,
  currentFile,
}: PageLabelsDialogProps) {
  const t = useTranslations("editor.pageLabels");
  const reactId = useId();

  const [ranges, setRanges] = useState<UiRange[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load the current labels whenever the dialog opens with a file.
  useEffect(() => {
    if (!isOpen || !currentFile) {
      setRanges([]);
      setPageCount(0);
      setLoadError(null);
      setError(null);
      setSuccess(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setError(null);
    setSuccess(false);

    fetchPageLabels(currentFile)
      .then((result) => {
        if (cancelled) return;
        setPageCount(result.pageCount);
        setRanges(
          result.ranges.map((r, i) => ({ ...r, _id: `${reactId}-${i}` })),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentFile]);

  const addRange = useCallback(() => {
    setRanges((prev) => {
      const nextStart = prev.length
        ? Math.min(
            Math.max(...prev.map((r) => r.startPage)) + 1,
            Math.max(pageCount, 1),
          )
        : 1;
      return [
        ...prev,
        {
          _id: `${reactId}-new-${Date.now()}-${prev.length}`,
          startPage: nextStart,
          style: "decimal",
          prefix: "",
          startNumber: 1,
        },
      ];
    });
  }, [pageCount, reactId]);

  const updateRange = useCallback(
    (id: string, patch: Partial<PageLabelRange>) => {
      setRanges((prev) =>
        prev.map((r) => (r._id === id ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const removeRange = useCallback((id: string) => {
    setRanges((prev) => prev.filter((r) => r._id !== id));
  }, []);

  const submit = useCallback(
    async (payloadRanges: PageLabelRange[]) => {
      if (!currentFile) {
        setError(t("noFileSelected"));
        return;
      }
      setError(null);
      setSuccess(false);
      setIsSaving(true);
      try {
        const blob = await postPageLabelsSet(currentFile, payloadRanges);
        const filename =
          currentFile.name.replace(/\.pdf$/i, "") + "_labels.pdf";
        downloadBlob(blob, filename);
        setSuccess(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("updateFailed"));
      } finally {
        setIsSaving(false);
      }
    },
    [currentFile, t],
  );

  const handleApply = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void submit(toPlainRanges(ranges));
    },
    [ranges, submit],
  );

  if (!isOpen) return null;

  const styleOptions = PAGE_LABEL_STYLES.map((value) => ({
    value,
    label: t(`styleOptions.${value}`),
  }));

  const plainRanges: PageLabelRange[] = toPlainRanges(ranges);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-labels-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-0">
          <div>
            <h2
              id="page-labels-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("title")}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="mt-0.5 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {!currentFile ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
              <svg
                className="h-8 w-8 opacity-40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p className="text-sm">{t("noFile")}</p>
            </div>
          ) : isLoading ? (
            <Spinner label={t("loading")} />
          ) : loadError ? (
            <ErrorBanner message={loadError} />
          ) : (
            <form onSubmit={handleApply} className="space-y-4">
              <p className="text-xs text-muted-foreground">
                {t("intro", { count: pageCount })}
              </p>

              {ranges.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-6 text-center">
                  <p className="text-sm text-muted-foreground">{t("empty")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {ranges.map((range, index) => (
                    <RangeRow
                      key={range._id}
                      index={index}
                      range={range}
                      pageCount={pageCount}
                      styleOptions={styleOptions}
                      disabled={isSaving}
                      onChange={updateRange}
                      onRemove={removeRange}
                    />
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={addRange}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {t("addRange")}
              </button>

              {pageCount > 0 && (
                <Preview ranges={plainRanges} pageCount={pageCount} />
              )}

              {error && <ErrorBanner message={error} />}
              {success && <SuccessBanner message={t("updateSuccess")} />}

              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void submit([])}
                  disabled={isSaving || ranges.length === 0}
                  className="text-sm font-medium text-muted-foreground hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("removeAll")}
                </button>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSaving && (
                    <svg
                      className="h-4 w-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  )}
                  {isSaving ? t("saving") : t("apply")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
