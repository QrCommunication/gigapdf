"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { DocumentExplorer, ViewMode } from "@/components/dashboard/document-explorer";
import { SortField, SortDirection } from "@/components/dashboard/document-table";
import { BreadcrumbFolder } from "@/components/dashboard/folder-breadcrumb";
import { Button, Input, Skeleton } from "@giga-pdf/ui";
import { Plus, Search, Upload, ChevronLeft, ChevronRight } from "lucide-react";
import { api, StoredDocument } from "@/lib/api";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Folder navigation
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
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

      // Load documents
      const response = await api.listDocuments({
        page,
        per_page: 50, // Load more for folder view
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
          (folder: { id: string; name: string; parent_id: string | null; created_at: string; updated_at: string }) => ({
            id: folder.id,
            name: folder.name,
            parentId: folder.parent_id,
            createdAt: new Date(folder.created_at),
            updatedAt: new Date(folder.updated_at),
          })
        );
        setFolders(transformedFolders);
      } catch (folderErr) {
        console.warn("Failed to load folders:", folderErr);
        setFolders([]);
      }
    } catch (err) {
      console.error("Failed to load documents:", err);
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

      await api.saveDocument({
        document_id: uploadResult.document_id,
        name: file.name.replace(".pdf", ""),
        tags: [],
        folder_id: currentFolderId || undefined,
      });

      await loadDocuments();
    } catch (err) {
      console.error("Upload failed:", err);
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

  const handleFolderNavigate = (folderId: string | null) => {
    setCurrentFolderId(folderId);
    setPage(1);
  };

  const handleSortChange = (field: SortField, direction: SortDirection) => {
    setSortField(field);
    setSortDirection(direction);
  };

  // Filter documents for current folder when not searching
  const displayDocuments = debouncedSearch
    ? documents
    : documents.filter((doc) => (doc.folderId || null) === currentFolderId);

  const displayFolders = debouncedSearch
    ? []
    : folders.filter((folder) => folder.parentId === currentFolderId);

  return (
    <div className="space-y-6">
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

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("search")}
          className="pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

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
