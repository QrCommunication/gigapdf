"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { DocumentExplorer, ViewMode } from "@/components/dashboard/document-explorer";
import { SortField, SortDirection } from "@/components/dashboard/document-table";
import { BreadcrumbFolder } from "@/components/dashboard/folder-breadcrumb";
import { Button, Input, Skeleton, useToast } from "@giga-pdf/ui";
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
import { api, getAuthToken, StoredDocument } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";

interface Document {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  folderId?: string | null;
  tags: string[];
  thumbnailUrl: string | null;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Office formats convertible to PDF via /api/office/upload: modern + legacy
// Microsoft formats and OpenDocument. Kept in sync with the office route
// contract (25MB max, returns the converted PDF binary).
const OFFICE_EXTENSION_REGEX = /\.(docx|doc|xlsx|xls|pptx|ppt|odt|ods|odp)$/i;
const OFFICE_ACCEPT = ".docx,.doc,.xlsx,.xls,.pptx,.ppt,.odt,.ods,.odp";
const UPLOAD_ACCEPT = `.pdf,${OFFICE_ACCEPT}`;
const MAX_OFFICE_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// Pool size for parallel imports. Unbounded Promise.allSettled would open
// one full pipeline (convert + upload + download + save) per file and
// overwhelm the backend on large drops; sequential is too slow.
const UPLOAD_CONCURRENCY = 3;

interface ImportSuccess {
  ok: true;
  name: string;
}

interface ImportFailure {
  ok: false;
  name: string;
  reason: string;
}

type ImportOutcome = ImportSuccess | ImportFailure;

/**
 * Run `worker` over `items` with at most `concurrency` workers in flight.
 * Results preserve the input order. Workers are expected to handle their
 * own errors (a rejection aborts the remaining items of that runner).
 */
async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;

  const runner = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  };

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runner()));
  return results;
}

// Thumbnail rendering bounds (PNG ≤ 2 MB backend limit is comfortable at
// this size) and client-side cap for the extracted full-text material
// (the backend truncates at the same threshold).
const THUMBNAIL_MAX_WIDTH = 480;
const THUMBNAIL_MAX_HEIGHT = 640;
const EXTRACTED_TEXT_MAX_CHARS = 500_000;

/**
 * Render page 1 of a PDF as a PNG thumbnail via POST /api/pdf/preview
 * (mode=thumbnail, magic-bytes friendly PNG). Best-effort: returns null on
 * any failure and never throws — a missing thumbnail must not fail an import.
 */
async function renderPdfThumbnail(pdfFile: File): Promise<Blob | null> {
  try {
    const fd = new FormData();
    fd.append("file", pdfFile);
    fd.append("mode", "thumbnail");
    fd.append("pageNumber", "1");
    fd.append("format", "png");
    fd.append("maxWidth", String(THUMBNAIL_MAX_WIDTH));
    fd.append("maxHeight", String(THUMBNAIL_MAX_HEIGHT));

    const res = await fetch("/api/pdf/preview", {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    if (!res.ok) {
      clientLogger.warn("documents.thumbnail-render-failed", res.status);
      return null;
    }
    return await res.blob();
  } catch (err) {
    clientLogger.warn("documents.thumbnail-render-failed", err);
    return null;
  }
}

/**
 * Extract the plain text of a PDF via POST /api/pdf/parse (extractText only,
 * everything else disabled). NOTE: /api/pdf/text is an element add/update
 * route, NOT an extractor — parse is the actual extraction contract. The
 * text content of every parsed text element is concatenated per page.
 * Best-effort: returns null on any failure and never throws.
 */
async function extractPdfText(pdfFile: File): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.append("file", pdfFile);
    fd.append("extractText", "true");
    fd.append("extractImages", "false");
    fd.append("extractDrawings", "false");
    fd.append("extractAnnotations", "false");
    fd.append("extractFormFields", "false");
    fd.append("extractBookmarks", "false");

    const res = await fetch("/api/pdf/parse", {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    if (!res.ok) {
      clientLogger.warn("documents.text-extract-failed", res.status);
      return null;
    }

    const json = (await res.json()) as {
      success?: boolean;
      data?: {
        pages?: Array<{
          elements?: Array<{ type?: string; content?: string }>;
        }>;
      };
    };
    if (!json.success || !json.data?.pages) return null;

    const text = json.data.pages
      .map((page) =>
        (page.elements ?? [])
          .filter(
            (element) =>
              element.type === "text" && typeof element.content === "string",
          )
          .map((element) => element.content)
          .join(" "),
      )
      .filter((pageText) => pageText.length > 0)
      .join("\n\n")
      .trim();

    return text ? text.slice(0, EXTRACTED_TEXT_MAX_CHARS) : null;
  } catch (err) {
    clientLogger.warn("documents.text-extract-failed", err);
    return null;
  }
}

/** Build the /documents URL preserving folder and tag query params. */
function buildDocumentsUrl(folderId: string | null, tag: string | null): string {
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  if (tag) params.set("tag", tag);
  const queryString = params.toString();
  return queryString ? `/documents?${queryString}` : "/documents";
}

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const officeFileInputRef = useRef<HTMLInputElement>(null);

  // Get current folder + tag filter from URL
  const currentFolderId = searchParams?.get("folder") || null;
  const currentTag = searchParams?.get("tag") || null;

  // Navigation history for custom back/forward
  const [navigationHistory, setNavigationHistory] = useState<(string | null)[]>([null]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Data states
  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [userTags, setUserTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // Exact batch progress: one tick per settled file (success or failure).
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
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

      // Active search or tag filter = flat results across all folders, so
      // the folder constraint is dropped from the backend query too.
      const isFiltering = Boolean(debouncedSearch || currentTag);

      // Load documents for current folder (or flat filtered results)
      const response = await api.listDocuments({
        page,
        per_page: 50,
        search: debouncedSearch || undefined,
        tag: currentTag || undefined,
        folder_id: isFiltering ? undefined : currentFolderId || undefined,
      });

      const transformedDocs: Document[] = response.items.map(
        (doc: StoredDocument) => ({
          id: doc.stored_document_id,
          name: doc.name,
          size: doc.file_size_bytes || 0,
          createdAt: new Date(doc.created_at),
          updatedAt: new Date(doc.modified_at),
          folderId: doc.folder_id || null,
          tags: doc.tags ?? [],
          thumbnailUrl: doc.thumbnail_url ?? null,
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

      // Load the distinct user tags (toolbar filter dropdown). Best-effort:
      // the explorer simply hides the filter when the list is empty.
      try {
        setUserTags(await api.getUserTags());
      } catch (tagsErr) {
        clientLogger.warn("documents.load-tags-failed", tagsErr);
        setUserTags([]);
      }
    } catch (err) {
      clientLogger.error("documents.load-failed", err);
      setError(t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, currentFolderId, currentTag, t]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleNewDocument = () => {
    fileInputRef.current?.click();
  };

  const handleNewOfficeDocument = () => {
    officeFileInputRef.current?.click();
  };

  // Routes one file through the right pipeline by extension:
  // - .pdf  -> standard pipeline (uploadDocument -> download -> saveDocument)
  // - Office (.docx/.doc/.xlsx/.xls/.pptx/.ppt/.odt/.ods/.odp)
  //   -> POST /api/office/upload (returns the converted PDF binary), then the
  //      same standard pipeline. An Office file becomes editable like a PDF.
  // Never throws: every failure is returned as an ImportFailure with a
  // precise per-file reason, so one bad file cannot abort the batch.
  const importSingleFile = useCallback(
    async (file: File): Promise<ImportOutcome> => {
      const lowerName = file.name.toLowerCase();
      const isPdf = lowerName.endsWith(".pdf");
      const isOffice = OFFICE_EXTENSION_REGEX.test(lowerName);

      // Client-side validation: extension + size, per-file precise reason.
      if (!isPdf && !isOffice) {
        return { ok: false, name: file.name, reason: t("upload.invalidFormat") };
      }
      if (isOffice && file.size > MAX_OFFICE_FILE_SIZE_BYTES) {
        return { ok: false, name: file.name, reason: t("office.importErrorSize") };
      }

      try {
        let pdfFile: File;
        let baseName: string;

        if (isPdf) {
          pdfFile = file;
          baseName = file.name.replace(/\.pdf$/i, "");
        } else {
          // 1) Office -> PDF conversion (server-side)
          const formData = new FormData();
          formData.append("file", file);
          const convertRes = await fetch("/api/office/upload", {
            method: "POST",
            credentials: "include",
            body: formData,
          });
          if (!convertRes.ok) {
            const reason =
              convertRes.status === 503
                ? t("office.importErrorService")
                : convertRes.status === 413
                  ? t("office.importErrorSize")
                  : t("office.importErrorConvert");
            return { ok: false, name: file.name, reason };
          }
          const pdfBlob = await convertRes.blob();
          baseName = file.name.replace(OFFICE_EXTENSION_REGEX, "");
          pdfFile = new File([pdfBlob], `${baseName}.pdf`, {
            type: "application/pdf",
          });
        }

        // 2) Standard PDF pipeline: upload -> download -> save to storage.
        // Thumbnail rendering + full-text extraction start in parallel with
        // the upload; both helpers are best-effort (resolve to null, never
        // reject), so they cannot fail the import nor skew the progress
        // counter (one tick per settled file, unchanged).
        const thumbnailPromise = renderPdfThumbnail(pdfFile);
        const extractedTextPromise = extractPdfText(pdfFile);

        const uploadResult = await api.uploadDocument(pdfFile);
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
        const finalPdfBlob = await downloadRes.blob();
        const extractedText = await extractedTextPromise;
        const saved = await api.saveDocument({
          file: finalPdfBlob,
          name: baseName,
          tags: [],
          folderId: currentFolderId || undefined,
          extractedText: extractedText ?? undefined,
        });

        // 3) Best-effort thumbnail upload (needs the stored document id,
        // hence after save). A failure is logged and silently ignored.
        try {
          const thumbnail = await thumbnailPromise;
          if (thumbnail) {
            await api.uploadDocumentThumbnail(
              saved.stored_document_id,
              thumbnail,
              `${baseName}.png`,
            );
          }
        } catch (thumbErr) {
          clientLogger.warn("documents.thumbnail-upload-failed", thumbErr);
        }

        return { ok: true, name: file.name };
      } catch (err) {
        clientLogger.error("documents.import-file-failed", err);
        return {
          ok: false,
          name: file.name,
          reason: err instanceof Error ? err.message : t("errors.uploadFailed"),
        };
      }
    },
    [currentFolderId, t],
  );

  // Imports a batch of files through a bounded concurrency pool (3 parallel
  // pipelines). The progress counter ticks exactly once per settled file and
  // a summary toast reports successes/failures (with file names) at the end.
  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setUploading(true);
      setError(null);
      setUploadProgress({ done: 0, total: files.length });

      try {
        const outcomes = await runWithConcurrency(
          files,
          UPLOAD_CONCURRENCY,
          async (file) => {
            const outcome = await importSingleFile(file);
            setUploadProgress((prev) =>
              prev ? { ...prev, done: prev.done + 1 } : prev,
            );
            return outcome;
          },
        );

        const failures = outcomes.filter(
          (outcome): outcome is ImportFailure => !outcome.ok,
        );
        const successCount = outcomes.length - failures.length;

        if (failures.length === 0) {
          toast({
            title: t("upload.summaryAllSuccess", { count: successCount }),
          });
        } else {
          toast({
            variant: "destructive",
            title:
              successCount === 0
                ? t("upload.summaryAllFailed", { count: failures.length })
                : t("upload.summaryPartial", {
                    success: successCount,
                    failed: failures.length,
                  }),
            description: (
              <span>
                {failures.map((failure, index) => (
                  <span key={`${failure.name}-${index}`} className="block">
                    {failure.name} : {failure.reason}
                  </span>
                ))}
              </span>
            ),
          });
        }

        if (successCount > 0) {
          await loadDocuments();
        }
      } finally {
        setUploading(false);
        setUploadProgress(null);
      }
    },
    [importSingleFile, loadDocuments, t, toast],
  );

  // Shared by both hidden file inputs (PDF + Office): extension routing is
  // handled per file inside processFiles/importSingleFile.
  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    // Reset immediately: the File references stay valid after clearing.
    event.target.value = "";
    void processFiles(files);
  };

  const handleCreateFolder = async (name: string, parentId: string | null) => {
    await api.createFolder(name, parentId);
  };

  // Navigate to folder using URL. Folder browsing is an explicit context
  // switch: it clears any active tag filter (flat results would otherwise
  // contradict the folder the user just opened).
  const handleFolderNavigate = useCallback((folderId: string | null) => {
    // Update navigation history
    const newHistory = [...navigationHistory.slice(0, historyIndex + 1), folderId];
    setNavigationHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);

    // Update URL
    router.push(buildDocumentsUrl(folderId, null));
    setPage(1);
  }, [router, navigationHistory, historyIndex]);

  // Toggle the tag filter (URL-driven, folder context preserved)
  const handleTagChange = useCallback(
    (tag: string | null) => {
      router.push(buildDocumentsUrl(currentFolderId, tag));
      setPage(1);
    },
    [router, currentFolderId],
  );

  // Custom back navigation
  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const folderId = navigationHistory[newIndex];
      setHistoryIndex(newIndex);
      router.push(buildDocumentsUrl(folderId ?? null, null));
    }
  }, [historyIndex, navigationHistory, router]);

  // Custom forward navigation
  const handleForward = useCallback(() => {
    if (historyIndex < navigationHistory.length - 1) {
      const newIndex = historyIndex + 1;
      const folderId = navigationHistory[newIndex];
      setHistoryIndex(newIndex);
      router.push(buildDocumentsUrl(folderId ?? null, null));
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

  // Drop multiple files anywhere on the page (explorer-like UX). PDFs and
  // Office documents are accepted; each file is routed/validated
  // individually by processFiles. The overlay only shows when the user
  // drags actual files from the OS; internal drag-and-drop (folder
  // reorganization) doesn't trigger it because Radix DnD doesn't put
  // `Files` in dataTransfer.types.
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);

  const handleFilesDropped = useCallback(
    (files: FileList | File[]) => {
      void processFiles(Array.from(files));
    },
    [processFiles],
  );

  // Active search OR tag filter = flat results (no folder grouping)
  const isFiltering = Boolean(debouncedSearch || currentTag);

  // Filter documents for current folder when not filtering
  const displayDocuments = isFiltering
    ? documents
    : documents.filter((doc) => (doc.folderId || null) === currentFolderId);

  const displayFolders = isFiltering
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
        accept={UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <input
        ref={officeFileInputRef}
        type="file"
        accept={OFFICE_ACCEPT}
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {total > 0 ? t("totalCount", { count: total }) : t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleNewOfficeDocument}
            disabled={uploading}
          >
            <Upload className="h-4 w-4" />
            {t("office.import")}
          </Button>
          <Button
            className="gap-2"
            onClick={handleNewDocument}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Upload className="h-4 w-4 animate-pulse" />
                {uploadProgress && uploadProgress.total > 1
                  ? t("upload.uploadingProgress", {
                      done: uploadProgress.done,
                      total: uploadProgress.total,
                    })
                  : t("upload.uploading")}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t("newDocument")}
              </>
            )}
          </Button>
        </div>
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
        !isFiltering ? (
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
        isFiltering ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
          <Search className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">
            {t("noDocuments.noResults")}
          </h3>
          <p className="text-muted-foreground">
            {t("noDocuments.noResultsDescription", {
              search: debouncedSearch || currentTag || "",
            })}
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
            flattenResults={isFiltering}
            availableTags={userTags}
            currentTag={currentTag}
            onTagChange={handleTagChange}
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
