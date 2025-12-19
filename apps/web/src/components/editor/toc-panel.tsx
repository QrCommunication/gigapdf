"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, ChevronRight, ChevronDown, FileText } from "lucide-react";
import type { BookmarkObject } from "@giga-pdf/types";
import { cn } from "@/lib/utils";

interface TOCPanelProps {
  outlines: BookmarkObject[];
  onNavigateToPage?: (pageNumber: number, position?: { x: number; y: number } | null) => void;
  currentPageIndex?: number;
  className?: string;
}

interface BookmarkItemProps {
  bookmark: BookmarkObject;
  level: number;
  onNavigateToPage?: (pageNumber: number, position?: { x: number; y: number } | null) => void;
  currentPageIndex?: number;
}

function BookmarkItem({ bookmark, level, onNavigateToPage, currentPageIndex }: BookmarkItemProps) {
  const [expanded, setExpanded] = useState(level < 2); // Auto-expand first 2 levels
  const hasChildren = bookmark.children && bookmark.children.length > 0;
  const isCurrentPage = currentPageIndex !== undefined && bookmark.destination.pageNumber === currentPageIndex + 1;

  const handleClick = useCallback(() => {
    if (onNavigateToPage) {
      onNavigateToPage(bookmark.destination.pageNumber, bookmark.destination.position);
    }
  }, [bookmark.destination, onNavigateToPage]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  }, [expanded]);

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-1 py-1 px-2 rounded-md cursor-pointer",
          "hover:bg-accent transition-colors",
          isCurrentPage && "bg-primary/10 text-primary font-medium"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        {hasChildren ? (
          <button
            onClick={handleToggle}
            className="p-0.5 hover:bg-accent rounded"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />

        <span
          className={cn(
            "flex-1 truncate text-sm",
            bookmark.style.bold && "font-bold",
            bookmark.style.italic && "italic"
          )}
          style={{ color: bookmark.style.color || undefined }}
          title={`${bookmark.title} (Page ${bookmark.destination.pageNumber})`}
        >
          {bookmark.title}
        </span>

        <span className="text-xs text-muted-foreground flex-shrink-0">
          {bookmark.destination.pageNumber}
        </span>
      </div>

      {hasChildren && expanded && (
        <div>
          {bookmark.children.map((child, index) => (
            <BookmarkItem
              key={child.bookmarkId || index}
              bookmark={child}
              level={level + 1}
              onNavigateToPage={onNavigateToPage}
              currentPageIndex={currentPageIndex}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Panneau de la table des matières (TOC) - Navigation par signets.
 */
export function TOCPanel({
  outlines,
  onNavigateToPage,
  currentPageIndex,
  className,
}: TOCPanelProps) {
  const t = useTranslations("editor.toc");
  const [expanded, setExpanded] = useState(true);

  if (outlines.length === 0) {
    return null;
  }

  // Count total bookmarks recursively
  const countBookmarks = (bookmarks: BookmarkObject[]): number => {
    return bookmarks.reduce((acc, b) => acc + 1 + countBookmarks(b.children || []), 0);
  };
  const totalCount = countBookmarks(outlines);

  return (
    <div className={cn("border-b", className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          <span>{t("title")}</span>
          <span className="text-xs text-muted-foreground">({totalCount})</span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="pb-2 max-h-64 overflow-y-auto">
          {outlines.map((bookmark, index) => (
            <BookmarkItem
              key={bookmark.bookmarkId || index}
              bookmark={bookmark}
              level={0}
              onNavigateToPage={onNavigateToPage}
              currentPageIndex={currentPageIndex}
            />
          ))}
        </div>
      )}
    </div>
  );
}
