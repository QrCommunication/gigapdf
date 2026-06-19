"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToastAction,
  useToast,
} from "@giga-pdf/ui";
import { formatDate, formatBytes } from "@/lib/utils";
import {
  FileText,
  Trash2,
  Download,
  Loader2,
  MoreVertical,
  Eye,
  FileSpreadsheet,
  FileType,
  Copy,
  Image,
  Share2,
  Pencil,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Folder,
  CheckSquare,
  Square,
  Tags,
} from "lucide-react";
import { api } from "@/lib/api";
import { DragItem, FolderStats, SelectionItem } from "./document-explorer";
import { cn } from "@/lib/utils";
import { ShareDialog } from "@/components/sharing";
import { clientLogger } from "@/lib/client-logger";
import { triggerBlobDownload } from "./blob-download";
import {
  downloadDocumentBytes,
  convertDocumentBytes,
} from "./download-document-bytes";
import { ManageTagsDialog } from "./manage-tags-dialog";

export type SortField = "name" | "size" | "createdAt" | "updatedAt";
export type SortDirection = "asc" | "desc";

interface Document {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  folderId?: string | null;
  tags?: string[];
}

interface FolderItem {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DocumentTableProps {
  documents: Document[];
  folders?: FolderItem[];
  folderStats?: Record<string, FolderStats>;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  onDelete?: () => void;
  onRename?: (id: string, newName: string) => void;
  /** Refresh callback after duplicate / tags update. */
  onChanged?: () => void;
  /** Opens the folder rename dialog (owned by the explorer). */
  onFolderRename?: (folder: FolderItem) => void;
  onFolderClick?: (folderId: string) => void;
  onDragStart?: (item: DragItem) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent, folderId: string | null) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent, folderId: string | null) => void;
  draggedItem?: DragItem | null;
  dragOverFolderId?: string | null;
  formatSize?: (bytes: number) => string;
  selectionMode?: boolean;
  selectedItems?: SelectionItem[];
  onSelect?: (item: SelectionItem) => void;
}

export function DocumentTable({
  documents,
  folders = [],
  folderStats = {},
  sortField,
  sortDirection,
  onSort,
  onDelete,
  onRename,
  onChanged,
  onFolderRename,
  onFolderClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  draggedItem,
  dragOverFolderId,
  formatSize,
  selectionMode = false,
  selectedItems = [],
  onSelect,
}: DocumentTableProps) {
  const router = useRouter();
  const t = useTranslations("documents");
  const tCard = useTranslations("documents.card");
  const tToasts = useTranslations("documents.toasts");
  const { toast } = useToast();

  // Dialog states
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);

  // Folder dialog states
  const [folderToDelete, setFolderToDelete] = useState<FolderItem | null>(null);
  const [folderDeleteDialogOpen, setFolderDeleteDialogOpen] = useState(false);

  // Loading states
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  // Data states
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const handleOpenEditor = async (doc: Document) => {
    // Navigate to editor with stored document ID (not session ID)
    router.push(`/editor/${doc.id}`);
  };

  const handleDownload = async (doc: Document) => {
    try {
      setLoadingId(doc.id);
      const result = await api.loadDocument(doc.id);
      const downloadUrl = api.getDocumentDownloadUrl(result.document_id);
      window.open(downloadUrl, "_blank");
    } catch (err) {
      clientLogger.error("document-table.download-failed", err);
      alert(tCard("errors.downloadFailed"));
    } finally {
      setLoadingId(null);
    }
  };

  // Soft delete: the document goes to the trash (restorable for 30 days).
  // The toast carries an inline "Undo" action that restores it on the spot.
  const handleDelete = async () => {
    if (!selectedDoc) return;
    const docId = selectedDoc.id;
    const docName = selectedDoc.name;
    try {
      setDeleting(true);
      await api.deleteDocument(docId);
      setDeleteDialogOpen(false);
      setSelectedDoc(null);
      onDelete?.();
      toast({
        title: tToasts("movedToTrash"),
        description: docName,
        action: (
          <ToastAction
            altText={tToasts("movedToTrashUndo")}
            onClick={async () => {
              try {
                await api.restoreDocument(docId);
                toast({ title: tToasts("restored") });
                onDelete?.();
              } catch (restoreErr) {
                clientLogger.error("document-table.restore-failed", restoreErr);
                toast({
                  variant: "destructive",
                  title: tToasts("restoreFailed"),
                });
              }
            }}
          >
            {tToasts("movedToTrashUndo")}
          </ToastAction>
        ),
      });
    } catch (err) {
      clientLogger.error("document-table.delete-failed", err);
      alert(tCard("errors.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleDuplicate = async (doc: Document) => {
    try {
      setDuplicatingId(doc.id);
      const copy = await api.duplicateDocument(doc.id);
      toast({ title: tToasts("duplicated", { name: copy.name }) });
      onChanged?.();
    } catch (err) {
      clientLogger.error("document-table.duplicate-failed", err);
      toast({ variant: "destructive", title: tToasts("duplicateFailed") });
    } finally {
      setDuplicatingId(null);
    }
  };

  const openTagsDialog = (doc: Document) => {
    setSelectedDoc(doc);
    setTagsDialogOpen(true);
  };

  const handleRename = async () => {
    if (!selectedDoc || !newName.trim() || newName === selectedDoc.name) {
      setRenameDialogOpen(false);
      return;
    }

    try {
      setRenaming(true);
      await api.renameDocument(selectedDoc.id, newName.trim());
      setRenameDialogOpen(false);
      onRename?.(selectedDoc.id, newName.trim());
      setSelectedDoc(null);
    } catch (err) {
      clientLogger.error("document-table.rename-failed", err);
      alert(tCard("errors.renameFailed"));
    } finally {
      setRenaming(false);
    }
  };

  const handlePreview = async (doc: Document) => {
    try {
      setPreviewLoading(true);
      setSelectedDoc(doc);
      setPreviewOpen(true);
      const result = await api.loadDocument(doc.id);
      const downloadUrl = api.getDocumentDownloadUrl(result.document_id);
      setPreviewUrl(downloadUrl);
    } catch (err) {
      clientLogger.error("document-table.preview-failed", err);
      alert(tCard("errors.previewFailed"));
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleShare = (doc: Document) => {
    setSelectedDoc(doc);
    setShareDialogOpen(true);
  };

  const handleExport = async (
    doc: Document,
    format: "png" | "jpeg" | "webp" | "html" | "txt" | "docx" | "xlsx"
  ) => {
    try {
      setExporting(true);
      setSelectedDoc(doc);
      setExportDialogOpen(true);

      // Fetch the stored document's bytes and convert entirely client-side via
      // the GigaPDF SDK (no backend job): images → per-page .zip, docx/xlsx/html
      // via the SDK exporter, txt via text extraction.
      const bytes = await downloadDocumentBytes(doc.id);
      const { blob, extension } = await convertDocumentBytes(bytes, format);
      triggerBlobDownload(blob, `${doc.name}.${extension}`);

      setExportDialogOpen(false);
    } catch (err) {
      clientLogger.error("document-table.export-failed", err);
      alert(tCard("errors.exportFailed"));
      setExportDialogOpen(false);
    } finally {
      setExporting(false);
    }
  };

  const openDeleteDialog = (doc: Document) => {
    setSelectedDoc(doc);
    setDeleteDialogOpen(true);
  };

  const openFolderDeleteDialog = (folder: FolderItem) => {
    setFolderToDelete(folder);
    setFolderDeleteDialogOpen(true);
  };

  const handleDeleteFolder = async () => {
    if (!folderToDelete) return;
    try {
      setDeletingFolder(true);
      await api.deleteFolder(folderToDelete.id);
      setFolderDeleteDialogOpen(false);
      setFolderToDelete(null);
      onDelete?.();
    } catch (err) {
      clientLogger.error("document-table.delete-folder-failed", err);
      // Backend returns 400 (INVALID_OPERATION) when the folder still
      // contains documents and cascade is not requested.
      const status = (err as Error & { status?: number }).status;
      alert(
        status === 400
          ? t("table.folderDeleteDialog.notEmpty")
          : t("table.folderDeleteDialog.error")
      );
    } finally {
      setDeletingFolder(false);
    }
  };

  const openRenameDialog = (doc: Document) => {
    setSelectedDoc(doc);
    setNewName(doc.name);
    setRenameDialogOpen(true);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="ml-2 h-4 w-4" />
    ) : (
      <ArrowDown className="ml-2 h-4 w-4" />
    );
  };

  const isItemSelected = (type: "document" | "folder", id: string) => {
    return selectedItems.some(item => item.type === type && item.id === id);
  };

  const SortableHeader = ({
    field,
    children,
  }: {
    field: SortField;
    children: React.ReactNode;
  }) => (
    <TableHead>
      <Button
        variant="ghost"
        className="h-8 px-2 hover:bg-muted/50"
        onClick={() => onSort(field)}
      >
        {children}
        <SortIcon field={field} />
      </Button>
    </TableHead>
  );

  if (documents.length === 0 && folders.length === 0) {
    return null;
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {selectionMode && <TableHead className="w-[50px]"></TableHead>}
              <SortableHeader field="name">{t("table.name")}</SortableHeader>
              <SortableHeader field="size">{t("table.size")}</SortableHeader>
              <SortableHeader field="createdAt">{t("table.created")}</SortableHeader>
              <SortableHeader field="updatedAt">{t("table.modified")}</SortableHeader>
              <TableHead className="w-[100px]">{t("table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Folders first */}
            {folders.map((folder) => {
              const stats = folderStats[folder.id];
              const isDropTarget = dragOverFolderId === folder.id;
              const canDrop = draggedItem && (
                draggedItem.type === "document" ||
                (draggedItem.type === "folder" && draggedItem.id !== folder.id)
              );

              const isFolderSelected = isItemSelected("folder", folder.id);

              return (
                <TableRow
                  key={`folder-${folder.id}`}
                  className={cn(
                    "cursor-pointer hover:bg-muted/50 transition-colors",
                    isDropTarget && canDrop && "bg-primary/10 ring-2 ring-primary ring-inset",
                    isFolderSelected && "bg-primary/5"
                  )}
                  onClick={() => {
                    if (selectionMode) {
                      onSelect?.({ type: "folder", id: folder.id, name: folder.name });
                    } else {
                      onFolderClick?.(folder.id);
                    }
                  }}
                  onDragOver={(e) => onDragOver?.(e, folder.id)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop?.(e, folder.id)}
                  draggable={!selectionMode}
                  onDragStart={(e) => {
                    if (selectionMode) return;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("application/json", JSON.stringify({ type: "folder", id: folder.id }));
                    onDragStart?.({ type: "folder", id: folder.id, name: folder.name });
                  }}
                  onDragEnd={onDragEnd}
                >
                  {selectionMode && (
                    <TableCell className="w-[50px]">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect?.({ type: "folder", id: folder.id, name: folder.name });
                        }}
                        className="p-1 hover:bg-muted rounded"
                      >
                        {isFolderSelected ? (
                          <CheckSquare className="h-5 w-5 text-primary" />
                        ) : (
                          <Square className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Folder className="h-5 w-5 text-yellow-500" />
                      <span className="font-medium">{folder.name}</span>
                      {stats && stats.document_count > 0 && (
                        <span className="text-xs text-muted-foreground">
                          ({stats.document_count} {stats.document_count === 1 ? "doc" : "docs"})
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {stats && stats.total_size_bytes > 0
                      ? (formatSize ? formatSize(stats.total_size_bytes) : formatBytes(stats.total_size_bytes))
                      : "--"
                    }
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(folder.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(folder.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onFolderRename?.(folder);
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          {tCard("menu.rename")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openFolderDeleteDialog(folder);
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {tCard("menu.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}

            {/* Documents */}
            {documents.map((doc) => {
              const isDragging = draggedItem?.type === "document" && draggedItem?.id === doc.id;
              const isDocSelected = isItemSelected("document", doc.id);

              return (
                <TableRow
                  key={doc.id}
                  className={cn(
                    "group",
                    !selectionMode && "cursor-grab active:cursor-grabbing",
                    isDragging && "opacity-50 bg-primary/5",
                    isDocSelected && "bg-primary/5"
                  )}
                  draggable={!selectionMode}
                  onDragStart={(e) => {
                    if (selectionMode) return;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("application/json", JSON.stringify({ type: "document", id: doc.id }));
                    onDragStart?.({ type: "document", id: doc.id, name: doc.name });
                  }}
                  onDragEnd={onDragEnd}
                  onClick={() => {
                    if (selectionMode) {
                      onSelect?.({ type: "document", id: doc.id, name: doc.name });
                    }
                  }}
                >
                  {selectionMode && (
                    <TableCell className="w-[50px]">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect?.({ type: "document", id: doc.id, name: doc.name });
                        }}
                        className="p-1 hover:bg-muted rounded"
                      >
                        {isDocSelected ? (
                          <CheckSquare className="h-5 w-5 text-primary" />
                        ) : (
                          <Square className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                    </TableCell>
                  )}
                  <TableCell>
                    <div
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={(e) => {
                        if (!selectionMode) {
                          e.stopPropagation();
                          handleOpenEditor(doc);
                        }
                      }}
                    >
                      <FileText className="h-5 w-5 text-red-500" />
                      <span className={cn("font-medium", !selectionMode && "hover:underline")}>{doc.name}</span>
                      {loadingId === doc.id && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                    </div>
                  </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatBytes(doc.size)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(doc.createdAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(doc.updatedAt)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={loadingId === doc.id || exporting || duplicatingId === doc.id}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => handlePreview(doc)}>
                        <Eye className="mr-2 h-4 w-4" />
                        {tCard("menu.preview")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDownload(doc)}>
                        <Download className="mr-2 h-4 w-4" />
                        {tCard("menu.download")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => openRenameDialog(doc)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {tCard("menu.rename")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDuplicate(doc)}
                        disabled={duplicatingId === doc.id}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        {tCard("menu.duplicate")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openTagsDialog(doc)}>
                        <Tags className="mr-2 h-4 w-4" />
                        {tCard("menu.manageTags")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleShare(doc)}>
                        <Share2 className="mr-2 h-4 w-4" />
                        {tCard("menu.share")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <FileType className="mr-2 h-4 w-4" />
                          {tCard("menu.export")}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem onClick={() => handleExport(doc, "docx")}>
                            <FileType className="mr-2 h-4 w-4" />
                            {tCard("menu.exportWord")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExport(doc, "xlsx")}>
                            <FileSpreadsheet className="mr-2 h-4 w-4" />
                            {tCard("menu.exportExcel")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExport(doc, "png")}>
                            <Image className="mr-2 h-4 w-4" />
                            {tCard("menu.exportImages")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExport(doc, "jpeg")}>
                            <Image className="mr-2 h-4 w-4" />
                            {tCard("menu.exportJpeg")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExport(doc, "webp")}>
                            <Image className="mr-2 h-4 w-4" />
                            {tCard("menu.exportWebp")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExport(doc, "html")}>
                            <FileType className="mr-2 h-4 w-4" />
                            {tCard("menu.exportHtml")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExport(doc, "txt")}>
                            <FileSpreadsheet className="mr-2 h-4 w-4" />
                            {tCard("menu.exportText")}
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => openDeleteDialog(doc)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {tCard("menu.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCard("deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {tCard("deleteDialog.description", { name: selectedDoc?.name || "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              {tCard("deleteDialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tCard("deleteDialog.deleting")}
                </>
              ) : (
                tCard("deleteDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Delete Confirmation Dialog */}
      <Dialog open={folderDeleteDialogOpen} onOpenChange={setFolderDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("table.folderDeleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("table.folderDeleteDialog.description", {
                name: folderToDelete?.name || "",
              })}
            </DialogDescription>
          </DialogHeader>
          {folderToDelete &&
            (folderStats[folderToDelete.id]?.document_count ?? 0) > 0 && (
              <p className="text-sm font-medium text-destructive">
                {t("table.folderDeleteDialog.containsDocuments", {
                  count: folderStats[folderToDelete.id]?.document_count ?? 0,
                })}
              </p>
            )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFolderDeleteDialogOpen(false)}
              disabled={deletingFolder}
            >
              {t("table.folderDeleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteFolder}
              disabled={deletingFolder}
            >
              {deletingFolder ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("table.folderDeleteDialog.deleting")}
                </>
              ) : (
                t("table.folderDeleteDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCard("renameDialog.title")}</DialogTitle>
            <DialogDescription>{tCard("renameDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="document-name">{tCard("renameDialog.label")}</Label>
            <Input
              id="document-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={tCard("renameDialog.placeholder")}
              className="mt-2"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
              disabled={renaming}
            >
              {tCard("renameDialog.cancel")}
            </Button>
            <Button onClick={handleRename} disabled={renaming || !newName.trim()}>
              {renaming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tCard("renameDialog.renaming")}
                </>
              ) : (
                tCard("renameDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Dialog */}
      {selectedDoc && (
        <ShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          documentId={selectedDoc.id}
          documentName={selectedDoc.name}
        />
      )}

      {/* Manage Tags Dialog */}
      {selectedDoc && (
        <ManageTagsDialog
          open={tagsDialogOpen}
          onOpenChange={setTagsDialogOpen}
          documentId={selectedDoc.id}
          documentName={selectedDoc.name}
          initialTags={selectedDoc.tags ?? []}
          onSaved={() => onChanged?.()}
        />
      )}

      {/* Export Progress Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCard("exportDialog.title")}</DialogTitle>
            <DialogDescription>{tCard("exportDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <DialogTitle className="truncate pr-4">{selectedDoc?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden bg-muted/30">
            {previewLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : previewUrl ? (
              <iframe
                src={`${previewUrl}#toolbar=0&navpanes=0`}
                className="w-full h-full border-0"
                title={selectedDoc?.name}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {tCard("preview.noPreview")}
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              {tCard("preview.close")}
            </Button>
            <Button onClick={() => selectedDoc && handleDownload(selectedDoc)}>
              <Download className="mr-2 h-4 w-4" />
              {tCard("menu.download")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
