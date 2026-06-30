"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  useToast,
} from "@giga-pdf/ui";
import {
  UploadCloud,
  FilePlus2,
  Loader2,
  Play,
  FileText,
  Image as ImageIcon,
  X,
  Type,
  Stamp,
} from "lucide-react";
import { triggerBlobDownload } from "./blob-download";
import { clientLogger } from "@/lib/client-logger";

/**
 * Dedicated runner for the `/watermark` tool, with a Text | Image mode toggle.
 *
 * The generic {@link import("./tool-runner").ToolRunner} renders every option
 * field at once and has no conditional visibility, which can't express two
 * mutually-exclusive watermark modes. This bespoke runner keeps the historic
 * text-watermark flow intact and adds an image-watermark mode (upload an image
 * + anchor / opacity / rotation / scale / tile) — both POST to the same
 * `/api/pdf/watermark` endpoint (`mode=text` vs `mode=image`).
 *
 * Every server outcome — success AND failure — is surfaced through the global
 * toaster, as mandated project-wide for any server action.
 */

const ENDPOINT = "/api/pdf/watermark";
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const DEFAULT_OUTPUT_NAME = "watermarked.pdf";

type WatermarkMode = "text" | "image";

const TEXT_POSITIONS = [
  "center-diagonal",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "header",
  "footer",
] as const;

const IMAGE_ANCHORS = [
  "center",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

/** i18n key (within the watermark namespace) for a position option. */
function positionLabelKey(value: (typeof TEXT_POSITIONS)[number]): string {
  switch (value) {
    case "center-diagonal":
      return "positionCenterDiagonal";
    case "top-left":
      return "positionTopLeft";
    case "top-right":
      return "positionTopRight";
    case "bottom-left":
      return "positionBottomLeft";
    case "bottom-right":
      return "positionBottomRight";
    case "header":
      return "positionHeader";
    case "footer":
      return "positionFooter";
  }
}

/** i18n key for an image anchor option. */
function anchorLabelKey(value: (typeof IMAGE_ANCHORS)[number]): string {
  switch (value) {
    case "center":
      return "anchorCenter";
    case "top-left":
      return "anchorTopLeft";
    case "top-right":
      return "anchorTopRight";
    case "bottom-left":
      return "anchorBottomLeft";
    case "bottom-right":
      return "anchorBottomRight";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** A single-file dropzone (PDF or image) with drag highlight + clear. */
function FileDrop({
  label,
  hint,
  accept,
  icon: Icon,
  file,
  disabled,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  accept: string;
  icon: typeof FileText;
  file: File | null;
  disabled: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const tRunner = useTranslations("toolRunner");
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const reset = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragging(false);
  }, []);

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2">
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onClear}
          disabled={disabled}
          aria-label={tRunner("removeFileNamed", { name: file.name })}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-describedby={hintId}
        aria-disabled={disabled}
        disabled={disabled}
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
          if (dragDepthRef.current <= 0) reset();
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          reset();
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onPick(dropped);
        }}
        className={`flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 ${
          isDragging
            ? "border-primary bg-primary/10"
            : "border-muted-foreground/30 hover:border-primary/60 hover:bg-accent/40"
        }`}
      >
        <UploadCloud
          className={`h-9 w-9 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
          aria-hidden="true"
        />
        <span className="text-base font-medium">{label}</span>
        <span id={hintId} className="max-w-md text-sm text-muted-foreground">
          {hint}
        </span>
        <span className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-primary">
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          {tRunner("chooseFile")}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) onPick(picked);
        }}
      />
    </>
  );
}

export function WatermarkRunner() {
  const t = useTranslations("tools.watermark");
  const tRunner = useTranslations("toolRunner");
  const { toast } = useToast();

  const [mode, setMode] = useState<WatermarkMode>("text");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [outputName, setOutputName] = useState("");
  const [running, setRunning] = useState(false);

  // Text mode.
  const [text, setText] = useState("");
  const [position, setPosition] =
    useState<(typeof TEXT_POSITIONS)[number]>("center-diagonal");

  // Image mode.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [anchor, setAnchor] = useState<(typeof IMAGE_ANCHORS)[number]>("center");
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(40); // % of page width
  const [tile, setTile] = useState(false);

  // Shared.
  const [opacity, setOpacity] = useState(0.3);

  const overLimit = useMemo(() => {
    const total = (pdfFile?.size ?? 0) + (imageFile?.size ?? 0);
    return total > MAX_TOTAL_BYTES;
  }, [pdfFile, imageFile]);

  const canRun = useMemo(() => {
    if (!pdfFile || running || overLimit) return false;
    if (mode === "text") return text.trim().length > 0;
    return Boolean(imageFile);
  }, [pdfFile, running, overLimit, mode, text, imageFile]);

  const resolveOutputName = useCallback((): string => {
    const trimmed = outputName.trim();
    if (!trimmed) return DEFAULT_OUTPUT_NAME;
    return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
  }, [outputName]);

  const handleRun = useCallback(async () => {
    if (!canRun || !pdfFile) return;
    const finalName = resolveOutputName();
    setRunning(true);
    try {
      const form = new FormData();
      form.append("file", pdfFile, pdfFile.name);
      form.append("opacity", String(opacity));

      if (mode === "text") {
        form.append("mode", "text");
        form.append("text", text.trim());
        form.append("position", position);
      } else {
        if (!imageFile) return;
        form.append("mode", "image");
        form.append("image", imageFile, imageFile.name);
        form.append("anchor", anchor);
        form.append("rotation", String(rotation));
        form.append("tile", tile ? "true" : "false");
        // Scale is a percentage of the (mostly A4) page width in points.
        // 0 means "keep source size"; otherwise convert % → points (A4 = 595pt).
        if (scale > 0 && !tile) {
          form.append("width", String(Math.round((scale / 100) * 595)));
        }
      }

      const response = await fetch(ENDPOINT, { method: "POST", body: form });
      if (!response.ok) {
        let message = t("toastError");
        try {
          const data = (await response.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          // Non-JSON body — keep the generic localized message.
        }
        toast({ variant: "destructive", title: t("toastError"), description: message });
        return;
      }

      const blob = await response.blob();
      triggerBlobDownload(blob, finalName);
      toast({ title: t("toastSuccess"), description: finalName });
    } catch (err) {
      clientLogger.error("tool.watermark.failed", err);
      toast({ variant: "destructive", title: t("toastError") });
    } finally {
      setRunning(false);
    }
  }, [
    canRun,
    pdfFile,
    resolveOutputName,
    opacity,
    mode,
    text,
    position,
    imageFile,
    anchor,
    rotation,
    tile,
    scale,
    t,
    toast,
  ]);

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div
        role="radiogroup"
        aria-label={t("modeLabel")}
        className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-1"
      >
        {(
          [
            { value: "text", label: t("modeText"), icon: Type },
            { value: "image", label: t("modeImage"), icon: Stamp },
          ] as const
        ).map((option) => {
          const active = mode === option.value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={running}
              onClick={() => setMode(option.value)}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>

      {/* PDF dropzone */}
      <FileDrop
        label={tRunner("dropzoneLabelSingle")}
        hint={t("formatsHint")}
        accept="application/pdf,.pdf"
        icon={FileText}
        file={pdfFile}
        disabled={running}
        onPick={setPdfFile}
        onClear={() => setPdfFile(null)}
      />

      {pdfFile && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            {mode === "text" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="wm-text">{t("textLabel")}</Label>
                  <Input
                    id="wm-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t("textPlaceholder")}
                    disabled={running}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="wm-position">{t("positionLabel")}</Label>
                  <Select
                    value={position}
                    onValueChange={(v) =>
                      setPosition(v as (typeof TEXT_POSITIONS)[number])
                    }
                    disabled={running}
                  >
                    <SelectTrigger id="wm-position">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEXT_POSITIONS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(positionLabelKey(value))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>{t("imageLabel")}</Label>
                  <FileDrop
                    label={t("imageDropLabel")}
                    hint={t("imageFormatsHint")}
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/tiff,.png,.jpg,.jpeg,.webp,.gif,.avif,.tif,.tiff"
                    icon={ImageIcon}
                    file={imageFile}
                    disabled={running}
                    onPick={setImageFile}
                    onClear={() => setImageFile(null)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="wm-anchor">{t("anchorLabel")}</Label>
                  <Select
                    value={anchor}
                    onValueChange={(v) =>
                      setAnchor(v as (typeof IMAGE_ANCHORS)[number])
                    }
                    disabled={running || tile}
                  >
                    <SelectTrigger id="wm-anchor">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_ANCHORS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(anchorLabelKey(value))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t("scaleLabel")}</span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {scale}%
                    </span>
                  </div>
                  <Slider
                    aria-label={t("scaleLabel")}
                    min={5}
                    max={100}
                    step={5}
                    value={[scale]}
                    onValueChange={(v) => setScale(v[0] ?? scale)}
                    disabled={running || tile}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("scaleDescription")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t("rotationLabel")}</span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {rotation}°
                    </span>
                  </div>
                  <Slider
                    aria-label={t("rotationLabel")}
                    min={-180}
                    max={180}
                    step={5}
                    value={[rotation]}
                    onValueChange={(v) => setRotation(v[0] ?? rotation)}
                    disabled={running}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="wm-tile">{t("tileLabel")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("tileDescription")}
                    </p>
                  </div>
                  <Switch
                    id="wm-tile"
                    checked={tile}
                    onCheckedChange={setTile}
                    disabled={running}
                  />
                </div>
              </>
            )}

            {/* Opacity (shared) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("opacityLabel")}</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {Math.round(opacity * 100)}%
                </span>
              </div>
              <Slider
                aria-label={t("opacityLabel")}
                min={0.05}
                max={1}
                step={0.05}
                value={[opacity]}
                onValueChange={(v) => setOpacity(v[0] ?? opacity)}
                disabled={running}
              />
              <p className="text-xs text-muted-foreground">
                {t("opacityDescription")}
              </p>
            </div>

            {/* Output name */}
            <div className="space-y-1.5">
              <Label htmlFor="wm-output">{tRunner("outputNameLabel")}</Label>
              <Input
                id="wm-output"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                placeholder={DEFAULT_OUTPUT_NAME}
                disabled={running}
                autoComplete="off"
              />
            </div>

            <Button size="lg" onClick={handleRun} disabled={!canRun}>
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {running ? tRunner("processing") : t("actionButton")}
            </Button>

            {running && (
              <div className="space-y-2" aria-live="polite">
                <p className="text-sm text-muted-foreground">
                  {tRunner("processingHint")}
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
