"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PageObject } from "@giga-pdf/types";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";

export interface PagesSidebarProps {
  /** Liste des pages */
  pages: PageObject[];
  /** Index de la page actuelle */
  currentPageIndex: number;
  /** Callback pour changer de page */
  onPageSelect: (pageIndex: number) => void;
  /** Callback pour ajouter une page */
  onPageAdd?: () => void;
  /** Callback pour supprimer une page */
  onPageDelete?: (pageIndex: number) => void;
  /** Callback pour réordonner les pages */
  onPageReorder?: (fromIndex: number, toIndex: number) => void;
  /** URL de base pour les previews */
  previewBaseUrl?: string;
}

/**
 * Sidebar affichant les miniatures des pages.
 */
export function PagesSidebar({
  pages,
  currentPageIndex,
  onPageSelect,
  onPageAdd,
  onPageDelete,
  onPageReorder,
  previewBaseUrl = "",
}: PagesSidebarProps) {
  const t = useTranslations("editor.pages");

  const handleMoveUp = (index: number) => {
    if (onPageReorder && index > 0) {
      onPageReorder(index, index - 1);
    }
  };

  const handleMoveDown = (index: number) => {
    if (onPageReorder && index < pages.length - 1) {
      onPageReorder(index, index + 1);
    }
  };

  return (
    <div className="pages-sidebar w-48 bg-muted/30 border-r flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="font-medium text-sm">{t("title")}</h3>
        {onPageAdd && (
          <button
            type="button"
            onClick={onPageAdd}
            title={t("add")}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <Plus size={16} />
          </button>
        )}
      </div>

      {/* Pages list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {pages.map((page, index) => (
          <div
            key={page.pageId}
            className={`
              page-thumbnail group relative cursor-pointer rounded-lg overflow-hidden border-2 transition-colors
              ${index === currentPageIndex
                ? "border-primary ring-2 ring-primary/20"
                : "border-transparent hover:border-muted-foreground/30"
              }
            `}
            onClick={() => onPageSelect(index)}
          >
            {/* Preview image */}
            <div className="aspect-[8.5/11] bg-white flex items-center justify-center">
              {page.preview?.thumbnailUrl ? (
                <img
                  src={`${previewBaseUrl}${page.preview.thumbnailUrl}`}
                  alt={`Page ${index + 1}`}
                  className="w-full h-full object-contain"
                  loading="lazy"
                />
              ) : (
                <div className="text-muted-foreground text-xs">
                  {t("pageNumber", { number: index + 1 })}
                </div>
              )}
            </div>

            {/* Page number badge */}
            <div className="absolute bottom-1 left-1 bg-background/80 px-1.5 py-0.5 rounded text-xs font-medium">
              {index + 1}
            </div>

            {/* Actions (visible on hover) */}
            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
              {onPageReorder && index > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveUp(index);
                  }}
                  title={t("moveUp")}
                  className="p-1 bg-background/80 rounded hover:bg-background"
                >
                  <ChevronUp size={12} />
                </button>
              )}
              {onPageReorder && index < pages.length - 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveDown(index);
                  }}
                  title={t("moveDown")}
                  className="p-1 bg-background/80 rounded hover:bg-background"
                >
                  <ChevronDown size={12} />
                </button>
              )}
              {onPageDelete && pages.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPageDelete(index);
                  }}
                  title={t("delete")}
                  className="p-1 bg-background/80 rounded hover:bg-destructive hover:text-destructive-foreground"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer with page count */}
      <div className="p-2 border-t text-xs text-muted-foreground text-center">
        {t("pageCount", { count: pages.length })}
      </div>
    </div>
  );
}
