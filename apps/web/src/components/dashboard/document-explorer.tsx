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
import { Grid3X3, List, FolderPlus, Loader2, GripVertical, CheckSquare, Square, XCircle, FolderInput, Trash2 } from "lucide-react";
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

// Selection item
interface SelectionItem {
  type: "document" | "folder";
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

  // Multi-selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<SelectionItem[]>([]);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  // Clear selection when navigating
  useEffect(() => {
    setSelectedItems([]);
  }, [currentFolderId]);

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

  // Selection handlers
  const toggleItemSelection = useCallback((item: SelectionItem) => {
    setSelectedItems(prev => {
      const exists = prev.find(i => i.type === item.type && i.id === item.id);
      if (exists) {
        return prev.filter(i => !(i.type === item.type && i.id === item.id));
      } else {
        return [...prev, item];
      }
    });
  }, []);

  const isItemSelected = useCallback((type: "document" | "folder", id: string) => {
    return selectedItems.some(item => item.type === type && item.id === id);
  }, [selectedItems]);

  const selectAllInCurrentFolder = useCallback(() => {
    const currentDocs = documents.filter(d => (d.folderId || null) === currentFolderId);
    const currentFoldersItems = folders.filter(f => f.parentId === currentFolderId);

    const allItems: SelectionItem[] = [
      ...currentDocs.map(d => ({ type: "document" as const, id: d.id, name: d.name })),
      ...currentFoldersItems.map(f => ({ type: "folder" as const, id: f.id, name: f.name })),
    ];

    setSelectedItems(allItems);
  }, [documents, folders, currentFolderId]);

  const clearSelection = useCallback(() => {
    setSelectedItems([]);
    setSelectionMode(false);
  }, []);

  // Move selected items to a folder
  const moveSelectedToFolder = useCallback(async (targetFolderId: string | null) => {
    if (selectedItems.length === 0) return;

    try {
      setMoving(true);

      for (const item of selectedItems) {
        if (item.type === "document") {
          await api.moveDocument(item.id, targetFolderId);
        } else if (item.type === "folder") {
          // Don't move folder into itself
          if (item.id !== targetFolderId) {
            await api.moveFolder(item.id, targetFolderId);
          }
        }
      }

      clearSelection();
      onRefresh();
    } catch (error) {
      console.error("Failed to move items:", error);
      alert(t("errors.moveItemsFailed"));
    } finally {
      setMoving(false);
      setMoveDialogOpen(false);
    }
  }, [selectedItems, clearSelection, onRefresh]);

  // Delete selected items
  const deleteSelectedItems = useCallback(async () => {
    if (selectedItems.length === 0) return;

    try {
      setDeleting(true);

      for (const item of selectedItems) {
        if (item.type === "document") {
          await api.deleteDocument(item.id);
        } else if (item.type === "folder") {
          await api.deleteFolder(item.id);
        }
      }

      clearSelection();
      onRefresh();
    } catch (error) {
      console.error("Failed to delete items:", error);
      alert(t("errors.deleteItemsFailed"));
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }, [selectedItems, clearSelection, onRefresh]);

  // Drag and Drop handlers
  const handleDragStart = useCallback((item: DragItem) => {
    console.log("Drag started:", item);
    setDraggedItem(item);
  }, []);

  const handleDragEnd = useCallback(() => {
    console.log("Drag ended");
    setDraggedItem(null);
    setDragOverFolderId(null);
  }, []);

  const handleDragOverFolder = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    // Don't allow dropping onto self if dragging a folder
    if (draggedItem?.type === "folder" && draggedItem.id === folderId) {
      return;
    }

    if (dragOverFolderId !== folderId) {
      setDragOverFolderId(folderId);
    }
  }, [draggedItem, dragOverFolderId]);

  const handleDragLeaveFolder = useCallback(() => {
    setDragOverFolderId(null);
  }, []);

  const handleDragEnterFolder = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Don't allow dropping onto self if dragging a folder
    if (draggedItem?.type === "folder" && draggedItem.id === folderId) {
      return;
    }

    if (dragOverFolderId !== folderId) {
      setDragOverFolderId(folderId);
    }
  }, [draggedItem, dragOverFolderId]);

  const handleDropOnFolder = useCallback(async (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    e.stopPropagation();

    console.log("Drop on folder:", targetFolderId, "draggedItem:", draggedItem);
    setDragOverFolderId(null);

    if (!draggedItem || moving) {
      return;
    }

    // Don't drop onto self
    if (draggedItem.type === "folder" && draggedItem.id === targetFolderId) {
      return;
    }

    // Don't drop if already in this folder
    if (draggedItem.type === "document") {
      const doc = documents.find(d => d.id === draggedItem.id);
      if (doc && (doc.folderId || null) === targetFolderId) {
        return;
      }
    } else if (draggedItem.type === "folder") {
      const folder = folders.find(f => f.id === draggedItem.id);
      if (folder && folder.parentId === targetFolderId) {
        return;
      }
    }

    try {
      setMoving(true);
      console.log("Moving", draggedItem.type, draggedItem.id, "to folder", targetFolderId);

      if (draggedItem.type === "document") {
        await api.moveDocument(draggedItem.id, targetFolderId);
      } else if (draggedItem.type === "folder") {
        await api.moveFolder(draggedItem.id, targetFolderId);
      }

      console.log("Move successful");
      onRefresh();
    } catch (error) {
      console.error("Failed to move item:", error);
      alert(t("errors.moveItemFailed"));
    } finally {
      setMoving(false);
      setDraggedItem(null);
    }
  }, [draggedItem, moving, documents, folders, onRefresh]);

  // Filter documents and folders for current folder
  const currentDocuments = documents.filter(
    (doc) => (doc.folderId || null) === currentFolderId
  );
  const currentFolders = folders.filter(
    (folder) => folder.parentId === currentFolderId
  );

  // Get available folders for move dialog (exclude current folder and selected folders)
  const availableFoldersForMove = folders.filter(f => {
    // Don't show folders that are selected
    if (selectedItems.some(item => item.type === "folder" && item.id === f.id)) {
      return false;
    }
    return true;
  });

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
      {/* Drag indicator overlay */}
      {draggedItem && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
            <GripVertical className="h-4 w-4" />
            <span className="text-sm font-medium">
              {t("moving")}: {draggedItem.name}
            </span>
          </div>
        </div>
      )}

      {/* Selection Bar */}
      {selectionMode && (
        <div className="flex items-center gap-4 p-3 bg-primary/10 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium">
            {selectedItems.length} {t("selected")}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={selectAllInCurrentFolder}
            >
              <CheckSquare className="h-4 w-4 mr-2" />
              {t("selectAll")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMoveDialogOpen(true)}
              disabled={selectedItems.length === 0}
            >
              <FolderInput className="h-4 w-4 mr-2" />
              {t("moveSelected")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={selectedItems.length === 0}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t("deleteSelected")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
            >
              <XCircle className="h-4 w-4 mr-2" />
              {t("cancelSelection")}
            </Button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Breadcrumb */}
        <FolderBreadcrumb
          folders={breadcrumbPath}
          onNavigate={onFolderNavigate}
          draggedItem={draggedItem}
          onDrop={(folderId) => {
            if (draggedItem) {
              handleDropOnFolder({ preventDefault: () => {}, stopPropagation: () => {} } as React.DragEvent, folderId || "");
            }
          }}
        />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant={selectionMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              if (selectionMode) {
                clearSelection();
              } else {
                setSelectionMode(true);
              }
            }}
          >
            {selectionMode ? (
              <>
                <XCircle className="h-4 w-4 mr-2" />
                {t("exitSelection")}
              </>
            ) : (
              <>
                <CheckSquare className="h-4 w-4 mr-2" />
                {t("select")}
              </>
            )}
          </Button>

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
        <div className="space-y-6">
          {/* Folders Grid */}
          {currentFolders.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Dossiers ({currentFolders.length})
              </h3>
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {sortedFolders
                  .filter((f) => f.parentId === currentFolderId)
                  .map((folder) => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      stats={folderStats[folder.id]}
                      onNavigate={() => {
                        if (!selectionMode) {
                          onFolderNavigate(folder.id);
                        }
                      }}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDragEnter={(e) => handleDragEnterFolder(e, folder.id)}
                      onDragOver={(e) => handleDragOverFolder(e, folder.id)}
                      onDragLeave={handleDragLeaveFolder}
                      onDrop={(e) => handleDropOnFolder(e, folder.id)}
                      isDraggedOver={dragOverFolderId === folder.id}
                      isDragging={draggedItem?.type === "folder" && draggedItem?.id === folder.id}
                      formatSize={formatSize}
                      canDrop={draggedItem !== null && !(draggedItem.type === "folder" && draggedItem.id === folder.id)}
                      selectionMode={selectionMode}
                      isSelected={isItemSelected("folder", folder.id)}
                      onSelect={() => toggleItemSelection({ type: "folder", id: folder.id, name: folder.name })}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Documents Grid */}
          {currentDocuments.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Documents ({currentDocuments.length})
              </h3>
              <DocumentGrid
                documents={sortedDocuments.filter(
                  (d) => (d.folderId || null) === currentFolderId
                )}
                onDelete={onRefresh}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                draggedItem={draggedItem}
                selectionMode={selectionMode}
                selectedItems={selectedItems}
                onSelect={toggleItemSelection}
              />
            </div>
          )}
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
          onDragOver={(e, folderId) => {
            if (folderId) handleDragOverFolder(e, folderId);
          }}
          onDragLeave={handleDragLeaveFolder}
          onDrop={(e, folderId) => {
            if (folderId) handleDropOnFolder(e, folderId);
          }}
          draggedItem={draggedItem}
          dragOverFolderId={dragOverFolderId}
          formatSize={formatSize}
          selectionMode={selectionMode}
          selectedItems={selectedItems}
          onSelect={toggleItemSelection}
        />
      )}

      {/* Empty State */}
      {currentDocuments.length === 0 && currentFolders.length === 0 && (
        <div
          className={`flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg transition-all duration-200 ${
            draggedItem
              ? "border-primary bg-primary/5 scale-[1.01]"
              : "border-muted-foreground/25"
          }`}
          onDragOver={(e) => {
            if (draggedItem) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (draggedItem && currentFolderId) {
              handleDropOnFolder(e, currentFolderId);
            }
          }}
        >
          <h3 className="text-lg font-semibold">{t("emptyFolder")}</h3>
          <p className="text-muted-foreground">{t("emptyFolderDescription")}</p>
          {draggedItem && (
            <p className="mt-4 text-sm font-medium text-primary animate-pulse">
              {t("dropHere")}
            </p>
          )}
        </div>
      )}

      {/* Moving indicator */}
      {moving && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-lg shadow-xl flex items-center gap-3 border">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-lg font-medium">{t("movingItems")}</span>
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

      {/* Move Dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("moveDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("moveDialog.description", { count: selectedItems.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[300px] overflow-auto">
            {/* Root option */}
            <button
              onClick={() => moveSelectedToFolder(null)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent text-left"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-6 w-6 text-blue-500"
              >
                <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
              </svg>
              <span className="font-medium">{t("moveDialog.root")}</span>
            </button>

            {/* Folder list */}
            {availableFoldersForMove.map((folder) => (
              <button
                key={folder.id}
                onClick={() => moveSelectedToFolder(folder.id)}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent text-left"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-6 w-6 text-yellow-500"
                >
                  <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
                </svg>
                <span>{folder.name}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMoveDialogOpen(false)}
            >
              {t("moveDialog.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("deleteDialog.description", { count: selectedItems.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              {t("deleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={deleteSelectedItems}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("deleting")}
                </>
              ) : (
                t("deleteDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Folder Card Component
function FolderCard({
  folder,
  stats,
  onNavigate,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  isDraggedOver,
  isDragging,
  formatSize,
  canDrop,
  selectionMode,
  isSelected,
  onSelect,
}: {
  folder: Folder;
  stats?: FolderStats;
  onNavigate: () => void;
  onDragStart: (item: DragItem) => void;
  onDragEnd: () => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  isDraggedOver: boolean;
  isDragging: boolean;
  formatSize: (bytes: number) => string;
  canDrop: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const handleDragStart = (e: React.DragEvent) => {
    if (selectionMode) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "folder", id: folder.id, name: folder.name }));
    const target = e.currentTarget as HTMLElement;
    e.dataTransfer.setDragImage(target, target.offsetWidth / 2, target.offsetHeight / 2);
    onDragStart({ type: "folder", id: folder.id, name: folder.name });
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (selectionMode) {
      onSelect();
    } else {
      onNavigate();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!selectionMode) {
      onNavigate();
    }
  };

  // Handle drop on this folder with proper folder ID
  const handleLocalDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDrop(e);
  };

  return (
    <div
      draggable={!selectionMode}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`
        relative flex flex-col items-center gap-2 p-4 rounded-lg border bg-card
        transition-all duration-200 cursor-pointer select-none
        hover:bg-accent hover:shadow-md
        ${isDraggedOver ? "ring-2 ring-primary bg-primary/10 scale-105 shadow-lg" : ""}
        ${isDragging ? "opacity-50 scale-95 ring-2 ring-primary/50" : ""}
        ${canDrop && !isDraggedOver ? "ring-1 ring-dashed ring-primary/30" : ""}
        ${isSelected ? "ring-2 ring-primary bg-primary/10" : ""}
      `}
    >
      {/* Drop zone overlay - captures all drag events */}
      <div
        className="absolute inset-0 z-10"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={handleLocalDrop}
      />

      {/* Selection checkbox */}
      {selectionMode && (
        <div className="absolute top-2 left-2 z-20 pointer-events-none">
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-primary" />
          ) : (
            <Square className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      )}

      {/* Content - z-0 so drop zone overlay captures events */}
      <div className="flex flex-col items-center gap-2 relative z-0 pointer-events-none">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className={`h-12 w-12 transition-all duration-200 ${
            isDraggedOver
              ? "text-primary scale-110"
              : isDragging
                ? "text-muted-foreground"
                : "text-yellow-500"
          }`}
        >
          <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
        </svg>
        <span className="text-sm font-medium truncate max-w-full text-center">{folder.name}</span>
        {stats && (
          <span className="text-xs text-muted-foreground">
            {stats.document_count} {stats.document_count === 1 ? "doc" : "docs"} • {formatSize(stats.total_size_bytes)}
          </span>
        )}
        {isDraggedOver && (
          <span className="text-xs font-medium text-primary animate-pulse">
            Drop here
          </span>
        )}
      </div>
    </div>
  );
}

// Export the DragItem type for use in other components
export type { DragItem, DragItemType, FolderStats, SelectionItem };
