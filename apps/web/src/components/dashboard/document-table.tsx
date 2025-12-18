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
  Image,
  Share2,
  Pencil,
  Copy,
  Check,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Folder,
} from "lucide-react";
import { api } from "@/lib/api";
import { DragItem, FolderStats } from "./document-explorer";
import { cn } from "@/lib/utils";

export type SortField = "name" | "size" | "createdAt" | "updatedAt";
export type SortDirection = "asc" | "desc";

interface Document {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  folderId?: string | null;
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
  onFolderClick?: (folderId: string) => void;
  onDragStart?: (item: DragItem) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent, folderId: string) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent, folderId: string) => void;
  draggedItem?: DragItem | null;
  dragOverFolderId?: string | null;
  formatSize?: (bytes: number) => string;
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
  onFolderClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  draggedItem,
  dragOverFolderId,
  formatSize,
}: DocumentTableProps) {
  const router = useRouter();
  const t = useTranslations("documents");
  const tCard = useTranslations("documents.card");

  // Dialog states
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // Loading states
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Data states
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [sessionDocId, setSessionDocId] = useState<string | null>(null);

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
      console.error("Failed to download:", err);
      alert(tCard("errors.downloadFailed"));
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedDoc) return;
    try {
      setDeleting(true);
      await api.deleteDocument(selectedDoc.id);
      setDeleteDialogOpen(false);
      setSelectedDoc(null);
      onDelete?.();
    } catch (err) {
      console.error("Failed to delete:", err);
      alert(tCard("errors.deleteFailed"));
    } finally {
      setDeleting(false);
    }
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
      console.error("Failed to rename:", err);
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
      setSessionDocId(result.document_id);
      const downloadUrl = api.getDocumentDownloadUrl(result.document_id);
      setPreviewUrl(downloadUrl);
    } catch (err) {
      console.error("Failed to load preview:", err);
      alert(tCard("errors.previewFailed"));
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleShare = async (doc: Document) => {
    try {
      setLoadingId(doc.id);
      const result = await api.loadDocument(doc.id);
      const shareableUrl = `${window.location.origin}/shared/${result.document_id}`;
      setShareUrl(shareableUrl);
      setSelectedDoc(doc);
      setShareDialogOpen(true);
    } catch (err) {
      console.error("Failed to generate share link:", err);
      alert(tCard("errors.shareFailed"));
    } finally {
      setLoadingId(null);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleExport = async (
    doc: Document,
    format: "png" | "jpeg" | "html" | "txt" | "docx" | "xlsx"
  ) => {
    try {
      setExporting(true);
      setSelectedDoc(doc);
      setExportDialogOpen(true);

      let docId = sessionDocId;
      if (!docId) {
        const result = await api.loadDocument(doc.id);
        docId = result.document_id;
        setSessionDocId(docId);
      }

      const job = await api.exportDocument(docId, format, {
        single_file: true,
        dpi: format === "png" || format === "jpeg" ? 150 : undefined,
        quality: format === "jpeg" ? 85 : undefined,
      });

      let status = await api.getJobStatus(job.job_id);
      while (status.status !== "completed" && status.status !== "failed") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        status = await api.getJobStatus(job.job_id);
      }

      if (status.status === "failed") {
        throw new Error(status.error || "Export failed");
      }

      const blob = await api.getExportResult(docId, job.job_id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const extensionMap: Record<string, string> = {
        png: "zip",
        jpeg: "zip",
        html: "html",
        txt: "txt",
        docx: "docx",
        xlsx: "xlsx",
      };
      a.download = `${doc.name}.${extensionMap[format] || format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setExportDialogOpen(false);
    } catch (err) {
      console.error("Failed to export:", err);
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

              return (
                <TableRow
                  key={`folder-${folder.id}`}
                  className={cn(
                    "cursor-pointer hover:bg-muted/50 transition-colors",
                    isDropTarget && canDrop && "bg-primary/10 ring-2 ring-primary ring-inset"
                  )}
                  onClick={() => onFolderClick?.(folder.id)}
                  onDragOver={(e) => onDragOver?.(e, folder.id)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop?.(e, folder.id)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("application/json", JSON.stringify({ type: "folder", id: folder.id }));
                    onDragStart?.({ type: "folder", id: folder.id, name: folder.name });
                  }}
                  onDragEnd={onDragEnd}
                >
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
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Pencil className="mr-2 h-4 w-4" />
                          {tCard("menu.rename")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">
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

              return (
                <TableRow
                  key={doc.id}
                  className={cn(
                    "group cursor-grab active:cursor-grabbing",
                    isDragging && "opacity-50 bg-primary/5"
                  )}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("application/json", JSON.stringify({ type: "document", id: doc.id }));
                    onDragStart?.({ type: "document", id: doc.id, name: doc.name });
                  }}
                  onDragEnd={onDragEnd}
                >
                  <TableCell>
                    <div
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() => handleOpenEditor(doc)}
                    >
                      <FileText className="h-5 w-5 text-red-500" />
                      <span className="font-medium hover:underline">{doc.name}</span>
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
                        disabled={loadingId === doc.id || exporting}
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
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCard("shareDialog.title")}</DialogTitle>
            <DialogDescription>{tCard("shareDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>{tCard("shareDialog.linkLabel")}</Label>
            <div className="flex mt-2 gap-2">
              <Input value={shareUrl} readOnly className="flex-1" />
              <Button onClick={handleCopyLink} variant="outline" size="icon">
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShareDialogOpen(false)}>
              {tCard("shareDialog.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
