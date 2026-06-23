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
import {
  useCompressPdf,
  useEncryptPdf,
  useSignPdf,
  useAddWatermark,
  useConvertToPdfA,
  useSplitPdf,
  downloadBlob,
} from "@giga-pdf/api";
import {
  Loader2,
  Minimize2,
  Lock,
  PenLine,
  Droplet,
  FileCheck2,
  Scissors,
  AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";
import { downloadDocumentBytes } from "./download-document-bytes";

/**
 * Apply a PDF→PDF transform DIRECTLY to a STORED GED document — no
 * download/re-upload round-trip. The user-facing counterpart of the editor's
 * standalone tool dialogs, but operating on the stored binary instead of the
 * editor's live `currentPdfFile`.
 *
 * Like {@link file://./ged-ocr-dialog.tsx}, it: fetches the stored PDF bytes
 * ({@link downloadDocumentBytes}, which re-loads to get a fresh session id),
 * runs the transform by REUSING the existing `@giga-pdf/api` hook (the very same
 * mutation the editor dialogs call — zero duplicated transform logic), then:
 *   - REPLACES the document in place by saving a new version
 *     (`api.createDocumentVersion`), preserving id / name / folder / tags; or
 *   - DOWNLOADS the result, leaving the stored document untouched.
 *
 * `split` is inherently multi-output (one PDF per part), so it ALWAYS downloads
 * (each part) and offers no replace mode.
 *
 * Self-contained (fetch → transform → replace/download); the parent only
 * supplies the document, the chosen transform, and a refresh callback.
 */

/** The PDF→PDF transforms the GED menu exposes. */
export type GedTransform =
  | "compress"
  | "protect"
  | "sign"
  | "watermark"
  | "pdfa"
  | "split";

/** Whether the single-output result replaces the stored doc or is downloaded. */
type OutputMode = "replace" | "download";

/** PDF/A archival variants offered (mirrors the editor pdfa dialog). */
type PdfAVariant = "pdfa-1b" | "pdfa-1a" | "pdfa-2b" | "pdfa-2u" | "pdfa-3b";

const PDFA_VARIANTS: readonly PdfAVariant[] = [
  "pdfa-2u",
  "pdfa-3b",
  "pdfa-2b",
  "pdfa-1b",
  "pdfa-1a",
];

/** Watermark stamp positions (mirrors the editor watermark dialog / service). */
type WatermarkPosition =
  | "center-diagonal"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "header"
  | "footer";

const WATERMARK_POSITIONS: readonly WatermarkPosition[] = [
  "center-diagonal",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "header",
  "footer",
];

/** AES algorithm choices for encryption (mirrors the editor encrypt dialog). */
type EncryptAlgorithm = "AES-256" | "AES-128";

/** Split modes (mirrors the editor split dialog). */
type SplitMode = "splitPoints" | "ranges";

/** Decode a base64 split part into a PDF Blob (mirrors the editor split dialog). */
function base64ToBlob(base64: string, mimeType = "application/pdf"): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/** Parse "5, 10, 15" → [5, 10, 15]; null when invalid/empty. */
function parseSplitPoints(raw: string): number[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const nums: number[] = [];
  for (const part of trimmed.split(",").map((s) => s.trim())) {
    const n = parseInt(part, 10);
    if (Number.isNaN(n) || n <= 0) return null;
    nums.push(n);
  }
  return nums.length > 0 ? nums : null;
}

/** Parse "1-5, 6-10" → ["1-5", "6-10"]; null when invalid/empty. */
function parseRanges(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(",").map((s) => s.trim());
  const pattern = /^\d+-\d+$/;
  for (const part of parts) {
    if (!pattern.test(part)) return null;
    const [start, end] = part.split("-").map(Number) as [number, number];
    if (start > end) return null;
  }
  return parts.length > 0 ? parts : null;
}

/** Max PKCS#12 size accepted for signing (mirrors the editor sign dialog). */
const MAX_P12_SIZE_BYTES = 1024 * 1024;

const TRANSFORM_ICON: Record<GedTransform, typeof Minimize2> = {
  compress: Minimize2,
  protect: Lock,
  sign: PenLine,
  watermark: Droplet,
  pdfa: FileCheck2,
  split: Scissors,
};

export interface GedTransformDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which PDF→PDF transform to run. */
  transform: GedTransform;
  /** Stored (durable) document id. */
  documentId: string;
  /** Display name (used for the title/toasts and the downloaded file name). */
  documentName: string;
  /** Called after the stored document was replaced in place (to refresh the list). */
  onReplaced?: () => void;
}

export function GedTransformDialog({
  open,
  onOpenChange,
  transform,
  documentId,
  documentName,
  onReplaced,
}: GedTransformDialogProps) {
  const t = useTranslations("documents.transform");
  const { toast } = useToast();

  // `split` produces multiple files → it can only ever be downloaded.
  const supportsReplace = transform !== "split";
  const [outputMode, setOutputMode] = useState<OutputMode>("replace");
  const [running, setRunning] = useState(false);

  // ── Transform-specific parameters ──────────────────────────────────────────
  // protect (encrypt)
  const [userPassword, setUserPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [algorithm, setAlgorithm] = useState<EncryptAlgorithm>("AES-256");
  // sign
  const [p12File, setP12File] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [signReason, setSignReason] = useState("");
  const [signLocation, setSignLocation] = useState("");
  const [timestamp, setTimestamp] = useState(false);
  // watermark
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIEL");
  const [watermarkPosition, setWatermarkPosition] =
    useState<WatermarkPosition>("center-diagonal");
  const [watermarkOpacity, setWatermarkOpacity] = useState(25);
  // pdfa
  const [pdfaVariant, setPdfaVariant] = useState<PdfAVariant>("pdfa-2u");
  // split
  const [splitMode, setSplitMode] = useState<SplitMode>("splitPoints");
  const [splitPointsInput, setSplitPointsInput] = useState("");
  const [rangesInput, setRangesInput] = useState("");

  const compress = useCompressPdf();
  const encrypt = useEncryptPdf();
  const sign = useSignPdf();
  const watermark = useAddWatermark();
  const pdfa = useConvertToPdfA();
  const split = useSplitPdf();

  // Reset transient params/mode each time the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setOutputMode(transform === "split" ? "download" : "replace");
      return;
    }
    setUserPassword("");
    setOwnerPassword("");
    setP12File(null);
    setPassphrase("");
    setSignReason("");
    setSignLocation("");
    setTimestamp(false);
    setSplitPointsInput("");
    setRangesInput("");
  }, [open, transform]);

  const baseName = documentName.replace(/\.pdf$/i, "");
  const Icon = TRANSFORM_ICON[transform];
  const p12TooLarge = p12File !== null && p12File.size > MAX_P12_SIZE_BYTES;

  /** Whether the current params are sufficient to run the transform. */
  const canRun = useMemo(() => {
    switch (transform) {
      case "protect":
        return userPassword.trim().length > 0 || ownerPassword.trim().length > 0;
      case "sign":
        return p12File !== null && !p12TooLarge && passphrase.length > 0;
      case "watermark":
        return watermarkText.trim().length > 0;
      case "split":
        return (
          (splitMode === "splitPoints"
            ? parseSplitPoints(splitPointsInput)
            : parseRanges(rangesInput)) !== null
        );
      case "compress":
      case "pdfa":
        return true;
    }
  }, [
    transform,
    userPassword,
    ownerPassword,
    p12File,
    p12TooLarge,
    passphrase,
    watermarkText,
    splitMode,
    splitPointsInput,
    rangesInput,
  ]);

  /**
   * Run the chosen transform on the stored bytes, returning either a single
   * result Blob (compress/protect/sign/watermark/pdfa) or `null` when the
   * transform handled its own (multi-file) downloads (split).
   */
  const runTransform = async (sourceBlob: Blob): Promise<Blob | null> => {
    switch (transform) {
      case "compress": {
        const { blob } = await compress.mutateAsync({ file: sourceBlob });
        return blob;
      }
      case "protect":
        return encrypt.mutateAsync({
          file: sourceBlob,
          options: {
            userPassword: userPassword.trim() || undefined,
            ownerPassword: ownerPassword.trim() || undefined,
            algorithm,
          },
        });
      case "sign":
        return sign.mutateAsync({
          file: sourceBlob,
          p12: p12File as File,
          passphrase,
          options: {
            reason: signReason.trim() || undefined,
            location: signLocation.trim() || undefined,
            timestamp,
          },
        });
      case "watermark":
        return watermark.mutateAsync({
          file: sourceBlob,
          options: {
            text: watermarkText.trim(),
            position: watermarkPosition,
            opacity: watermarkOpacity / 100,
          },
        });
      case "pdfa":
        return pdfa.mutateAsync({ file: sourceBlob, variant: pdfaVariant });
      case "split": {
        const points =
          splitMode === "splitPoints" ? parseSplitPoints(splitPointsInput) : null;
        const ranges = splitMode === "ranges" ? parseRanges(rangesInput) : null;
        const result = await split.mutateAsync({
          file: sourceBlob,
          options: points ? { splitPoints: points } : { ranges: ranges ?? [] },
        });
        for (const part of result.parts) {
          downloadBlob(base64ToBlob(part.data), part.filename);
        }
        return null;
      }
    }
  };

  const handleRun = async () => {
    if (!canRun || running) return;
    setRunning(true);
    try {
      // 1) Fetch the stored document's current PDF bytes (re-loads to get a
      //    fresh session id, exactly like the OCR / export paths).
      const bytes = await downloadDocumentBytes(documentId);
      // `downloadDocumentBytes` returns a `Uint8Array<ArrayBufferLike>` whose
      // buffer is a plain ArrayBuffer; the cast satisfies the DOM `BlobPart`.
      const sourceBlob = new Blob([bytes as BlobPart], {
        type: "application/pdf",
      });

      // 2) Run the transform by reusing the existing `@giga-pdf/api` hook.
      const result = await runTransform(sourceBlob);

      // 3) split already downloaded its parts → just confirm and close.
      if (result === null) {
        toast({ title: t("downloadedTitle") });
        onOpenChange(false);
        return;
      }

      if (supportsReplace && outputMode === "replace") {
        // 4a) Replace in place: a new version preserves id / name / folder / tags.
        await api.createDocumentVersion(documentId, {
          file: result,
          comment: t(`comment.${transform}`),
        });
        toast({
          title: t("replacedTitle"),
          description: t("replacedDescription", { name: documentName }),
        });
        onReplaced?.();
      } else {
        // 4b) Download the transformed copy; the stored document is untouched.
        downloadBlob(result, `${baseName}.${transform}.pdf`);
        toast({ title: t("downloadedTitle") });
      }
      onOpenChange(false);
    } catch (err) {
      clientLogger.error("documents.ged-transform-failed", err);
      // Surface the dedicated signing errors with a friendly message.
      const message =
        err instanceof Error && err.name === "InvalidCertificateError"
          ? t("signInvalidCert")
          : err instanceof Error && err.name === "TsaUnreachableError"
            ? t("signTsaUnreachable")
            : err instanceof Error
              ? err.message
              : undefined;
      toast({ variant: "destructive", title: t("failed"), description: message });
    } finally {
      setRunning(false);
    }
  };

  const inputClass =
    "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

  return (
    <Dialog open={open} onOpenChange={(next) => (running ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {t(`title.${transform}`)}
          </DialogTitle>
          <DialogDescription>
            {t(`description.${transform}`, { name: documentName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* ── compress: no parameters ── */}
          {transform === "compress" && (
            <p className="text-sm text-muted-foreground">{t("compressHint")}</p>
          )}

          {/* ── protect (encrypt) ── */}
          {transform === "protect" && (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="ged-protect-user"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  {t("userPasswordLabel")}
                </label>
                <input
                  id="ged-protect-user"
                  type="password"
                  autoComplete="new-password"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  disabled={running}
                  className={inputClass}
                  placeholder={t("userPasswordPlaceholder")}
                />
              </div>
              <div>
                <label
                  htmlFor="ged-protect-owner"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  {t("ownerPasswordLabel")}
                </label>
                <input
                  id="ged-protect-owner"
                  type="password"
                  autoComplete="new-password"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  disabled={running}
                  className={inputClass}
                  placeholder={t("ownerPasswordPlaceholder")}
                />
              </div>
              <div>
                <label
                  htmlFor="ged-protect-algo"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  {t("algorithmLabel")}
                </label>
                <select
                  id="ged-protect-algo"
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value as EncryptAlgorithm)}
                  disabled={running}
                  className={inputClass}
                >
                  <option value="AES-256">{t("algorithmAes256")}</option>
                  <option value="AES-128">{t("algorithmAes128")}</option>
                </select>
              </div>
            </div>
          )}

          {/* ── sign ── */}
          {transform === "sign" && (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="ged-sign-p12"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  {t("p12Label")}
                </label>
                <input
                  id="ged-sign-p12"
                  type="file"
                  accept=".p12,.pfx,application/x-pkcs12"
                  onChange={(e) => setP12File(e.target.files?.[0] ?? null)}
                  disabled={running}
                  className={inputClass}
                />
                {p12TooLarge && (
                  <p className="mt-1 text-xs text-destructive">{t("p12TooLarge")}</p>
                )}
              </div>
              <div>
                <label
                  htmlFor="ged-sign-passphrase"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  {t("passphraseLabel")}
                </label>
                <input
                  id="ged-sign-passphrase"
                  type="password"
                  autoComplete="off"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  disabled={running}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="ged-sign-reason"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    {t("reasonLabel")}
                  </label>
                  <input
                    id="ged-sign-reason"
                    type="text"
                    value={signReason}
                    onChange={(e) => setSignReason(e.target.value)}
                    disabled={running}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor="ged-sign-location"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    {t("locationLabel")}
                  </label>
                  <input
                    id="ged-sign-location"
                    type="text"
                    value={signLocation}
                    onChange={(e) => setSignLocation(e.target.value)}
                    disabled={running}
                    className={inputClass}
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={timestamp}
                  onChange={(e) => setTimestamp(e.target.checked)}
                  disabled={running}
                  className="accent-primary"
                />
                {t("timestampLabel")}
              </label>
            </div>
          )}

          {/* ── watermark (text) ── */}
          {transform === "watermark" && (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="ged-watermark-text"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  {t("watermarkTextLabel")}
                </label>
                <input
                  id="ged-watermark-text"
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  disabled={running}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="ged-watermark-position"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    {t("watermarkPositionLabel")}
                  </label>
                  <select
                    id="ged-watermark-position"
                    value={watermarkPosition}
                    onChange={(e) =>
                      setWatermarkPosition(e.target.value as WatermarkPosition)
                    }
                    disabled={running}
                    className={inputClass}
                  >
                    {WATERMARK_POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {t(`watermarkPos.${p}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="ged-watermark-opacity"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    {t("watermarkOpacityLabel", { value: watermarkOpacity })}
                  </label>
                  <input
                    id="ged-watermark-opacity"
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={watermarkOpacity}
                    onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                    disabled={running}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── pdfa ── */}
          {transform === "pdfa" && (
            <div>
              <label
                htmlFor="ged-pdfa-variant"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                {t("pdfaVariantLabel")}
              </label>
              <select
                id="ged-pdfa-variant"
                value={pdfaVariant}
                onChange={(e) => setPdfaVariant(e.target.value as PdfAVariant)}
                disabled={running}
                className={inputClass}
              >
                {PDFA_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    {t(`pdfaVariant.${v}`)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ── split ── */}
          {transform === "split" && (
            <div className="space-y-3">
              <fieldset>
                <legend className="mb-1 block text-xs font-medium text-foreground">
                  {t("splitModeLabel")}
                </legend>
                <div className="flex gap-4">
                  {(["splitPoints", "ranges"] as const).map((m) => (
                    <label
                      key={m}
                      className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                    >
                      <input
                        type="radio"
                        name="ged-split-mode"
                        value={m}
                        checked={splitMode === m}
                        onChange={() => setSplitMode(m)}
                        disabled={running}
                        className="accent-primary"
                      />
                      {t(`splitMode.${m}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              {splitMode === "splitPoints" ? (
                <div>
                  <label
                    htmlFor="ged-split-points"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    {t("splitPointsLabel")}
                  </label>
                  <input
                    id="ged-split-points"
                    type="text"
                    value={splitPointsInput}
                    onChange={(e) => setSplitPointsInput(e.target.value)}
                    disabled={running}
                    placeholder={t("splitPointsPlaceholder")}
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("splitPointsHint")}
                  </p>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="ged-split-ranges"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    {t("splitRangesLabel")}
                  </label>
                  <input
                    id="ged-split-ranges"
                    type="text"
                    value={rangesInput}
                    onChange={(e) => setRangesInput(e.target.value)}
                    disabled={running}
                    placeholder={t("splitRangesPlaceholder")}
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("splitRangesHint")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── output mode: replace in place or download (single-output only) ── */}
          {supportsReplace && (
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
                      name="ged-transform-output"
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
          )}

          {transform === "split" && (
            <div className="flex items-start gap-3 rounded-md border border-input bg-muted/40 p-3 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">{t("splitDownloadOnly")}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            {t("cancel")}
          </Button>
          <Button onClick={handleRun} disabled={!canRun || running}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("processing")}
              </>
            ) : (
              <>
                <Icon className="mr-2 h-4 w-4" />
                {t("run")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
