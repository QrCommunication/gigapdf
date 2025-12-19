"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Info, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@giga-pdf/ui";
import type { BookmarkObject, LayerObject, EmbeddedFileObject } from "@giga-pdf/types";
import { cn } from "@/lib/utils";
import { TOCPanel } from "./toc-panel";
import { LayersPanel } from "./layers-panel";
import { EmbeddedFilesPanel } from "./embedded-files-panel";

interface DocumentInfoSidebarProps {
  outlines: BookmarkObject[];
  layers: LayerObject[];
  embeddedFiles: EmbeddedFileObject[];
  onNavigateToPage?: (pageNumber: number, position?: { x: number; y: number } | null) => void;
  onLayerVisibilityChange?: (layerId: string, visible: boolean) => void;
  onLayerLockChange?: (layerId: string, locked: boolean) => void;
  onDownloadFile?: (file: EmbeddedFileObject) => void;
  currentPageIndex?: number;
  className?: string;
}

/**
 * Barre latérale d'information du document.
 * Affiche la table des matières, les calques et les fichiers embarqués.
 */
export function DocumentInfoSidebar({
  outlines,
  layers,
  embeddedFiles,
  onNavigateToPage,
  onLayerVisibilityChange,
  onLayerLockChange,
  onDownloadFile,
  currentPageIndex,
  className,
}: DocumentInfoSidebarProps) {
  const t = useTranslations("editor");
  const [collapsed, setCollapsed] = useState(false);

  // Check if there's any content to show
  const hasContent = outlines.length > 0 || layers.length > 0 || embeddedFiles.length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <aside
      className={cn(
        "border-l bg-background flex flex-col transition-all duration-300",
        collapsed ? "w-10" : "w-64",
        className
      )}
    >
      {/* Header with toggle */}
      <div className="flex items-center justify-between px-2 py-2 border-b">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            <span className="text-sm font-medium">{t("documentInfo")}</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? t("expand") : t("collapse")}
        >
          {collapsed ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          {/* Table des matières */}
          <TOCPanel
            outlines={outlines}
            onNavigateToPage={onNavigateToPage}
            currentPageIndex={currentPageIndex}
          />

          {/* Calques */}
          <LayersPanel
            layers={layers}
            onLayerVisibilityChange={onLayerVisibilityChange}
            onLayerLockChange={onLayerLockChange}
          />

          {/* Fichiers embarqués */}
          <EmbeddedFilesPanel
            files={embeddedFiles}
            onDownload={onDownloadFile}
          />
        </div>
      )}

      {collapsed && (
        <div className="flex-1 flex flex-col items-center py-4 gap-4">
          {outlines.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCollapsed(false)}
              title={t("toc.title")}
            >
              <Info className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
