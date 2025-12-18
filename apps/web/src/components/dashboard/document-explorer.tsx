"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ToggleGroup,
  ToggleGroupItem,
} from "@giga-pdf/ui";
import { Grid3X3, List, FolderPlus, Loader2 } from "lucide-react";
import { DocumentGrid } from "./document-grid";
import { DocumentTable, SortField, SortDirection } from "./document-table";
import { FolderBreadcrumb, BreadcrumbFolder } from "./folder-breadcrumb";
import { api } from "@/lib/api";

export type ViewMode = "grid" | "list";

interface Document {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  folderId?: string | null;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FolderStats {
  total_size_bytes: number;
  document_count: number;
  folder_count: number;
}

interface DocumentExplorerProps {
  documents: Document[];
  folders: Folder[];
  currentFolderId: string | null;
  breadcrumbPath: BreadcrumbFolder[];
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  onViewModeChange: (mode: ViewMode) => void;
  onSortChange: (field: SortField, direction: SortDirection) => void;
  onFolderNavigate: (folderId: string | null) => void;
  onRefresh: () => void;
  onCreateFolder?: (name: string, parentId: string | null) => Promise<void>;
}

// Drag types for DnD
type DragItemType = "document" | "folder";

interface DragItem {
  type: DragItemType;
  id: string;
  name: string;
}

export function DocumentExplorer({
  documents,
  folders,
  currentFolderId,
  breadcrumbPath,
  viewMode,
  sortField,
  sortDirection,
  onViewModeChange,
  onSortChange,
  onFolderNavigate,
  onRefresh,
  onCreateFolder,
}: DocumentExplorerProps) {
  const t = useTranslations("documents.explorer");
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderStats, setFolderStats] = useState<Record<string, FolderStats>>({});
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  // Load folder stats for current folders
  useEffect(() => {
    const loadFolderStats = async () => {
      const currentFolders = folders.filter(
        (folder) => folder.parentId === currentFolderId && folder.id
      );

      if (currentFolders.length === 0) {
        setFolderStats({});
        return;
      }

      const statsPromises = currentFolders.map(async (folder) => {
        try {
          const stats = await api.getFolderStats(folder.id);
          return { id: folder.id, stats };
        } catch (error) {
          console.warn(`Failed to load stats for folder ${folder.id}:`, error);
          return { id: folder.id, stats: null };
        }
      });

      const results = await Promise.all(statsPromises);
      const newStats: Record<string, FolderStats> = {};
      results.forEach(({ id, stats }) => {
        if (stats) {
          newStats[id] = stats;
        }
      });
      setFolderStats(newStats);
    };

    loadFolderStats();
  }, [folders, currentFolderId]);

  // Sort documents and folders
  const sortedDocuments = [...documents].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "size":
        comparison = a.size - b.size;
        break;
      case "createdAt":
        comparison = a.createdAt.getTime() - b.createdAt.getTime();
        break;
      case "updatedAt":
        comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
        break;
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });

  const sortedFolders = [...folders].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "createdAt":
        comparison = a.createdAt.getTime() - b.createdAt.getTime();
        break;
      case "updatedAt":
        comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
        break;
      default:
        comparison = a.name.localeCompare(b.name);
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      onSortChange(field, sortDirection === "asc" ? "desc" : "asc");
    } else {
      onSortChange(field, "asc");
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    try {
      setCreatingFolder(true);
      await onCreateFolder?.(newFolderName.trim(), currentFolderId);
      setNewFolderDialogOpen(false);
      setNewFolderName("");
      onRefresh();
    } catch (err) {
      console.error("Failed to create folder:", err);
    } finally {
      setCreatingFolder(false);
    }
  };

  // Drag and Drop handlers
  const handleDragStart = useCallback((item: DragItem) => {
    setDraggedItem(item);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDragOverFolderId(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();

    // Don't allow dropping onto self if dragging a folder
    if (draggedItem?.type === "folder" && draggedItem.id === folderId) {
      return;
    }

    setDragOverFolderId(folderId);
  }, [draggedItem]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only clear if leaving to a non-child element
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragOverFolderId(null);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedItem || moving) return;

    // Don't drop onto self
    if (draggedItem.type === "folder" && draggedItem.id === targetFolderId) {
      setDragOverFolderId(null);
      return;
    }

    // Don't drop if already in this folder
    if (draggedItem.type === "document") {
      const doc = documents.find(d => d.id === draggedItem.id);
      if (doc && (doc.folderId || null) === targetFolderId) {
        setDragOverFolderId(null);
        return;
      }
    } else if (draggedItem.type === "folder") {
      const folder = folders.find(f => f.id === draggedItem.id);
      if (folder && folder.parentId === targetFolderId) {
        setDragOverFolderId(null);
        return;
      }
    }

    try {
      setMoving(true);

      if (draggedItem.type === "document") {
        await api.moveDocument(draggedItem.id, targetFolderId);
      } else if (draggedItem.type === "folder") {
        await api.moveFolder(draggedItem.id, targetFolderId);
      }

      onRefresh();
    } catch (error) {
      console.error("Failed to move item:", error);
    } finally {
      setMoving(false);
      setDraggedItem(null);
      setDragOverFolderId(null);
    }
  }, [draggedItem, moving, documents, folders, onRefresh]);

  // Filter documents and folders for current folder
  const currentDocuments = documents.filter(
    (doc) => (doc.folderId || null) === currentFolderId
  );
  const currentFolders = folders.filter(
    (folder) => folder.parentId === currentFolderId
  );

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Breadcrumb - also a drop target for moving to parent folders */}
        <div
          className={`transition-colors rounded-lg ${
            draggedItem && dragOverFolderId === "breadcrumb-root"
              ? "bg-primary/20 ring-2 ring-primary"
              : ""
          }`}
          onDragOver={(e) => {
            if (draggedItem) {
              e.preventDefault();
              setDragOverFolderId("breadcrumb-root");
            }
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            if (dragOverFolderId === "breadcrumb-root") {
              setDragOverFolderId(null);
            }
          }}
          onDrop={(e) => handleDrop(e, null)}
        >
          <FolderBreadcrumb
            folders={breadcrumbPath}
            onNavigate={onFolderNavigate}
            draggedItem={draggedItem}
            onDrop={(folderId) => {
              const syntheticEvent = { preventDefault: () => {}, stopPropagation: () => {} } as React.DragEvent;
              handleDrop(syntheticEvent, folderId);
            }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNewFolderDialogOpen(true)}
          >
            <FolderPlus className="h-4 w-4 mr-2" />
            {t("newFolder")}
          </Button>

          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(value) => value && onViewModeChange(value as ViewMode)}
          >
            <ToggleGroupItem value="grid" aria-label={t("viewGrid")}>
              <Grid3X3 className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label={t("viewList")}>
              <List className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Content */}
      {viewMode === "grid" ? (
        <div className="space-y-4">
          {/* Folders Grid */}
          {currentFolders.length > 0 && (
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {sortedFolders
                .filter((f) => f.parentId === currentFolderId)
                .map((folder) => (
                  <DraggableFolderCard
                    key={folder.id}
                    folder={folder}
                    stats={folderStats[folder.id]}
                    onClick={() => onFolderNavigate(folder.id)}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    isDraggedOver={dragOverFolderId === folder.id}
                    isDragging={draggedItem?.type === "folder" && draggedItem?.id === folder.id}
                    formatSize={formatSize}
                  />
                ))}
            </div>
          )}

          {/* Documents Grid */}
          <DocumentGrid
            documents={sortedDocuments.filter(
              (d) => (d.folderId || null) === currentFolderId
            )}
            onDelete={onRefresh}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            draggedItem={draggedItem}
          />
        </div>
      ) : (
        <DocumentTable
          documents={sortedDocuments.filter(
            (d) => (d.folderId || null) === currentFolderId
          )}
          folders={sortedFolders.filter((f) => f.parentId === currentFolderId)}
          folderStats={folderStats}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          onDelete={onRefresh}
          onFolderClick={onFolderNavigate}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOverFolderId(null)}
          onDrop={handleDrop}
          draggedItem={draggedItem}
          dragOverFolderId={dragOverFolderId}
          formatSize={formatSize}
        />
      )}

      {/* Empty State */}
      {currentDocuments.length === 0 && currentFolders.length === 0 && (
        <div
          className={`flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg transition-colors ${
            draggedItem ? "border-primary bg-primary/5" : "border-transparent"
          }`}
          onDragOver={(e) => {
            if (draggedItem) {
              e.preventDefault();
              setDragOverFolderId("empty-state");
            }
          }}
          onDragLeave={() => setDragOverFolderId(null)}
          onDrop={(e) => handleDrop(e, currentFolderId)}
        >
          <h3 className="text-lg font-semibold">{t("emptyFolder")}</h3>
          <p className="text-muted-foreground">{t("emptyFolderDescription")}</p>
          {draggedItem && (
            <p className="mt-2 text-sm text-primary">{t("dropHere") || "Drop here to move"}</p>
          )}
        </div>
      )}

      {/* Moving indicator */}
      {moving && (
        <div className="fixed inset-0 bg-background/50 flex items-center justify-center z-50">
          <div className="bg-card p-4 rounded-lg shadow-lg flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("moving") || "Moving..."}</span>
          </div>
        </div>
      )}

      {/* New Folder Dialog */}
      <Dialog open={newFolderDialogOpen} onOpenChange={setNewFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("newFolderDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("newFolderDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="folder-name">{t("newFolderDialog.label")}</Label>
            <Input
              id="folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={t("newFolderDialog.placeholder")}
              className="mt-2"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateFolder();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewFolderDialogOpen(false)}
              disabled={creatingFolder}
            >
              {t("newFolderDialog.cancel")}
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={creatingFolder || !newFolderName.trim()}
            >
              {creatingFolder ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("newFolderDialog.creating")}
                </>
              ) : (
                t("newFolderDialog.create")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Draggable Folder Card for Grid View
function DraggableFolderCard({
  folder,
  stats,
  onClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  isDraggedOver,
  isDragging,
  formatSize,
}: {
  folder: Folder;
  stats?: FolderStats;
  onClick: () => void;
  onDragStart: (item: DragItem) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, folderId: string | null) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, folderId: string | null) => void;
  isDraggedOver: boolean;
  isDragging: boolean;
  formatSize: (bytes: number) => string;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart({ type: "folder", id: folder.id, name: folder.name });
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, folder.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, folder.id)}
      onClick={onClick}
      className={`
        flex flex-col items-center gap-2 p-4 rounded-lg border bg-card
        hover:bg-accent transition-all cursor-pointer select-none
        ${isDraggedOver ? "ring-2 ring-primary bg-primary/10 scale-105" : ""}
        ${isDragging ? "opacity-50 scale-95" : ""}
      `}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={`h-12 w-12 transition-colors ${isDraggedOver ? "text-primary" : "text-yellow-500"}`}
      >
        <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
      </svg>
      <span className="text-sm font-medium truncate max-w-full">{folder.name}</span>
      {stats && (
        <span className="text-xs text-muted-foreground">
          {stats.document_count} {stats.document_count === 1 ? "doc" : "docs"} • {formatSize(stats.total_size_bytes)}
        </span>
      )}
    </div>
  );
}

// Export the DragItem type for use in other components
export type { DragItem, DragItemType, FolderStats };
