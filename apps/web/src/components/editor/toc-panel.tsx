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
  Sparkles,
  Loader2,
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

/**
 * A flat, level-encoded bookmark — the exact `Bookmark` input shape the engine
 * `setBookmarks` takes (a `page` becomes a GoTo destination). Emitted by
 * {@link TOCPanelProps.onApplyBookmarks} so a host can persist the outline via
 * `POST /api/pdf/links` (action `setBookmarks`).
 */
export interface BookmarkInput {
  title: string;
  /** Nesting depth, 0 = top-level. */
  level: number;
  /** 1-based destination page (>= 1). */
  page: number;
}

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
  /**
   * Like {@link onApplyOutline} but emits the edited outline as a flat,
   * level-encoded {@link BookmarkInput}[] — the engine `setBookmarks` shape —
   * for hosts that persist via `POST /api/pdf/links`. Fired alongside
   * `onApplyOutline`; providing either enables edit mode.
   */
  onApplyBookmarks?: (bookmarks: BookmarkInput[]) => void;
  /**
   * Detect chapters from the document's headings when it ships no embedded
   * outline. The host fetches `POST /api/pdf/structure` (action `detect`) with
   * the current PDF and resolves the flat, level-encoded chapter list. When
   * provided, the panel surfaces a "detect chapters" affordance on an
   * outline-less document and renders the result as a navigable list that can be
   * baked into real bookmarks (via {@link onApplyOutline}/{@link onApplyBookmarks}).
   */
  onDetectChapters?: () => Promise<BookmarkInput[]>;
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
  /** Receives both the rebuilt tree and the edited flat list (for `setBookmarks`). */
  onSave: (outline: BookmarkObject[], flat: FlatBookmark[]) => void;
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
          onClick={() => onSave(flatToTree(flat), flat)}
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
  onApplyBookmarks,
  onDetectChapters,
  pageCount,
  className,
}: TOCPanelProps) {
  const t = useTranslations("editor.toc");
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  // Chapter detection (outline-less documents): `null` = not yet detected,
  // `[]` = detected but nothing found, otherwise the navigable preview list.
  const [detected, setDetected] = useState<BookmarkInput[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectFailed, setDetectFailed] = useState(false);

  const canEdit = Boolean(onApplyOutline) || Boolean(onApplyBookmarks);
  const canDetect = Boolean(onDetectChapters);

  // Reset transient edit/detect state whenever the document outline changes
  // underneath us (e.g. a bake reload repopulates `outlines`) so we never edit
  // or preview a stale snapshot.
  useEffect(() => {
    setEditing(false);
    setDetected(null);
    setDetecting(false);
    setDetectFailed(false);
  }, [outlines]);

  const totalCount = useMemo(() => {
    const countBookmarks = (bookmarks: BookmarkObject[]): number =>
      bookmarks.reduce((acc, b) => acc + 1 + countBookmarks(b.children || []), 0);
    return countBookmarks(outlines);
  }, [outlines]);

  const handleDetect = useCallback(async () => {
    if (!onDetectChapters) return;
    setDetecting(true);
    setDetectFailed(false);
    try {
      setDetected(await onDetectChapters());
    } catch {
      setDetected(null);
      setDetectFailed(true);
    } finally {
      setDetecting(false);
    }
  }, [onDetectChapters]);

  // Bake detected chapters through the same pipeline as the manual editor: a
  // flat, level-encoded list rebuilt into a tree for `onApplyOutline` and passed
  // straight to `onApplyBookmarks` (both already the persistence contract).
  const handleSaveDetected = useCallback(() => {
    if (!detected || detected.length === 0) return;
    const flat: FlatBookmark[] = detected.map((c, i) => ({
      id: `detected-${i}`,
      title: c.title,
      page: c.page,
      level: c.level,
    }));
    onApplyOutline?.(flatToTree(flat));
    onApplyBookmarks?.(detected);
    setDetected(null);
  }, [detected, onApplyOutline, onApplyBookmarks]);

  // Hide entirely only when there is nothing to show AND no way to add or
  // detect one.
  if (outlines.length === 0 && !canEdit && !canDetect) {
    return null;
  }

  const handleSave = (next: BookmarkObject[], flat: FlatBookmark[]) => {
    onApplyOutline?.(next);
    onApplyBookmarks?.(
      flat.map((b) => ({ title: b.title, level: b.level, page: b.page })),
    );
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
          {outlines.length > 0 ? (
            outlines.map((bookmark, index) => (
              <BookmarkItem
                key={bookmark.bookmarkId || index}
                bookmark={bookmark}
                level={0}
                onNavigateToPage={onNavigateToPage}
                currentPageIndex={currentPageIndex}
              />
            ))
          ) : detected && detected.length > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 px-3 pt-1 pb-0.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">{t("detectedTitle")}</span>
                <span className="text-xs text-muted-foreground">({detected.length})</span>
              </div>
              <div>
                {detected.map((chapter, index) => (
                  <button
                    key={`${index}-${chapter.page}`}
                    type="button"
                    onClick={() => onNavigateToPage?.(chapter.page)}
                    className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left hover:bg-accent transition-colors"
                    style={{ paddingLeft: `${chapter.level * 12 + 8}px` }}
                    title={`${chapter.title} (Page ${chapter.page})`}
                  >
                    <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">{chapter.title}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {chapter.page}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 px-2 pt-1">
                {canEdit && (
                  <button
                    type="button"
                    onClick={handleSaveDetected}
                    className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                  >
                    <Check className="h-3 w-3" />
                    {t("saveAsBookmarks")}
                  </button>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={handleDetect}
                  disabled={detecting}
                  className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {t("redetect")}
                </button>
                <button
                  type="button"
                  onClick={() => setDetected(null)}
                  className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
                >
                  {t("clearDetected")}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {detected ? t("detectEmpty") : canDetect ? t("detectHint") : t("emptyEdit")}
              </p>
              {canDetect && (
                <button
                  type="button"
                  onClick={handleDetect}
                  disabled={detecting}
                  className="flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {detecting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {detecting ? t("detecting") : detected ? t("redetect") : t("detectChapters")}
                </button>
              )}
              {detectFailed && (
                <p className="text-xs text-destructive">{t("detectError")}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
