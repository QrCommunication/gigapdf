"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { zipSync, strToU8, type Zippable } from "fflate";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  useToast,
} from "@giga-pdf/ui";
import {
  UploadCloud,
  FilePlus2,
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
  Play,
} from "lucide-react";
import { triggerBlobDownload } from "./blob-download";
import { clientLogger } from "@/lib/client-logger";
import { getAuthToken } from "@/lib/auth-token";
import { ToolFieldControl } from "./tool-field-control";
import { ToolTextRunner } from "./tool-text-runner";
import { resolveOutputName } from "./tool-runner-shared";
import type { ToolConfig, ToolTextInput } from "./tool-runner-types";

/**
 * Generic, config-driven PDF tool runner.
 *
 * Renders an accessible upload → options → action → download workflow from a
 * {@link ToolConfig}, reusing the existing `/api/pdf/*` and `/api/office/*`
 * endpoints. One component backs every "thin" tool page (split, compress,
 * watermark, protect, …) so there is no per-tool duplication.
 *
 * Tools whose primary input is text/HTML or a URL (not a file) declare a
 * {@link ToolTextInput} via `config.input`; those are delegated to
 * {@link ToolTextRunner}. Everything below handles the file-upload tools.
 *
 * Every server outcome — success AND failure — is surfaced through the global
 * toaster, as mandated project-wide for any server action.
 */

/** A file queued for processing, with a stable id so keys survive reorders. */
interface QueuedFile {
  id: string;
  file: File;
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

/** Shape of the `splitZip` endpoint payload (parts as base64). */
interface SplitPartsResponse {
  data?: {
    parts?: Array<{ filename?: string; data?: string }>;
  };
}

/** Decode a base64 string into bytes (browser-safe). */
function base64ToBytes(b64: string): Uint8Array {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface ToolRunnerProps {
  config: ToolConfig;
}

/**
 * Entry point: text/URL tools render the {@link ToolTextRunner}; file tools
 * render the upload workflow ({@link FileToolRunner}). Splitting on the config
 * here keeps each runner focused and the historic file tools untouched.
 */
export function ToolRunner({ config }: ToolRunnerProps) {
  if (config.input) {
    return <ToolTextRunner config={config as ToolConfig & { input: ToolTextInput }} />;
  }
  return <FileToolRunner config={config} />;
}

function FileToolRunner({ config }: ToolRunnerProps) {
  const t = useTranslations(config.namespace);
  const tRunner = useTranslations("toolRunner");
  const { toast } = useToast();

  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // File tools always declare these; fall back defensively for the type system.
  const uploadMode = config.uploadMode ?? "single";
  const fileFieldName = config.fileFieldName ?? "file";
  const maxTotalBytes = config.maxTotalBytes ?? Number.POSITIVE_INFINITY;

  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [outputName, setOutputName] = useState("");
  const [running, setRunning] = useState(false);

  // Option field values, keyed by field name. Initialised from defaults.
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of config.fields) {
      if (field.type === "file") continue;
      initial[field.name] =
        field.defaultValue ?? (field.type === "switch" ? "false" : "");
    }
    return initial;
  });
  // Extra File objects from `file` fields (e.g. the P12 certificate).
  const [fieldFiles, setFieldFiles] = useState<Record<string, File | null>>({});

  // Drag highlight with a depth counter (dragenter/leave fire per child).
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const isMulti = uploadMode === "multiple";

  const resetDrag = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragging(false);
  }, []);

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      setQueue((prev) => {
        const next = incoming.map((file) => ({ id: nextQueueId(), file }));
        // Single-file tools keep only the last selection.
        return isMulti ? [...prev, ...next] : next.slice(-1);
      });
    },
    [isMulti],
  );

  const handleBrowse = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      // Reset so re-picking the same file fires `change` again.
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

  const moveFile = useCallback((index: number, direction: -1 | 1) => {
    setQueue((prev) => {
      const target = index + direction;
      if (index < 0 || index >= prev.length) return prev;
      if (target < 0 || target >= prev.length) return prev;
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

  const setFieldValue = useCallback((name: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const setFieldFile = useCallback((name: string, file: File | null) => {
    setFieldFiles((prev) => ({ ...prev, [name]: file }));
  }, []);

  const totalSize = useMemo(
    () => queue.reduce((sum, q) => sum + q.file.size, 0),
    [queue],
  );
  const overLimit = totalSize > maxTotalBytes;

  /** A required option is satisfied when it has a non-empty value/file. */
  const missingRequired = useMemo(() => {
    return config.fields.some((field) => {
      if (!field.required) return false;
      if (field.type === "file") return !fieldFiles[field.name];
      return !(fieldValues[field.name] ?? "").trim();
    });
  }, [config.fields, fieldValues, fieldFiles]);

  const canRun =
    queue.length >= 1 && !running && !overLimit && !missingRequired;

  const handleRun = useCallback(async () => {
    if (!canRun) return;

    const finalName = resolveOutputName(config, outputName);
    setRunning(true);
    try {
      // PDF → Office: upload the file for a session id, then export as JSON.
      if (config.request?.kind === "uploadExport") {
        const blob = await runUploadExport(config, queue[0]?.file);
        triggerBlobDownload(blob, finalName);
        toast({ title: t("toastSuccess"), description: finalName });
        return;
      }

      const form = new FormData();

      // Uploaded file(s).
      if (isMulti) {
        for (const { file } of queue) {
          form.append(fileFieldName, file, file.name);
        }
      } else {
        const first = queue[0];
        if (first) form.append(fileFieldName, first.file, first.file.name);
      }

      // Constant wire fields.
      for (const constant of config.constants ?? []) {
        form.append(constant.name, constant.value);
      }

      // Option fields.
      for (const field of config.fields) {
        if (field.type === "file") {
          const file = fieldFiles[field.name];
          if (file) form.append(field.name, file, file.name);
          continue;
        }
        const raw = fieldValues[field.name] ?? "";
        const value = field.serialize ? field.serialize(raw) : raw;
        // Omit empty optional fields so the backend applies its defaults.
        if (value === "" && !field.required) continue;
        form.append(field.name, value);
      }

      if (config.allowOutputName) {
        form.append("outputName", finalName);
      }

      const response = await fetch(config.endpoint, {
        method: "POST",
        body: form,
      });

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

      const blob =
        config.responseKind === "splitZip"
          ? await buildSplitZip(response)
          : await response.blob();

      triggerBlobDownload(blob, finalName);
      toast({ title: t("toastSuccess"), description: finalName });
    } catch (err) {
      clientLogger.error(`tool.${config.id}.failed`, err);
      const description =
        err instanceof ToolRequestError ? err.message : undefined;
      toast({ variant: "destructive", title: t("toastError"), description });
    } finally {
      setRunning(false);
    }
  }, [
    canRun,
    config,
    outputName,
    isMulti,
    fileFieldName,
    queue,
    fieldFiles,
    fieldValues,
    t,
    toast,
  ]);

  const hasFiles = queue.length > 0;

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <button
        type="button"
        onClick={handleBrowse}
        aria-describedby={hintId}
        aria-disabled={running}
        disabled={running}
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
          {isDragging
            ? tRunner("dropNow")
            : isMulti
              ? tRunner("dropzoneLabelMulti")
              : tRunner("dropzoneLabelSingle")}
        </span>
        <span id={hintId} className="max-w-md text-sm text-muted-foreground">
          {t("formatsHint")}
        </span>
        <span className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-primary">
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          {isMulti ? tRunner("addFiles") : tRunner("chooseFile")}
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple={isMulti}
        accept={config.accept}
        className="hidden"
        onChange={handleInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* File list */}
      {hasFiles && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-lg">
                {isMulti
                  ? tRunner("fileListTitle", { count: queue.length })
                  : tRunner("selectedFile")}
              </CardTitle>
              {isMulti && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  disabled={running}
                >
                  {tRunner("clearAll")}
                </Button>
              )}
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
                    {isMulti && (
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                    )}
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
                    <div className="flex shrink-0 items-center gap-1">
                      {isMulti && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => moveFile(index, -1)}
                            disabled={running || index === 0}
                            title={tRunner("moveUp")}
                            aria-label={tRunner("moveUpFile", { name: item.file.name })}
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => moveFile(index, 1)}
                            disabled={running || index === queue.length - 1}
                            title={tRunner("moveDown")}
                            aria-label={tRunner("moveDownFile", { name: item.file.name })}
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeFile(item.id)}
                        disabled={running}
                        title={tRunner("removeFile")}
                        aria-label={tRunner("removeFileNamed", { name: item.file.name })}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>

            {isMulti && (
              <div
                className={`flex items-center justify-between pt-1 text-xs ${
                  overLimit ? "text-destructive" : "text-muted-foreground"
                }`}
                aria-live="polite"
              >
                <span>{tRunner("totalSize", { size: formatBytes(totalSize) })}</span>
                {overLimit && (
                  <span>
                    {tRunner("overLimit", {
                      max: `${Math.round(maxTotalBytes / (1024 * 1024))} MB`,
                    })}
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Options + action */}
      {hasFiles && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            {config.fields.length > 0 && (
              <div className="space-y-4">
                {config.fields.map((field) => (
                  <ToolFieldControl
                    key={field.name}
                    field={field}
                    disabled={running}
                    value={fieldValues[field.name] ?? ""}
                    file={fieldFiles[field.name] ?? null}
                    onValueChange={setFieldValue}
                    onFileChange={setFieldFile}
                    t={t}
                  />
                ))}
              </div>
            )}

            {config.allowOutputName && (
              <div className="space-y-1.5">
                <Label htmlFor={`${config.id}-output-name`}>
                  {tRunner("outputNameLabel")}
                </Label>
                <Input
                  id={`${config.id}-output-name`}
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  placeholder={config.defaultOutputName}
                  disabled={running}
                  autoComplete="off"
                />
              </div>
            )}

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

/** Build a single ZIP Blob from a `splitZip` JSON response. */
async function buildSplitZip(response: Response): Promise<Blob> {
  const json = (await response.json()) as SplitPartsResponse;
  const parts = json.data?.parts ?? [];
  const entries: Zippable = {};
  parts.forEach((part, index) => {
    const name = part.filename?.trim() || `part-${index + 1}.pdf`;
    entries[name] = part.data ? base64ToBytes(part.data) : strToU8("");
  });
  const zipped = zipSync(entries, { level: 0 });
  // Copy into a fresh ArrayBuffer-backed view so Blob accepts it under
  // noUncheckedIndexedAccess strictness.
  return new Blob([new Uint8Array(zipped)], { type: "application/zip" });
}

/** Carries a server-supplied message so the toast can surface it to the user. */
class ToolRequestError extends Error {}

/** Pull the best human-readable error out of a non-OK JSON response. */
async function errorMessageFrom(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; detail?: string };
    return data.error ?? data.detail ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * PDF → Office, two-step chain:
 *   1. Upload the PDF to the session endpoint for a `document_id`.
 *   2. POST `{ documentId, ...constants }` as JSON to the export endpoint.
 * Both calls carry the Better Auth Bearer token (the export route forwards it
 * to the Python backend). Throws {@link ToolRequestError} on failure so the
 * caller can surface the message.
 */
async function runUploadExport(config: ToolConfig, file: File | undefined): Promise<Blob> {
  const settings = config.request?.uploadExport;
  if (!settings || !file) {
    throw new ToolRequestError("Missing file or upload configuration.");
  }

  const token = await getAuthToken();
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  // Step 1 — upload for a session document id.
  const uploadForm = new FormData();
  uploadForm.append(settings.uploadFileField ?? "file", file, file.name);

  const uploadResponse = await fetch(settings.uploadEndpoint, {
    method: "POST",
    headers: authHeaders,
    body: uploadForm,
    credentials: "include",
  });
  if (!uploadResponse.ok) {
    throw new ToolRequestError(await errorMessageFrom(uploadResponse, "Upload failed."));
  }
  const uploaded = (await uploadResponse.json()) as {
    data?: { document_id?: string };
    document_id?: string;
  };
  const documentId = uploaded.data?.document_id ?? uploaded.document_id;
  if (!documentId) {
    throw new ToolRequestError("Upload did not return a document id.");
  }

  // Step 2 — export the uploaded document to the requested Office format.
  const exportBody: Record<string, unknown> = {
    [settings.documentIdField ?? "documentId"]: documentId,
  };
  for (const constant of config.constants ?? []) {
    exportBody[constant.name] = constant.value;
  }

  const exportResponse = await fetch(config.endpoint, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(exportBody),
    credentials: "include",
  });
  if (!exportResponse.ok) {
    throw new ToolRequestError(await errorMessageFrom(exportResponse, "Conversion failed."));
  }
  return exportResponse.blob();
}
