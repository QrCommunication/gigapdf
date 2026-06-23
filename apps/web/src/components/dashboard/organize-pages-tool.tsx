"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  useToast,
} from "@giga-pdf/ui";
import {
  UploadCloud,
  FilePlus2,
  Loader2,
  ArrowUp,
  ArrowDown,
  RotateCw,
  Trash2,
  FileText,
  Wand2,
} from "lucide-react";
import { triggerBlobDownload } from "./blob-download";
import { clientLogger } from "@/lib/client-logger";

/**
 * Organize Pages tool — open a PDF, then reorder, rotate (per page), and delete
 * its pages on a list of cards, and apply everything in one go to download a new
 * PDF. A genuine page-organization workflow (NOT an alias of extract-pages):
 *
 * - The page count is read once from `POST /api/pdf/open` (no extra client deps).
 * - Reorder uses up/down arrows (same affordance as the universal-merge tool).
 * - Rotation cycles 0 → 90 → 180 → 270 per page and is written absolutely.
 * - "Apply" realizes the final state through the existing `/api/pdf/pages`
 *   operations: ONE `extract` (delete-dropped + reorder in a single pass),
 *   followed by an absolute `rotate` per page whose target rotation is non-zero.
 *
 * Self-contained client organism: owns the upload, the page model, the apply
 * state, and the download. Surfaces every outcome (success AND error) through
 * the global toaster, as mandated project-wide for any server action.
 */

/** Single-file backend cap (250 MB) mirrored for instant client feedback. */
const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024;

/** Accept hint for the native picker — PDF only. */
const ACCEPT = ".pdf,application/pdf";

/** Absolute page rotation, in degrees. */
type Rotation = 0 | 90 | 180 | 270;

/**
 * A page in the working model. `originalPageNumber` is the 1-based index in the
 * uploaded PDF; `id` is stable so React keys survive reorders and deletions.
 */
interface PageItem {
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
  return (((current + 90) % 360) as Rotation);
}

/** Human-readable size (KB/MB) without external deps. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function OrganizePagesTool() {
  const t = useTranslations("organizePages");
  const { toast } = useToast();

  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [outputName, setOutputName] = useState("");
  const [loading, setLoading] = useState(false); // reading page count after upload
  const [applying, setApplying] = useState(false); // running the page operations

  // Drag highlight with a depth counter (dragenter/leave fire per child).
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const resetDrag = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragging(false);
  }, []);

  /** Upload the PDF and read its page count from `/api/pdf/open`. */
  const loadFile = useCallback(
    async (incoming: File) => {
      if (incoming.size > MAX_FILE_SIZE_BYTES) {
        toast({
          variant: "destructive",
          title: t("toastError"),
          description: t("overLimit", { max: formatBytes(MAX_FILE_SIZE_BYTES) }),
        });
        return;
      }

      setLoading(true);
      try {
        const form = new FormData();
        form.append("file", incoming, incoming.name);
        // We only need the page count; skip the heavy extraction passes.
        form.append("extractText", "false");
        form.append("extractImages", "false");
        form.append("extractAnnotations", "false");
        form.append("extractFormFields", "false");

        const response = await fetch("/api/pdf/open", {
          method: "POST",
          body: form,
        });

        if (!response.ok) {
          let message = t("loadError");
          try {
            const data = (await response.json()) as { error?: string };
            if (data?.error) message = data.error;
          } catch {
            // Non-JSON body — keep the generic localized message.
          }
          toast({ variant: "destructive", title: t("toastError"), description: message });
          return;
        }

        const data = (await response.json()) as {
          data?: { pageCount?: number };
        };
        const pageCount = data.data?.pageCount ?? 0;
        if (pageCount < 1) {
          toast({ variant: "destructive", title: t("toastError"), description: t("loadError") });
          return;
        }

        setFile(incoming);
        setPages(
          Array.from({ length: pageCount }, (_, i) => ({
            id: nextPageId(),
            originalPageNumber: i + 1,
            rotation: 0 as Rotation,
          })),
        );
      } catch (err) {
        clientLogger.error("organize-pages.load-failed", err);
        toast({ variant: "destructive", title: t("toastError"), description: t("loadError") });
      } finally {
        setLoading(false);
      }
    },
    [t, toast],
  );

  const handleBrowse = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = event.target.files?.[0] ?? null;
      // Reset so re-picking the same file fires `change` again.
      event.target.value = "";
      if (picked) void loadFile(picked);
    },
    [loadFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      resetDrag();
      const picked = event.dataTransfer.files?.[0] ?? null;
      if (picked) void loadFile(picked);
    },
    [loadFile, resetDrag],
  );

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

  const reset = useCallback(() => {
    setFile(null);
    setPages([]);
    setOutputName("");
  }, []);

  const hasDocument = file !== null && pages.length > 0;

  const handleApply = useCallback(async () => {
    if (!file || applying) return;
    if (pages.length === 0) {
      toast({ variant: "destructive", title: t("toastError"), description: t("allDeletedError") });
      return;
    }

    const trimmedName = outputName.trim();
    const finalName = trimmedName
      ? trimmedName.toLowerCase().endsWith(".pdf")
        ? trimmedName
        : `${trimmedName}.pdf`
      : "organized.pdf";

    setApplying(true);
    try {
      // 1) One `extract` pass: keep the chosen pages in the user's final order.
      //    This deletes dropped pages AND reorders in a single round-trip; the
      //    result is renumbered 1..N in that order.
      const extractForm = new FormData();
      extractForm.append("file", file, file.name);
      extractForm.append("operation", "extract");
      extractForm.append(
        "params",
        JSON.stringify({ pageNumbers: pages.map((p) => p.originalPageNumber) }),
      );

      const extractRes = await fetch("/api/pdf/pages", {
        method: "POST",
        body: extractForm,
      });
      if (!extractRes.ok) {
        let message = t("toastError");
        try {
          const data = (await extractRes.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          /* keep generic */
        }
        toast({ variant: "destructive", title: t("toastError"), description: message });
        return;
      }
      let workingBlob = await extractRes.blob();

      // 2) Absolute rotation per page (skip pages left at 0°). The result of one
      //    request feeds the next request's `file`, so rotations compose safely.
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (!page || page.rotation === 0) continue;
        const rotateForm = new FormData();
        rotateForm.append("file", workingBlob, finalName);
        rotateForm.append("operation", "rotate");
        rotateForm.append(
          "params",
          JSON.stringify({ pageNumber: i + 1, degrees: page.rotation, mode: "set" }),
        );

        const rotateRes = await fetch("/api/pdf/pages", {
          method: "POST",
          body: rotateForm,
        });
        if (!rotateRes.ok) {
          let message = t("toastError");
          try {
            const data = (await rotateRes.json()) as { error?: string };
            if (data?.error) message = data.error;
          } catch {
            /* keep generic */
          }
          toast({ variant: "destructive", title: t("toastError"), description: message });
          return;
        }
        workingBlob = await rotateRes.blob();
      }

      triggerBlobDownload(workingBlob, finalName);
      toast({ title: t("toastSuccess"), description: finalName });
    } catch (err) {
      clientLogger.error("organize-pages.apply-failed", err);
      toast({ variant: "destructive", title: t("toastError") });
    } finally {
      setApplying(false);
    }
  }, [file, applying, pages, outputName, t, toast]);

  const canApply = hasDocument && !applying && !loading;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Wand2 className="h-6 w-6 text-primary" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Drop zone — accepts a single PDF. Button role + Enter/Space activation
          keep it fully keyboard operable. */}
      {!hasDocument && (
        <button
          type="button"
          onClick={handleBrowse}
          aria-describedby={hintId}
          aria-disabled={loading}
          disabled={loading}
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            dragDepthRef.current += 1;
            setIsDragging(true);
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            dragDepthRef.current -= 1;
            if (dragDepthRef.current <= 0) resetDrag();
          }}
          onDrop={handleDrop}
          className={`flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 ${
            isDragging
              ? "border-primary bg-primary/10"
              : "border-muted-foreground/30 hover:border-primary/60 hover:bg-accent/40"
          }`}
        >
          {loading ? (
            <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden="true" />
          ) : (
            <UploadCloud
              className={`h-10 w-10 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
              aria-hidden="true"
            />
          )}
          <span className="text-base font-medium">
            {loading ? t("loadingHint") : isDragging ? t("dropNow") : t("dropzoneLabel")}
          </span>
          <span id={hintId} className="max-w-md text-sm text-muted-foreground">
            {t("formatsHint")}
          </span>
          {!loading && (
            <span className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-primary">
              <FilePlus2 className="h-4 w-4" aria-hidden="true" />
              {t("addFile")}
            </span>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Empty state (no document loaded yet) */}
      {!hasDocument && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <FileText className="h-8 w-8 opacity-40" aria-hidden="true" />
            <p className="text-sm">{t("emptyState")}</p>
          </CardContent>
        </Card>
      )}

      {/* Page board — order is the output order */}
      {hasDocument && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">
                  {t("pageListTitle", { count: pages.length })}
                </CardTitle>
                <CardDescription>{t("orderHint")}</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={reset} disabled={applying}>
                {t("clearAll")}
              </Button>
            </div>
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {t("totalSize", { size: formatBytes(file.size) })}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
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
                      disabled={index === 0 || applying}
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
                      disabled={index === pages.length - 1 || applying}
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
                      disabled={applying}
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
                      disabled={applying}
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
      )}

      {/* Output name + apply */}
      {hasDocument && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-1.5">
              <label htmlFor="organize-output-name" className="text-sm font-medium">
                {t("outputNameLabel")}
              </label>
              <Input
                id="organize-output-name"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                placeholder={t("outputNamePlaceholder")}
                disabled={applying}
              />
            </div>
            <Button onClick={handleApply} disabled={!canApply} className="w-full">
              {applying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  {t("applying")}
                </>
              ) : (
                t("applyButton")
              )}
            </Button>
            {applying && (
              <p className="text-center text-xs text-muted-foreground">{t("applyingHint")}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
