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
  Combine,
  Loader2,
  ArrowUp,
  ArrowDown,
  X,
  FileText,
  FileSpreadsheet,
  Presentation,
  Image as ImageIcon,
  FileCode2,
  FileType2,
  File as FileIcon,
} from "lucide-react";
import { triggerBlobDownload } from "./blob-download";
import { clientLogger } from "@/lib/client-logger";

/**
 * Universal Merge tool — drop a heterogeneous set of files (PDF, Office,
 * OpenDocument, images, HTML, text, RTF), reorder them (order = merge order),
 * and combine everything into a single downloadable PDF via
 * POST /api/pdf/merge-universal.
 *
 * Self-contained client organism: owns the file queue, the upload state, and
 * the download. Surfaces every outcome (success AND error) through the global
 * toaster, as mandated project-wide for any server action.
 */

/** Total upload cap mirrored from the backend (100 MB) for instant feedback. */
const MAX_TOTAL_SIZE_BYTES = 100 * 1024 * 1024;

/** Accept hint for the native picker — broad, mirrors the engine's inputs. */
const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp," +
  ".png,.jpg,.jpeg,.gif,.webp,.avif,.html,.htm,.txt,.rtf," +
  "application/pdf,image/*";

/** A file queued for merging, with a stable id so React keys survive reorders. */
interface QueuedFile {
  id: string;
  file: File;
  /** Page-range string ("1-5,8", 1-based). Empty = the whole file. */
  range: string;
}

let queueSeq = 0;
function nextQueueId(): string {
  queueSeq = (queueSeq + 1) % Number.MAX_SAFE_INTEGER;
  return `qf-${Date.now().toString(36)}-${queueSeq}`;
}

/** Pick a representative icon from the filename extension. */
function iconForFile(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return FileText;
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return FileType2;
  if (["xls", "xlsx", "ods"].includes(ext)) return FileSpreadsheet;
  if (["ppt", "pptx", "odp"].includes(ext)) return Presentation;
  if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(ext))
    return ImageIcon;
  if (["html", "htm"].includes(ext)) return FileCode2;
  if (ext === "txt") return FileText;
  return FileIcon;
}

/** Human-readable size (KB/MB) without external deps. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function UniversalMergeTool() {
  const t = useTranslations("universalMerge");
  const { toast } = useToast();

  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [outputName, setOutputName] = useState("");
  const [merging, setMerging] = useState(false);

  // Drag highlight with a depth counter (dragenter/leave fire per child).
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const resetDrag = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragging(false);
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    setQueue((prev) => [
      ...prev,
      ...incoming.map((file) => ({ id: nextQueueId(), file, range: "" })),
    ]);
  }, []);

  const handleBrowse = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      // Reset so re-picking the same file fires `change` again; refs stay valid.
      event.target.value = "";
      addFiles(files);
    },
    [addFiles],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      resetDrag();
      const files = event.dataTransfer.files
        ? Array.from(event.dataTransfer.files)
        : [];
      addFiles(files);
    },
    [addFiles, resetDrag],
  );

  const removeFile = useCallback((id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const setRange = useCallback((id: string, range: string) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, range } : q)));
  }, []);

  const moveFile = useCallback((index: number, direction: -1 | 1) => {
    setQueue((prev) => {
      const target = index + direction;
      if (index < 0 || index >= prev.length) return prev;
      if (target < 0 || target >= prev.length) return prev;
      // Swap adjacent items (direction is always ±1). Index-checked above so
      // both lookups are defined under noUncheckedIndexedAccess.
      const next = [...prev];
      const a = next[index];
      const b = next[target];
      if (!a || !b) return prev;
      next[index] = b;
      next[target] = a;
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setQueue([]), []);

  const totalSize = queue.reduce((sum, q) => sum + q.file.size, 0);
  const overLimit = totalSize > MAX_TOTAL_SIZE_BYTES;
  const canMerge = queue.length >= 1 && !merging && !overLimit;

  const handleMerge = useCallback(async () => {
    if (queue.length < 1 || merging || overLimit) return;

    const trimmedName = outputName.trim();
    const finalName = trimmedName
      ? trimmedName.toLowerCase().endsWith(".pdf")
        ? trimmedName
        : `${trimmedName}.pdf`
      : "merged.pdf";

    setMerging(true);
    try {
      const form = new FormData();
      // Repeat `files` (and the parallel `ranges`) per file, IN ORDER — the
      // backend aligns them 1:1 by position. An empty range = the whole file.
      for (const { file, range } of queue) {
        form.append("files", file, file.name);
        form.append("ranges", range.trim());
      }
      form.append("outputName", finalName);

      const response = await fetch("/api/pdf/merge-universal", {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        // The backend returns { success:false, error } for 400/413/415/500.
        let message = t("toastError");
        try {
          const data = (await response.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          // Non-JSON body (rare) — keep the generic localized message.
        }
        toast({ variant: "destructive", title: t("toastError"), description: message });
        return;
      }

      const blob = await response.blob();
      triggerBlobDownload(blob, finalName);
      toast({ title: t("toastSuccess"), description: finalName });
    } catch (err) {
      clientLogger.error("universal-merge.failed", err);
      toast({ variant: "destructive", title: t("toastError") });
    } finally {
      setMerging(false);
    }
  }, [queue, merging, overLimit, outputName, t, toast]);

  const hasFiles = queue.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Combine className="h-6 w-6 text-primary" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Drop zone — accepts every supported file type. The button role +
          Enter/Space activation make it fully keyboard operable. */}
      <button
        type="button"
        onClick={handleBrowse}
        aria-describedby={hintId}
        aria-disabled={merging}
        disabled={merging}
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
        <UploadCloud
          className={`h-10 w-10 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
          aria-hidden="true"
        />
        <span className="text-base font-medium">
          {isDragging ? t("dropNow") : t("dropzoneLabel")}
        </span>
        <span id={hintId} className="max-w-md text-sm text-muted-foreground">
          {t("formatsHint")}
        </span>
        <span className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-primary">
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          {t("addFiles")}
        </span>
      </button>

      {/* Broad accept: PDF, Office, OpenDocument, images, HTML, text, RTF.
          `multiple` enables batch selection. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={handleInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Empty state */}
      {!hasFiles && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Combine className="h-8 w-8 opacity-40" aria-hidden="true" />
            <p className="text-sm">{t("emptyState")}</p>
          </CardContent>
        </Card>
      )}

      {/* File list — order is the merge order */}
      {hasFiles && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">
                  {t("fileListTitle", { count: queue.length })}
                </CardTitle>
                <CardDescription>{t("orderHint")}</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={merging}
              >
                {t("clearAll")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <ol className="space-y-2">
              {queue.map((item, index) => {
                const Icon = iconForFile(item.file.name);
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <Icon
                      className="h-5 w-5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={item.file.name}>
                        {item.file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(item.file.size)}
                      </p>
                    </div>
                    <Input
                      value={item.range}
                      onChange={(e) => setRange(item.id, e.target.value)}
                      placeholder={t("pageRangePlaceholder")}
                      aria-label={t("pageRangeAria", { name: item.file.name })}
                      title={
                        item.range.trim()
                          ? t("pageRangeLabel")
                          : t("pageRangeAllPages")
                      }
                      disabled={merging}
                      autoComplete="off"
                      spellCheck={false}
                      className="h-8 w-24 shrink-0 text-sm sm:w-32"
                    />
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => moveFile(index, -1)}
                        disabled={merging || index === 0}
                        title={t("moveUp")}
                        aria-label={t("moveUpFile", { name: item.file.name })}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => moveFile(index, 1)}
                        disabled={merging || index === queue.length - 1}
                        title={t("moveDown")}
                        aria-label={t("moveDownFile", { name: item.file.name })}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeFile(item.id)}
                        disabled={merging}
                        title={t("removeFile")}
                        aria-label={t("removeFileNamed", { name: item.file.name })}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Per-file page-range format hint */}
            <p className="pt-1 text-xs text-muted-foreground">
              {t("pageRangeHint")}
            </p>

            {/* Total size + over-limit warning */}
            <div
              className={`flex items-center justify-between pt-1 text-xs ${
                overLimit ? "text-destructive" : "text-muted-foreground"
              }`}
              aria-live="polite"
            >
              <span>{t("totalSize", { size: formatBytes(totalSize) })}</span>
              {overLimit && <span>{t("overLimit", { max: "100 MB" })}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Output name + merge action */}
      {hasFiles && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="merge-output-name" className="text-sm font-medium">
              {t("outputNameLabel")}
            </label>
            <Input
              id="merge-output-name"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder={t("outputNamePlaceholder")}
              disabled={merging}
              autoComplete="off"
            />
          </div>
          <Button
            size="lg"
            onClick={handleMerge}
            disabled={!canMerge}
            className="sm:w-auto"
          >
            {merging ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Combine className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {merging ? t("merging") : t("mergeButton")}
          </Button>
        </div>
      )}

      {/* Indeterminate progress while the server converts + concatenates.
          CSS-only sliding bar — the work is server-side N-way conversion with
          no streamed progress, so a determinate value would be misleading. */}
      {merging && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm text-muted-foreground">{t("mergingHint")}</p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
          </div>
        </div>
      )}
    </div>
  );
}
