"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Paperclip, Download, ChevronRight, ChevronDown, FileText, FileImage, FileArchive, FileAudio, FileVideo, File } from "lucide-react";
import { Button } from "@giga-pdf/ui";
import type { EmbeddedFileObject } from "@giga-pdf/types";
import { cn } from "@/lib/utils";

interface EmbeddedFilesPanelProps {
  files: EmbeddedFileObject[];
  onDownload?: (file: EmbeddedFileObject) => void;
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
  return File;
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
 * Panneau des fichiers embarqués - Liste et téléchargement des pièces jointes.
 */
export function EmbeddedFilesPanel({
  files,
  onDownload,
  className,
}: EmbeddedFilesPanelProps) {
  const t = useTranslations("editor.attachments");
  const [expanded, setExpanded] = useState(true);

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

  if (files.length === 0) {
    return null;
  }

  // Calculate total size
  const totalSize = files.reduce((acc, file) => acc + file.sizeBytes, 0);

  return (
    <div className={cn("border-b", className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4" />
          <span>{t("title")}</span>
          <span className="text-xs text-muted-foreground">
            ({files.length} - {formatFileSize(totalSize)})
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-1 max-h-64 overflow-y-auto">
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
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
