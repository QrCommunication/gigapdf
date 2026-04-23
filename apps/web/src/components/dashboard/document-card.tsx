"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
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
} from "@giga-pdf/ui";
import { formatDate, formatBytes } from "@/lib/utils";
import {
  FileText,
  Trash2,
  Download,
  Loader2,
  ExternalLink,
  MoreVertical,
  Eye,
  FileSpreadsheet,
  FileType,
  Image,
  Share2,
  Pencil,
  CheckSquare,
  Square,
} from "lucide-react";
import { api } from "@/lib/api";
import { DragItem } from "./document-explorer";
import { cn } from "@/lib/utils";
import { ShareDialog } from "@/components/sharing";
import { clientLogger } from "@/lib/client-logger";

interface DocumentCardProps {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  onDragStart?: (item: DragItem) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
}

export function DocumentCard({
  id,
  name,
  size,
  createdAt,
  updatedAt,
  onDelete,
  onRename,
  onDragStart,
  onDragEnd,
  isDragging,
  selectionMode = false,
  isSelected = false,
  onSelect,
}: DocumentCardProps) {
  const router = useRouter();
  const t = useTranslations("documents.card");
  const [loading, setLoading] = useState(false);
  const [documentName, setDocumentName] = useState(name);

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // Loading states
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Data states
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [newName, setNewName] = useState(name);
  const [sessionDocId, setSessionDocId] = useState<string | null>(null);

  const handleOpenEditor = async () => {
    // Navigate to editor with stored document ID (not session ID)
    router.push(`/editor/${id}`);
  };

  const handleDownload = async () => {
    try {
      setLoading(true);
      const result = await api.loadDocument(id);
      const downloadUrl = api.getDocumentDownloadUrl(result.document_id);
      window.open(downloadUrl, "_blank");
    } catch (err) {
      clientLogger.error("document-card.download-failed", err);
      alert(t("errors.downloadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      setDeleting(true);
      await api.deleteDocument(id);
      setDeleteDialogOpen(false);
      onDelete?.();
    } catch (err) {
      clientLogger.error("document-card.delete-failed", err);
      alert(t("errors.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleRename = async () => {
    if (!newName.trim() || newName === documentName) {
      setRenameDialogOpen(false);
      return;
    }

    try {
      setRenaming(true);
      await api.renameDocument(id, newName.trim());
      setDocumentName(newName.trim());
      setRenameDialogOpen(false);
      onRename?.(newName.trim());
    } catch (err) {
      clientLogger.error("document-card.rename-failed", err);
      alert(t("errors.renameFailed"));
    } finally {
      setRenaming(false);
    }
  };

  const handlePreview = async () => {
    try {
      setPreviewLoading(true);
      setPreviewOpen(true);
      const result = await api.loadDocument(id);
      setSessionDocId(result.document_id);
      const downloadUrl = api.getDocumentDownloadUrl(result.document_id);
      setPreviewUrl(downloadUrl);
    } catch (err) {
      clientLogger.error("document-card.preview-failed", err);
      alert(t("errors.previewFailed"));
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleShare = () => {
    setShareDialogOpen(true);
  };

  const handleExport = async (format: "png" | "jpeg" | "html" | "txt" | "docx" | "xlsx") => {
    try {
      setExporting(true);
      setExportDialogOpen(true);

      // Load document first if not already loaded
      let docId = sessionDocId;
      if (!docId) {
        const result = await api.loadDocument(id);
        docId = result.document_id;
        setSessionDocId(docId);
      }

      // Start export job
      const job = await api.exportDocument(docId, format, {
        single_file: true,
        dpi: format === "png" || format === "jpeg" ? 150 : undefined,
        quality: format === "jpeg" ? 85 : undefined,
      });

      // Poll for completion
      let status = await api.getJobStatus(job.job_id);
      while (status.status !== "completed" && status.status !== "failed") {
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await api.getJobStatus(job.job_id);
      }

      if (status.status === "failed") {
        throw new Error(status.error || t("errors.exportFailed"));
      }

      // Download result
      const blob = await api.getExportResult(docId, job.job_id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Set correct file extension
      const extensionMap: Record<string, string> = {
        png: "zip",
        jpeg: "zip",
        html: "html",
        txt: "txt",
        docx: "docx",
        xlsx: "xlsx",
      };
      a.download = `${documentName}.${extensionMap[format] || format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setExportDialogOpen(false);
    } catch (err) {
      clientLogger.error("document-card.export-failed", err);
      alert(t("errors.exportFailed"));
      setExportDialogOpen(false);
    } finally {
      setExporting(false);
    }
  };

  const openRenameDialog = () => {
    setNewName(documentName);
    setRenameDialogOpen(true);
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (selectionMode) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/json", JSON.stringify({ type: "document", id }));
    onDragStart?.({ type: "document", id, name: documentName });
  };

  const handleDragEnd = () => {
    onDragEnd?.();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      e.preventDefault();
      e.stopPropagation();
      onSelect?.();
    }
  };

  return (
    <>
      <Card
        className={cn(
          "group transition-shadow hover:shadow-lg",
          !selectionMode && "cursor-grab active:cursor-grabbing",
          selectionMode && "cursor-pointer",
          isDragging && "opacity-50 ring-2 ring-primary",
          isSelected && "ring-2 ring-primary bg-primary/5"
        )}
        draggable={!selectionMode}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={handleCardClick}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            {selectionMode ? (
              isSelected ? (
                <CheckSquare className="h-5 w-5 flex-shrink-0 text-primary" />
              ) : (
                <Square className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
              )
            ) : (
              <FileText className="h-5 w-5 flex-shrink-0 text-red-500" />
            )}
            <h3 className="font-semibold truncate" title={documentName}>
              {documentName}
            </h3>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                disabled={loading || exporting}
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">{t("menu.open")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handlePreview}>
                <Eye className="mr-2 h-4 w-4" />
                {t("menu.preview")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                {t("menu.download")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openRenameDialog}>
                <Pencil className="mr-2 h-4 w-4" />
                {t("menu.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleShare}>
                <Share2 className="mr-2 h-4 w-4" />
                {t("menu.share")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FileType className="mr-2 h-4 w-4" />
                  {t("menu.export")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleExport("docx")}>
                    <FileType className="mr-2 h-4 w-4" />
                    {t("menu.exportWord")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("xlsx")}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {t("menu.exportExcel")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("png")}>
                    <Image className="mr-2 h-4 w-4" />
                    {t("menu.exportImages")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("html")}>
                    <FileType className="mr-2 h-4 w-4" />
                    {t("menu.exportHtml")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("txt")}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {t("menu.exportText")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("menu.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t("size")}: {formatBytes(size)}</p>
            <p>{t("created")}: {formatDate(createdAt)}</p>
            <p>{t("modified")}: {formatDate(updatedAt)}</p>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            variant="default"
            className="w-full"
            onClick={handleOpenEditor}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t("open")}
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("deleteDialog.description", { name: documentName })}
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
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("deleteDialog.deleting")}
                </>
              ) : (
                t("deleteDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("renameDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="document-name">{t("renameDialog.label")}</Label>
            <Input
              id="document-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("renameDialog.placeholder")}
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
              {t("renameDialog.cancel")}
            </Button>
            <Button onClick={handleRename} disabled={renaming || !newName.trim()}>
              {renaming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("renameDialog.renaming")}
                </>
              ) : (
                t("renameDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Dialog */}
      <ShareDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        documentId={id}
        documentName={documentName}
      />

      {/* Export Progress Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("exportDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("exportDialog.description")}
            </DialogDescription>
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
            <div className="flex items-center justify-between">
              <DialogTitle className="truncate pr-4">{documentName}</DialogTitle>
            </div>
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
                title={documentName}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {t("preview.noPreview")}
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              {t("preview.close")}
            </Button>
            <Button onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              {t("menu.download")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
