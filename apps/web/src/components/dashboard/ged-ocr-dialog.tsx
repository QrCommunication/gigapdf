"use client";

import { useEffect, useState } from "react";
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
import { useMakeSearchablePdf, useIsOcrAvailable, downloadBlob } from "@giga-pdf/api";
import { Loader2, ScanText, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";
import { downloadDocumentBytes } from "./download-document-bytes";

/**
 * Make a stored GED document searchable via OCR — the user-facing counterpart of
 * the auto-index that runs silently at import. It fetches the stored PDF bytes,
 * bakes an INVISIBLE OCR text layer (`makeSearchablePdf`, the same engine path
 * the editor modal uses), then either:
 *   - REPLACES the document in place by saving a new version
 *     (`createDocumentVersion`), preserving its id / name / folder / tags; or
 *   - DOWNLOADS the searchable copy, leaving the stored document untouched.
 *
 * Intended for scanned / image-only PDFs that carry no text layer. Self-contained
 * (fetch → OCR → replace/download); the parent only supplies the document and a
 * refresh callback.
 */

type Dpi = 144 | 200 | 300;

/** Whether the searchable result replaces the stored doc or is downloaded. */
type OutputMode = "replace" | "download";

/**
 * The 12 writing systems offered in the UI. Several distinct choices share a
 * single bundled OCR model (Latin/Cyrillic → "alpha"; Arabic/Hebrew → "arabic";
 * Chinese simplified/traditional → "cjk"), so each maps to the concrete
 * OcrScript identifiers the engine loads — mirrors the editor OCR dialog.
 */
type ScriptChoice =
  | "latin"
  | "cyrillic"
  | "arabic"
  | "hebrew"
  | "devanagari"
  | "tamil"
  | "telugu"
  | "kannada"
  | "chinese_simplified"
  | "chinese_traditional"
  | "japanese"
  | "korean";

/** UI choice → bundled OcrScript identifier(s) understood by the engine. */
const SCRIPT_CHOICES: { value: ScriptChoice; scripts: string[] }[] = [
  { value: "latin", scripts: ["alpha"] },
  { value: "cyrillic", scripts: ["alpha"] },
  { value: "arabic", scripts: ["arabic"] },
  { value: "hebrew", scripts: ["arabic"] },
  { value: "devanagari", scripts: ["devanagari"] },
  { value: "tamil", scripts: ["tamil"] },
  { value: "telugu", scripts: ["telugu"] },
  { value: "kannada", scripts: ["kannada"] },
  { value: "chinese_simplified", scripts: ["cjk"] },
  { value: "chinese_traditional", scripts: ["cjk"] },
  { value: "japanese", scripts: ["japanese"] },
  { value: "korean", scripts: ["korean"] },
];

const SCRIPTS_FOR_CHOICE: Record<ScriptChoice, string[]> = Object.fromEntries(
  SCRIPT_CHOICES.map((c) => [c.value, c.scripts]),
) as Record<ScriptChoice, string[]>;

export interface GedOcrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stored (durable) document id. */
  documentId: string;
  /** Display name (used for the title/toasts and the downloaded file name). */
  documentName: string;
  /** Called after the stored document was replaced in place (to refresh the list). */
  onReplaced?: () => void;
}

export function GedOcrDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
  onReplaced,
}: GedOcrDialogProps) {
  const t = useTranslations("documents.ocr");
  const { toast } = useToast();

  const [script, setScript] = useState<ScriptChoice>("latin");
  const [dpi, setDpi] = useState<Dpi>(144);
  const [outputMode, setOutputMode] = useState<OutputMode>("replace");
  const [running, setRunning] = useState(false);

  const makeSearchable = useMakeSearchablePdf();
  const availabilityCheck = useIsOcrAvailable();
  const [available, setAvailable] = useState<boolean | null>(null);

  // Probe OCR availability once per opening; reset transient UI errors.
  useEffect(() => {
    if (!open) {
      makeSearchable.reset();
      return;
    }
    let cancelled = false;
    availabilityCheck
      .mutateAsync()
      .then((ok) => {
        if (!cancelled) setAvailable(ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const baseName = documentName.replace(/\.pdf$/i, "");

  const handleRun = async () => {
    if (available === false || running) return;
    setRunning(true);
    try {
      // 1) Fetch the stored document's current PDF bytes (re-loads to get a
      //    fresh session id, exactly like the dashboard export path).
      const bytes = await downloadDocumentBytes(documentId);
      // `downloadDocumentBytes` returns a `Uint8Array<ArrayBufferLike>`, which the
      // DOM lib's `BlobPart` union rejects (it wants `ArrayBufferView<ArrayBuffer>`).
      // The buffer is a plain ArrayBuffer (built `new Uint8Array(arrayBuffer)`),
      // so the cast is sound.
      const sourceBlob = new Blob([bytes as BlobPart], {
        type: "application/pdf",
      });

      // 2) Bake an invisible OCR text layer. Restrict the engine to the chosen
      //    writing system's bundled model(s) so it doesn't load every recognizer.
      const { blob } = await makeSearchable.mutateAsync({
        file: sourceBlob,
        options: { dpi, scripts: SCRIPTS_FOR_CHOICE[script] },
      });

      if (outputMode === "replace") {
        // 3a) Replace in place: a new version preserves id / name / folder / tags.
        await api.createDocumentVersion(documentId, {
          file: blob,
          comment: "OCR searchable layer",
        });
        toast({
          title: t("replacedTitle"),
          description: t("replacedDescription", { name: documentName }),
        });
        onReplaced?.();
      } else {
        // 3b) Download a searchable copy; the stored document is left untouched.
        downloadBlob(blob, `${baseName}.searchable.pdf`);
        toast({ title: t("downloadedTitle") });
      }
      onOpenChange(false);
    } catch (err) {
      clientLogger.error("documents.ged-ocr-failed", err);
      toast({
        variant: "destructive",
        title: t("failed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (running ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanText className="h-4 w-4 text-muted-foreground" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("description", { name: documentName })}
          </DialogDescription>
        </DialogHeader>

        {available === false ? (
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-muted-foreground">{t("unavailable")}</p>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {/* Writing system + DPI */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="ged-ocr-script"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  {t("scriptLabel")}
                </label>
                <select
                  id="ged-ocr-script"
                  value={script}
                  onChange={(e) => setScript(e.target.value as ScriptChoice)}
                  disabled={running}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  {SCRIPT_CHOICES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {t(`lang.${c.value}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="ged-ocr-dpi"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  {t("dpiLabel")}
                </label>
                <select
                  id="ged-ocr-dpi"
                  value={dpi}
                  onChange={(e) => setDpi(Number(e.target.value) as Dpi)}
                  disabled={running}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value={144}>{t("dpiFast")}</option>
                  <option value={200}>{t("dpiBalanced")}</option>
                  <option value={300}>{t("dpiHigh")}</option>
                </select>
              </div>
            </div>

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
                      name="ged-ocr-output"
                      value={option.value}
                      checked={outputMode === option.value}
                      onChange={() => setOutputMode(option.value)}
                      disabled={running}
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
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleRun} disabled={available === false || running}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("processing")}
              </>
            ) : (
              <>
                <ScanText className="mr-2 h-4 w-4" />
                {t("run")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
