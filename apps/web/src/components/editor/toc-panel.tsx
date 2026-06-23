"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  ChevronRight,
  ChevronDown,
  FileText,
  Pencil,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown as ChevronDownIcon,
  IndentIncrease,
  IndentDecrease,
  Check,
} from "lucide-react";
import type { BookmarkObject } from "@giga-pdf/types";
import { cn } from "@/lib/utils";
import {
  treeToFlat,
  flatToTree,
  insertBookmark,
  removeBookmark,
  renameBookmark,
  moveBookmark,
  reindentBookmark,
  type FlatBookmark,
} from "./lib/outline-edit";

interface TOCPanelProps {
  outlines: BookmarkObject[];
  onNavigateToPage?: (pageNumber: number, position?: { x: number; y: number } | null) => void;
  currentPageIndex?: number;
  /**
   * When provided, the panel exposes an edit mode (add / rename / delete /
   * reorder / indent) and calls this with the edited tree to bake it. Omitted
   * (read-only viewers) ⇒ navigation-only, identical to the legacy behaviour.
   */
  onApplyOutline?: (outline: BookmarkObject[]) => void;
  /** Number of pages — bounds the destination page input in edit mode. */
  pageCount?: number;
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

interface OutlineEditorProps {
  initial: BookmarkObject[];
  currentPageIndex?: number;
  pageCount?: number;
  onCancel: () => void;
  onSave: (outline: BookmarkObject[]) => void;
}

/** Flat, level-encoded outline editor (add / rename / delete / move / indent). */
function OutlineEditor({ initial, currentPageIndex, pageCount, onCancel, onSave }: OutlineEditorProps) {
  const t = useTranslations("editor.toc");
  const [flat, setFlat] = useState<FlatBookmark[]>(() => treeToFlat(initial));

  const clampPage = useCallback(
    (page: number): number => {
      const max = pageCount && pageCount > 0 ? pageCount : Number.MAX_SAFE_INTEGER;
      return Math.max(1, Math.min(page, max));
    },
    [pageCount],
  );

  const handleAdd = () => {
    const page = clampPage((currentPageIndex ?? 0) + 1);
    setFlat((prev) => insertBookmark(prev, page, t("newBookmark")));
  };

  const handleSetPage = (id: string, raw: string) => {
    const page = clampPage(Number(raw) || 1);
    setFlat((prev) => prev.map((b) => (b.id === id ? { ...b, page } : b)));
  };

  return (
    <div className="pb-2 px-2 space-y-2">
      <div className="max-h-64 overflow-y-auto space-y-1">
        {flat.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t("emptyEdit")}</p>
        )}
        {flat.map((b) => (
          <div
            key={b.id}
            className="flex items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1"
            style={{ marginLeft: `${b.level * 12}px` }}
          >
            <input
              type="text"
              value={b.title}
              onChange={(e) => setFlat((prev) => renameBookmark(prev, b.id, e.target.value))}
              placeholder={t("titlePlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <input
              type="number"
              min={1}
              max={pageCount && pageCount > 0 ? pageCount : undefined}
              value={b.page}
              onChange={(e) => handleSetPage(b.id, e.target.value)}
              title={t("destinationPage")}
              className="w-12 rounded border border-input bg-background px-1 py-0.5 text-xs text-center"
            />
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setFlat((prev) => reindentBookmark(prev, b.id, -1))}
                title={t("outdent")}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                <IndentDecrease className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setFlat((prev) => reindentBookmark(prev, b.id, 1))}
                title={t("indent")}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                <IndentIncrease className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setFlat((prev) => moveBookmark(prev, b.id, -1))}
                title={t("moveUp")}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setFlat((prev) => moveBookmark(prev, b.id, 1))}
                title={t("moveDown")}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                <ChevronDownIcon className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setFlat((prev) => removeBookmark(prev, b.id))}
                title={t("deleteBookmark")}
                className="p-1 rounded hover:bg-destructive hover:text-destructive-foreground text-muted-foreground"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-input hover:bg-muted"
        >
          <Plus className="h-3 w-3" />
          {t("addBookmark")}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 text-xs rounded-md border border-input hover:bg-muted"
        >
          {t("cancelEdit")}
        </button>
        <button
          type="button"
          onClick={() => onSave(flatToTree(flat))}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Check className="h-3 w-3" />
          {t("saveEdit")}
        </button>
      </div>
    </div>
  );
}

/**
 * Panneau de la table des matières (TOC) — navigation par signets, et édition
 * (ajout / renommage / suppression / réordonnancement / indentation) quand
 * `onApplyOutline` est fourni.
 */
export function TOCPanel({
  outlines,
  onNavigateToPage,
  currentPageIndex,
  onApplyOutline,
  pageCount,
  className,
}: TOCPanelProps) {
  const t = useTranslations("editor.toc");
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);

  const canEdit = Boolean(onApplyOutline);

  // Leaving edit mode whenever the document outline changes underneath us
  // (e.g. a bake reload) avoids editing a stale snapshot.
  useEffect(() => {
    setEditing(false);
  }, [outlines]);

  const totalCount = useMemo(() => {
    const countBookmarks = (bookmarks: BookmarkObject[]): number =>
      bookmarks.reduce((acc, b) => acc + 1 + countBookmarks(b.children || []), 0);
    return countBookmarks(outlines);
  }, [outlines]);

  // Hide entirely only when there is nothing to show AND no way to add one.
  if (outlines.length === 0 && !canEdit) {
    return null;
  }

  const handleSave = (next: BookmarkObject[]) => {
    onApplyOutline?.(next);
    setEditing(false);
  };

  return (
    <div className={cn("border-b", className)}>
      <div className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <BookOpen className="h-4 w-4" />
          <span>{t("title")}</span>
          <span className="text-xs text-muted-foreground">({totalCount})</span>
        </button>
        <div className="flex items-center gap-1">
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setExpanded(true);
              }}
              title={t("edit")}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)} className="p-0.5">
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {expanded && editing && canEdit && (
        <OutlineEditor
          initial={outlines}
          currentPageIndex={currentPageIndex}
          pageCount={pageCount}
          onCancel={() => setEditing(false)}
          onSave={handleSave}
        />
      )}

      {expanded && !editing && (
        <div className="pb-2 max-h-64 overflow-y-auto">
          {outlines.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("emptyEdit")}</p>
          ) : (
            outlines.map((bookmark, index) => (
              <BookmarkItem
                key={bookmark.bookmarkId || index}
                bookmark={bookmark}
                level={0}
                onNavigateToPage={onNavigateToPage}
                currentPageIndex={currentPageIndex}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
