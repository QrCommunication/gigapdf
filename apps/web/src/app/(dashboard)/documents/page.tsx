"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { DocumentExplorer, ViewMode } from "@/components/dashboard/document-explorer";
import { SortField, SortDirection } from "@/components/dashboard/document-table";
import { BreadcrumbFolder } from "@/components/dashboard/folder-breadcrumb";
import { Button, Input, Skeleton } from "@giga-pdf/ui";
import {
  Plus,
  Search,
  Upload,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Home,
  RefreshCw,
} from "lucide-react";
import { api, StoredDocument } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";

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

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get current folder from URL
  const currentFolderId = searchParams?.get("folder") || null;

  // Navigation history for custom back/forward
  const [navigationHistory, setNavigationHistory] = useState<(string | null)[]>([null]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Data states
  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search and pagination
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // View settings
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Breadcrumb path
  const [breadcrumbPath, setBreadcrumbPath] = useState<BreadcrumbFolder[]>([]);

  // Load view preferences from localStorage
  useEffect(() => {
    const savedViewMode = localStorage.getItem("documentViewMode") as ViewMode | null;
    const savedSortField = localStorage.getItem("documentSortField") as SortField | null;
    const savedSortDirection = localStorage.getItem("documentSortDirection") as SortDirection | null;

    if (savedViewMode) setViewMode(savedViewMode);
    if (savedSortField) setSortField(savedSortField);
    if (savedSortDirection) setSortDirection(savedSortDirection);
  }, []);

  // Save view preferences to localStorage
  useEffect(() => {
    localStorage.setItem("documentViewMode", viewMode);
    localStorage.setItem("documentSortField", sortField);
    localStorage.setItem("documentSortDirection", sortDirection);
  }, [viewMode, sortField, sortDirection]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Build breadcrumb path when folder changes
  const buildBreadcrumbPath = useCallback(
    (folderId: string | null): BreadcrumbFolder[] => {
      if (!folderId) return [];

      const path: BreadcrumbFolder[] = [];
      let currentId: string | null = folderId;

      while (currentId) {
        const folder = folders.find((f) => f.id === currentId);
        if (folder) {
          path.unshift({ id: folder.id, name: folder.name });
          currentId = folder.parentId;
        } else {
          break;
        }
      }

      return path;
    },
    [folders]
  );

  // Update breadcrumb when folder changes
  useEffect(() => {
    setBreadcrumbPath(buildBreadcrumbPath(currentFolderId));
  }, [currentFolderId, buildBreadcrumbPath]);

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Load documents for current folder
      const response = await api.listDocuments({
        page,
        per_page: 50,
        search: debouncedSearch || undefined,
        folder_id: currentFolderId || undefined,
      });

      const transformedDocs: Document[] = response.items.map(
        (doc: StoredDocument) => ({
          id: doc.stored_document_id,
          name: doc.name,
          size: doc.file_size_bytes || 0,
          createdAt: new Date(doc.created_at),
          updatedAt: new Date(doc.modified_at),
          folderId: doc.folder_id || null,
        })
      );

      setDocuments(transformedDocs);
      setTotalPages(response.pagination.total_pages);
      setTotal(response.pagination.total);

      // Load folders
      try {
        const foldersResponse = await api.listFolders();
        const transformedFolders: Folder[] = foldersResponse.folders.map(
          (folder) => ({
            id: folder.folder_id,
            name: folder.name,
            parentId: folder.parent_id,
            createdAt: new Date(folder.created_at),
            updatedAt: new Date(folder.created_at), // API doesn't return updated_at, use created_at
          })
        );
        setFolders(transformedFolders);
      } catch (folderErr) {
        clientLogger.warn("documents.load-folders-failed", folderErr);
        setFolders([]);
      }
    } catch (err) {
      clientLogger.error("documents.load-failed", err);
      setError(t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, currentFolderId, t]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleNewDocument = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError(t("errors.pdfOnly"));
      return;
    }

    try {
      setUploading(true);
      setError(null);

      const uploadResult = await api.uploadDocument(file);

      // Fetch the PDF Blob from the server before saving
      const { getAuthToken } = await import("@/lib/api");
      const token = await getAuthToken();
      const downloadRes = await fetch(
        `/api/v1/documents/${uploadResult.document_id}/download`,
        {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      );
      if (!downloadRes.ok) {
        throw new Error(`Failed to download PDF: ${downloadRes.status}`);
      }
      const pdfBlob = await downloadRes.blob();

      await api.saveDocument({
        file: pdfBlob,
        name: file.name.replace(".pdf", ""),
        tags: [],
        folderId: currentFolderId || undefined,
      });

      await loadDocuments();
    } catch (err) {
      clientLogger.error("documents.upload-failed", err);
      setError(err instanceof Error ? err.message : t("errors.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleCreateFolder = async (name: string, parentId: string | null) => {
    await api.createFolder(name, parentId);
  };

  // Navigate to folder using URL
  const handleFolderNavigate = useCallback((folderId: string | null) => {
    // Update navigation history
    const newHistory = [...navigationHistory.slice(0, historyIndex + 1), folderId];
    setNavigationHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);

    // Update URL
    if (folderId) {
      router.push(`/documents?folder=${folderId}`);
    } else {
      router.push("/documents");
    }
    setPage(1);
  }, [router, navigationHistory, historyIndex]);

  // Custom back navigation
  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const folderId = navigationHistory[newIndex];
      setHistoryIndex(newIndex);

      if (folderId) {
        router.push(`/documents?folder=${folderId}`);
      } else {
        router.push("/documents");
      }
    }
  }, [historyIndex, navigationHistory, router]);

  // Custom forward navigation
  const handleForward = useCallback(() => {
    if (historyIndex < navigationHistory.length - 1) {
      const newIndex = historyIndex + 1;
      const folderId = navigationHistory[newIndex];
      setHistoryIndex(newIndex);

      if (folderId) {
        router.push(`/documents?folder=${folderId}`);
      } else {
        router.push("/documents");
      }
    }
  }, [historyIndex, navigationHistory, router]);

  // Go to root
  const handleGoHome = useCallback(() => {
    handleFolderNavigate(null);
  }, [handleFolderNavigate]);

  // Refresh
  const handleRefresh = useCallback(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleSortChange = (field: SortField, direction: SortDirection) => {
    setSortField(field);
    setSortDirection(direction);
  };

  // Get current path string for address bar
  const getCurrentPath = useCallback(() => {
    if (!currentFolderId) return "/";
    const path = breadcrumbPath.map((f) => f.name).join("/");
    return "/" + path;
  }, [currentFolderId, breadcrumbPath]);

  // Drop multiple PDFs anywhere on the page (explorer-like UX). The
  // overlay only shows when the user drags actual files from the OS;
  // internal drag-and-drop (folder reorganization) doesn't trigger it
  // because Radix DnD doesn't put `Files` in dataTransfer.types.
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);

  const handleFilesDropped = useCallback(
    async (files: FileList | File[]) => {
      const pdfFiles = Array.from(files).filter((f) =>
        f.name.toLowerCase().endsWith(".pdf"),
      );
      if (pdfFiles.length === 0) {
        setError(t("errors.pdfOnly"));
        return;
      }
      setUploading(true);
      setError(null);
      try {
        // Upload sequentially — keeps backend pressure low and gives
        // a more predictable progress UX. Future: parallel with
        // Promise.allSettled for faster bulk import.
        for (const file of pdfFiles) {
          const uploadResult = await api.uploadDocument(file);
          const { getAuthToken } = await import("@/lib/api");
          const token = await getAuthToken();
          const downloadRes = await fetch(
            `/api/v1/documents/${uploadResult.document_id}/download`,
            {
              credentials: "include",
              headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            },
          );
          if (!downloadRes.ok) {
            throw new Error(`Failed to download PDF: ${downloadRes.status}`);
          }
          const pdfBlob = await downloadRes.blob();
          await api.saveDocument({
            file: pdfBlob,
            name: file.name.replace(/\.pdf$/i, ""),
            tags: [],
            folderId: currentFolderId || undefined,
          });
        }
        await loadDocuments();
      } catch (err) {
        clientLogger.error("documents.drop-upload-failed", err);
        setError(
          err instanceof Error ? err.message : t("errors.uploadFailed"),
        );
      } finally {
        setUploading(false);
      }
    },
    [currentFolderId, loadDocuments, t],
  );

  // Filter documents for current folder when not searching
  const displayDocuments = debouncedSearch
    ? documents
    : documents.filter((doc) => (doc.folderId || null) === currentFolderId);

  const displayFolders = debouncedSearch
    ? []
    : folders.filter((folder) => folder.parentId === currentFolderId);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < navigationHistory.length - 1;

  return (
    <div
      className="space-y-4 relative min-h-[calc(100vh-4rem)]"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current -= 1;
        if (dragDepthRef.current <= 0) {
          dragDepthRef.current = 0;
          setIsDraggingFiles(false);
        }
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleFilesDropped(e.dataTransfer.files);
        }
      }}
    >
      {/* Drop zone overlay — only visible while dragging external files */}
      {isDraggingFiles && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-4 border-dashed border-primary/60 pointer-events-none"
          style={{ pointerEvents: "none" }}
        >
          <div className="bg-background rounded-lg shadow-2xl px-8 py-6 flex items-center gap-4">
            <Upload className="h-12 w-12 text-primary" />
            <div>
              <p className="text-xl font-semibold">{t("upload.dropTitle")}</p>
              <p className="text-sm text-muted-foreground">
                {t("upload.dropHint")}
              </p>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {total > 0 ? t("totalCount", { count: total }) : t("subtitle")}
          </p>
        </div>
        <Button
          className="gap-2"
          onClick={handleNewDocument}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Upload className="h-4 w-4 animate-pulse" />
              {t("upload.uploading")}
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              {t("newDocument")}
            </>
          )}
        </Button>
      </div>

      {/* Navigation Bar - File Explorer Style */}
      <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg border">
        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            disabled={!canGoBack}
            title={t("explorer.back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleForward}
            disabled={!canGoForward}
            title={t("explorer.forward")}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleGoHome}
            disabled={!currentFolderId}
            title={t("explorer.home")}
          >
            <Home className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={loading}
            title={t("explorer.refresh")}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Address bar */}
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-background rounded border min-w-0">
          <span className="text-sm text-muted-foreground truncate">
            {getCurrentPath()}
          </span>
        </div>

        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("search")}
            className="pl-10 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        </div>
      ) : displayDocuments.length === 0 &&
        displayFolders.length === 0 &&
        !debouncedSearch ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
          <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">{t("noDocuments.title")}</h3>
          <p className="mb-4 text-muted-foreground">
            {t("noDocuments.description")}
          </p>
          <Button onClick={handleNewDocument}>
            <Plus className="mr-2 h-4 w-4" />
            {t("upload.title")}
          </Button>
        </div>
      ) : displayDocuments.length === 0 &&
        displayFolders.length === 0 &&
        debouncedSearch ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
          <Search className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">
            {t("noDocuments.noResults")}
          </h3>
          <p className="text-muted-foreground">
            {t("noDocuments.noResultsDescription", { search: debouncedSearch })}
          </p>
        </div>
      ) : (
        <>
          <DocumentExplorer
            documents={documents}
            folders={folders}
            currentFolderId={currentFolderId}
            breadcrumbPath={breadcrumbPath}
            viewMode={viewMode}
            sortField={sortField}
            sortDirection={sortDirection}
            onViewModeChange={setViewMode}
            onSortChange={handleSortChange}
            onFolderNavigate={handleFolderNavigate}
            onRefresh={loadDocuments}
            onCreateFolder={handleCreateFolder}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {t("pagination.page", { current: page, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
