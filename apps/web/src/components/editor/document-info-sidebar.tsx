"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Info, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@giga-pdf/ui";
import type { BookmarkObject, Element, LayerObject, EmbeddedFileObject } from "@giga-pdf/types";
import { cn } from "@/lib/utils";
import { TOCPanel } from "./toc-panel";
import { LayersPanel } from "./layers-panel";
import { EmbeddedFilesPanel } from "./embedded-files-panel";

interface DocumentInfoSidebarProps {
  outlines: BookmarkObject[];
  layers: LayerObject[];
  /**
   * Calques utilisateur (Phase 2 "Layer Groups") — éditables, forwardés au
   * LayersPanel. Distincts des OCG `layers` (lecture seule).
   */
  userLayers?: LayerObject[];
  /** Éléments de la page courante — listés comme calques (œil/cadenas) */
  elements: Element[];
  /** IDs des éléments sélectionnés sur le canvas */
  selectedElementIds?: string[];
  embeddedFiles: EmbeddedFileObject[];
  onNavigateToPage?: (pageNumber: number, position?: { x: number; y: number } | null) => void;
  onElementVisibilityChange?: (elementId: string, visible: boolean) => void;
  onElementLockChange?: (elementId: string, locked: boolean) => void;
  /** Sélectionner un élément en cliquant sa ligne dans le panneau calques. */
  onElementSelect?: (elementId: string) => void;
  /** Sélectionner sur le canvas tous les membres d'un calque (clic ligne-calque). */
  onLayerSelectMembers?: (elementIds: string[]) => void;
  // User-layer actions (Phase 2) forwardés au LayersPanel.
  onLayerCreate?: () => void;
  onLayerDelete?: (layerId: string) => void;
  onLayerRename?: (layerId: string, name: string) => void;
  onLayerReorder?: (layerId: string, newOrder: number) => void;
  onLayerVisibilityChange?: (layerId: string, visible: boolean) => void;
  onLayerLockChange?: (layerId: string, locked: boolean) => void;
  onAssignElementToLayer?: (elementId: string, layerId: string | null) => void;
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
  userLayers,
  elements,
  selectedElementIds,
  embeddedFiles,
  onNavigateToPage,
  onElementVisibilityChange,
  onElementLockChange,
  onElementSelect,
  onLayerSelectMembers,
  onLayerCreate,
  onLayerDelete,
  onLayerRename,
  onLayerReorder,
  onLayerVisibilityChange,
  onLayerLockChange,
  onAssignElementToLayer,
  onDownloadFile,
  currentPageIndex,
  className,
}: DocumentInfoSidebarProps) {
  const t = useTranslations("editor");
  const [collapsed, setCollapsed] = useState(false);

  // Check if there's any content to show — elements included so the layers
  // panel (visibility/lock toggles) is reachable even without TOC/OCG/files.
  // The user-layers section ("+" button) is enough on its own when wired.
  const hasContent =
    outlines.length > 0 ||
    layers.length > 0 ||
    embeddedFiles.length > 0 ||
    elements.length > 0 ||
    Boolean(onLayerCreate);

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

          {/* Calques (éléments de la page + groupes OCG en lecture seule) */}
          <LayersPanel
            elements={elements}
            layers={layers}
            userLayers={userLayers}
            selectedElementIds={selectedElementIds}
            onElementVisibilityChange={onElementVisibilityChange}
            onElementLockChange={onElementLockChange}
            onElementSelect={onElementSelect}
            onLayerSelectMembers={onLayerSelectMembers}
            onLayerCreate={onLayerCreate}
            onLayerDelete={onLayerDelete}
            onLayerRename={onLayerRename}
            onLayerReorder={onLayerReorder}
            onLayerVisibilityChange={onLayerVisibilityChange}
            onLayerLockChange={onLayerLockChange}
            onAssignElementToLayer={onAssignElementToLayer}
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
