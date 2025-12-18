"use client";

import { useState } from "react";
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

  // Filter documents and folders for current folder
  const currentDocuments = documents.filter(
    (doc) => (doc.folderId || null) === currentFolderId
  );
  const currentFolders = folders.filter(
    (folder) => folder.parentId === currentFolderId
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Breadcrumb */}
        <FolderBreadcrumb folders={breadcrumbPath} onNavigate={onFolderNavigate} />

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
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    onClick={() => onFolderNavigate(folder.id)}
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
          />
        </div>
      ) : (
        <DocumentTable
          documents={sortedDocuments.filter(
            (d) => (d.folderId || null) === currentFolderId
          )}
          folders={sortedFolders.filter((f) => f.parentId === currentFolderId)}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          onDelete={onRefresh}
          onFolderClick={onFolderNavigate}
        />
      )}

      {/* Empty State */}
      {currentDocuments.length === 0 && currentFolders.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <h3 className="text-lg font-semibold">{t("emptyFolder")}</h3>
          <p className="text-muted-foreground">{t("emptyFolderDescription")}</p>
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

// Simple Folder Card for Grid View
function FolderCard({
  folder,
  onClick,
}: {
  folder: Folder;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 rounded-lg border bg-card hover:bg-accent transition-colors cursor-pointer"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-12 w-12 text-yellow-500"
      >
        <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
      </svg>
      <span className="text-sm font-medium truncate max-w-full">{folder.name}</span>
    </button>
  );
}
