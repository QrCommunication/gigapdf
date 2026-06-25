"use client";

import { useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Paperclip,
  Download,
  ChevronRight,
  ChevronDown,
  FileText,
  FileImage,
  FileArchive,
  FileAudio,
  FileVideo,
  File as FileIcon,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import { Button } from "@giga-pdf/ui";
import type { EmbeddedFileObject } from "@giga-pdf/types";
import { cn } from "@/lib/utils";

interface EmbeddedFilesPanelProps {
  files: EmbeddedFileObject[];
  onDownload?: (file: EmbeddedFileObject) => void;
  /**
   * Embed one or more files as document attachments. When provided, the panel
   * surfaces an "add" control (and renders even with zero existing files). The
   * actual upload + document mutation is owned by the editor page.
   */
  onAddFiles?: (files: File[]) => void | Promise<void>;
  /** Remove an existing attachment. When provided, each row shows a delete button. */
  onRemoveFile?: (file: EmbeddedFileObject) => void | Promise<void>;
  /** True while an add/remove network operation is in flight (disables actions). */
  busy?: boolean;
  className?: string;
}

/**
 * Get icon based on MIME type
 */
function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("audio/")) return FileAudio;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.startsWith("text/")) return FileText;
  if (mimeType.includes("pdf")) return FileText;
  if (mimeType.includes("zip") || mimeType.includes("rar") || mimeType.includes("tar") || mimeType.includes("gz")) return FileArchive;
  return FileIcon;
}

/**
 * Format file size in human readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Panneau des fichiers embarqués - Liste, téléchargement, ajout et suppression
 * des pièces jointes (y compris les fichiers associés Factur-X / ZUGFeRD).
 */
export function EmbeddedFilesPanel({
  files,
  onDownload,
  onAddFiles,
  onRemoveFile,
  busy = false,
  className,
}: EmbeddedFilesPanelProps) {
  const t = useTranslations("editor.attachments");
  const [expanded, setExpanded] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canManage = Boolean(onAddFiles);

  const handleDownload = useCallback((file: EmbeddedFileObject) => {
    if (onDownload) {
      onDownload(file);
    } else if (file.dataUrl) {
      // Default download behavior
      const link = document.createElement("a");
      link.href = file.dataUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [onDownload]);

  const handleAddClick = useCallback(() => {
    if (busy) return;
    fileInputRef.current?.click();
  }, [busy]);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(event.target.files ?? []);
      // Reset so picking the same file again re-fires onChange.
      event.target.value = "";
      if (picked.length > 0 && onAddFiles) {
        void onAddFiles(picked);
      }
    },
    [onAddFiles],
  );

  // Read-only with no attachments: render nothing (legacy behaviour). When the
  // panel can manage attachments, it stays visible so the "add" control is
  // reachable even on a document with no attachments yet.
  if (files.length === 0 && !canManage) {
    return null;
  }

  // Calculate total size
  const totalSize = files.reduce((acc, file) => acc + file.sizeBytes, 0);

  return (
    <div className={cn("border-b", className)}>
      <div className="flex items-center justify-between w-full pr-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between flex-1 px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            <span>{t("title")}</span>
            {files.length > 0 && (
              <span className="text-xs text-muted-foreground">
                ({files.length} - {formatFileSize(totalSize)})
              </span>
            )}
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleAddClick}
            disabled={busy}
            title={t("add")}
            aria-label={t("add")}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {canManage && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
      )}

      {expanded && (
        <div className="px-2 pb-2 space-y-1 max-h-64 overflow-y-auto">
          {files.length === 0 && canManage && (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t("empty")}</p>
          )}

          {files.map((file) => {
            const Icon = getFileIcon(file.mimeType);
            return (
              <div
                key={file.fileId}
                className={cn(
                  "flex items-center gap-2 px-2 py-2 rounded-md",
                  "hover:bg-accent transition-colors group"
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0 text-muted-foreground" />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.sizeBytes)}
                    {file.description && ` • ${file.description}`}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleDownload(file)}
                  title={t("download")}
                  aria-label={t("download")}
                >
                  <Download className="h-4 w-4" />
                </Button>

                {onRemoveFile && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                    onClick={() => void onRemoveFile(file)}
                    disabled={busy}
                    title={t("remove")}
                    aria-label={t("remove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
