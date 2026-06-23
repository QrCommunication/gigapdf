"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@giga-pdf/ui";
import { downloadBlob } from "@giga-pdf/api";
import { Loader2, Wand2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";
import { downloadDocumentBytes } from "./download-document-bytes";
import { usePageOrganizer, PageOrganizerBoard } from "./page-organizer";

/**
 * Organize the pages of a STORED GED document on a visual grid — the user-facing
 * counterpart of the standalone `/organize-pages` tool, but operating directly
 * on the stored binary instead of an uploaded file. The 7th GED transform, and
 * the only one with a visual-grid UX (the other six are simple dialogs in
 * {@link file://./ged-transform-dialog.tsx}).
 *
 * Like {@link file://./ged-ocr-dialog.tsx}, it: fetches the stored PDF bytes
 * ({@link downloadDocumentBytes}, which re-loads to get a fresh session id),
 * lets the user reorder / rotate / delete pages on the SHARED grid
 * ({@link file://./page-organizer.tsx} — zero duplicated logic with the
 * standalone tool), then on apply:
 *   - REPLACES the document in place by saving a new version
 *     (`api.createDocumentVersion`), preserving id / name / folder / tags; or
 *   - DOWNLOADS the organized result, leaving the stored document untouched.
 *
 * Self-contained (fetch → organize → replace/download); the parent only supplies
 * the document and a refresh callback.
 */

/** Whether the organized result replaces the stored doc or is downloaded. */
type OutputMode = "replace" | "download";

export interface GedOrganizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stored (durable) document id. */
  documentId: string;
  /** Display name (used for the title/toasts and the downloaded file name). */
  documentName: string;
  /** Called after the stored document was replaced in place (to refresh the list). */
  onReplaced?: () => void;
}

export function GedOrganizeDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
  onReplaced,
}: GedOrganizeDialogProps) {
  const t = useTranslations("documents.organize");
  const tTool = useTranslations("organizePages");
  const { toast } = useToast();

  // Fetched stored bytes (as a PDF Blob) → feeds the shared organizer.
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>("replace");
  const [applying, setApplying] = useState(false);

  // The shared organizer reads the page count from the fetched Blob, and owns
  // reorder / rotate / delete + the apply logic (one `extract` + per-page rotate).
  const organizer = usePageOrganizer(sourceBlob);
  const { loading, loadError, hasPages, buildOrganizedBlob } = organizer;

  // Fetch the stored bytes once per opening; reset transient state on close.
  useEffect(() => {
    if (!open) {
      setSourceBlob(null);
      setFetchFailed(false);
      setOutputMode("replace");
      return;
    }

    let cancelled = false;
    setFetching(true);
    setFetchFailed(false);
    (async () => {
      try {
        // Re-loads to obtain a fresh session id, exactly like the OCR path.
        const bytes = await downloadDocumentBytes(documentId);
        if (cancelled) return;
        // `downloadDocumentBytes` returns a `Uint8Array<ArrayBufferLike>` whose
        // buffer is a plain ArrayBuffer; the cast satisfies the DOM `BlobPart`.
        setSourceBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      } catch (err) {
        if (!cancelled) {
          clientLogger.error("documents.ged-organize-fetch-failed", err);
          setFetchFailed(true);
        }
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, documentId]);

  const baseName = documentName.replace(/\.pdf$/i, "");
  const busy = fetching || loading;
  const failed = fetchFailed || loadError !== null;

  const handleApply = async () => {
    if (applying || !hasPages) return;
    setApplying(true);
    try {
      const finalName = `${baseName}.organized.pdf`;
      const organizedBlob = await buildOrganizedBlob(finalName);

      if (outputMode === "replace") {
        // Replace in place: a new version preserves id / name / folder / tags.
        await api.createDocumentVersion(documentId, {
          file: organizedBlob,
          comment: t("comment"),
        });
        toast({
          title: t("replacedTitle"),
          description: t("replacedDescription", { name: documentName }),
        });
        onReplaced?.();
      } else {
        // Download the organized copy; the stored document is left untouched.
        downloadBlob(organizedBlob, finalName);
        toast({ title: t("downloadedTitle") });
      }
      onOpenChange(false);
    } catch (err) {
      clientLogger.error("documents.ged-organize-failed", err);
      toast({
        variant: "destructive",
        title: t("failed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setApplying(false);
    }
  };

  const boardHeader = useMemo(
    () => (
      <div>
        <p className="text-sm font-medium text-foreground">
          {tTool("pageListTitle", { count: organizer.pages.length })}
        </p>
        <p className="text-xs text-muted-foreground">{tTool("orderHint")}</p>
      </div>
    ),
    [tTool, organizer.pages.length],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (applying ? undefined : onOpenChange(next))}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-muted-foreground" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description", { name: documentName })}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-1">
          {busy ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {tTool("loadingHint")}
            </div>
          ) : failed ? (
            <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-muted-foreground">{loadError ?? t("loadError")}</p>
            </div>
          ) : hasPages ? (
            <>
              <PageOrganizerBoard organizer={organizer} disabled={applying} header={boardHeader} />

              {/* Output mode: replace in place or download a copy */}
              <fieldset>
                <legend className="mb-1 block text-xs font-medium text-foreground">
                  {t("outputLabel")}
                </legend>
                <div className="space-y-2">
                  {(
                    [
                      {
                        value: "replace",
                        label: t("outputReplace"),
                        hint: t("outputReplaceHint"),
                      },
                      {
                        value: "download",
                        label: t("outputDownload"),
                        hint: t("outputDownloadHint"),
                      },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
                        outputMode === option.value
                          ? "border-primary bg-primary/5"
                          : "border-input hover:bg-muted"
                      }`}
                    >
                      <input
                        type="radio"
                        name="ged-organize-output"
                        value={option.value}
                        checked={outputMode === option.value}
                        onChange={() => setOutputMode(option.value)}
                        disabled={applying}
                        className="mt-0.5 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">
                          {option.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {option.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            // All pages deleted — keep the dialog usable, block apply.
            <div className="flex items-start gap-3 rounded-md border border-input bg-muted/40 p-3 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">{tTool("allDeletedError")}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            {t("cancel")}
          </Button>
          <Button onClick={handleApply} disabled={applying || busy || failed || !hasPages}>
            {applying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("processing")}
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                {t("run")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
