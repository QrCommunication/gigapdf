"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardTitle,
  Input,
  useToast,
} from "@giga-pdf/ui";
import {
  UploadCloud,
  FilePlus2,
  Loader2,
  FileText,
  Wand2,
} from "lucide-react";
import { triggerBlobDownload } from "./blob-download";
import { clientLogger } from "@/lib/client-logger";
import {
  usePageOrganizer,
  PageOrganizerBoard,
} from "./page-organizer";

/**
 * Organize Pages tool — open a PDF, then reorder, rotate (per page), and delete
 * its pages on a visual grid, and apply everything in one go to download a new
 * PDF. A genuine page-organization workflow (NOT an alias of extract-pages).
 *
 * The page model, the page grid, and the apply logic live in the shared
 * {@link file://./page-organizer.tsx} module so the GED document menu reuses the
 * EXACT same affordance (see `ged-organize-dialog.tsx`). This standalone tool
 * owns only its own chrome: the upload dropzone, the output-name field, and the
 * download. Surfaces every outcome (success AND error) through the global
 * toaster, as mandated project-wide for any server action.
 */

/** Single-file backend cap (250 MB) mirrored for instant client feedback. */
const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024;

/** Accept hint for the native picker — PDF only. */
const ACCEPT = ".pdf,application/pdf";

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
  const [outputName, setOutputName] = useState("");
  const [applying, setApplying] = useState(false); // running the page operations

  // The shared organizer reads the page count from `/api/pdf/open` whenever the
  // source changes, and owns reorder/rotate/delete + the apply logic.
  const organizer = usePageOrganizer(file);
  const { loading, loadError, hasPages, buildOrganizedBlob } = organizer;

  // Surface a load failure (bad/locked PDF) through the toaster, then clear the
  // source so the dropzone returns. Driven by the organizer's `loadError`.
  useEffect(() => {
    if (!loadError) return;
    toast({ variant: "destructive", title: t("toastError"), description: loadError });
    setFile(null);
  }, [loadError, t, toast]);

  // Drag highlight with a depth counter (dragenter/leave fire per child).
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const resetDrag = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragging(false);
  }, []);

  /** Accept a PDF for organizing (after a client-side size check). */
  const loadFile = useCallback(
    (incoming: File) => {
      if (incoming.size > MAX_FILE_SIZE_BYTES) {
        toast({
          variant: "destructive",
          title: t("toastError"),
          description: t("overLimit", { max: formatBytes(MAX_FILE_SIZE_BYTES) }),
        });
        return;
      }
      setFile(incoming);
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
      if (picked) loadFile(picked);
    },
    [loadFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      resetDrag();
      const picked = event.dataTransfer.files?.[0] ?? null;
      if (picked) loadFile(picked);
    },
    [loadFile, resetDrag],
  );

  const reset = useCallback(() => {
    setFile(null);
    setOutputName("");
  }, []);

  const hasDocument = file !== null && hasPages;

  const handleApply = useCallback(async () => {
    if (!file || applying || !hasPages) {
      if (file && !hasPages) {
        toast({
          variant: "destructive",
          title: t("toastError"),
          description: t("allDeletedError"),
        });
      }
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
      const organizedBlob = await buildOrganizedBlob(finalName);
      triggerBlobDownload(organizedBlob, finalName);
      toast({ title: t("toastSuccess"), description: finalName });
    } catch (err) {
      clientLogger.error("organize-pages.apply-failed", err);
      toast({
        variant: "destructive",
        title: t("toastError"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setApplying(false);
    }
  }, [file, applying, hasPages, outputName, buildOrganizedBlob, t, toast]);

  const canApply = hasDocument && !applying && !loading;

  const boardHeader = useMemo(
    () => (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">
              {t("pageListTitle", { count: organizer.pages.length })}
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
      </div>
    ),
    [t, organizer.pages.length, reset, applying, file],
  );

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

      {/* Page board — order is the output order (shared with the GED dialog) */}
      {hasDocument && (
        <PageOrganizerBoard organizer={organizer} disabled={applying} header={boardHeader} />
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
