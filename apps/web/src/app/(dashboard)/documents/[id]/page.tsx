"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { storageKeys } from "@giga-pdf/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
  Skeleton,
} from "@giga-pdf/ui";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  FileX,
  History,
  Loader2,
  Pencil,
  RotateCcw,
  Share2,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/utils";
import { ShareDialog } from "@/components/sharing";
import { clientLogger } from "@/lib/client-logger";

interface DocumentPageProps {
  params: Promise<{
    id: string;
  }>;
}

interface DocumentVersion {
  version: number;
  created_at: string;
  created_by: string;
  comment: string | null;
  size_bytes: number;
}

/**
 * Extract the HTTP status attached by the API client to thrown errors.
 */
function getErrorStatus(error: unknown): number | undefined {
  if (error instanceof Error && "status" in error) {
    const status = (error as Error & { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

/**
 * Query key for the loaded session of a stored document.
 * Aligned with the storageKeys factory from @giga-pdf/api:
 * ["storage", "documents", id, "session"].
 */
function sessionKey(storedDocumentId: string) {
  return [...storageKeys.documents(), storedDocumentId, "session"] as const;
}

export default function DocumentPage({ params }: DocumentPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("documents.detail");
  const tCard = useTranslations("documents.card");

  // Dialog states
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [downloading, setDownloading] = useState(false);

  // Load the stored document into a session (same pattern as document-card
  // preview): the session document_id powers the iframe preview + download.
  const sessionQuery = useQuery({
    queryKey: sessionKey(id),
    queryFn: () => api.loadDocument(id),
    retry: (failureCount, error) => {
      // 404 = document does not exist, never retry
      if (getErrorStatus(error) === 404) return false;
      return failureCount < 1;
    },
    staleTime: 30 * 1000,
  });

  // Version history (also provides size + created/modified dates since the
  // storage API has no unitary metadata getter).
  const versionsQuery = useQuery({
    queryKey: storageKeys.versions(id),
    queryFn: () => api.getDocumentVersions(id),
    enabled: sessionQuery.isSuccess,
    staleTime: 30 * 1000,
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => api.renameDocument(id, name),
    onSuccess: () => {
      setRenameDialogOpen(false);
      // Invalidates the session (name), versions and documents list at once.
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
    onError: (error) => {
      clientLogger.error("document-detail.rename-failed", error);
      alert(tCard("errors.renameFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteDocument(id),
    onSuccess: () => {
      setDeleteDialogOpen(false);
      queryClient.removeQueries({ queryKey: [...storageKeys.documents(), id] });
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
      router.push("/documents");
    },
    onError: (error) => {
      clientLogger.error("document-detail.delete-failed", error);
      alert(tCard("errors.deleteFailed"));
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => api.restoreOriginalDocument(id),
    onSuccess: () => {
      setRestoreDialogOpen(false);
      // The PDF content changed: refresh versions AND reload the session so
      // the preview iframe points to a fresh session document.
      queryClient.invalidateQueries({ queryKey: storageKeys.versions(id) });
      queryClient.invalidateQueries({ queryKey: sessionKey(id) });
    },
    onError: (error) => {
      clientLogger.error("document-detail.restore-failed", error);
      alert(t("restoreDialog.error"));
    },
  });

  const handleDownload = async () => {
    try {
      setDownloading(true);
      // Re-load before download: session document ids are transient and must
      // not be reused across operations.
      const result = await api.loadDocument(id);
      const downloadUrl = api.getDocumentDownloadUrl(result.document_id);
      window.open(downloadUrl, "_blank");
    } catch (error) {
      clientLogger.error("document-detail.download-failed", error);
      alert(tCard("errors.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  };

  const handleRename = () => {
    const session = sessionQuery.data;
    if (!session) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === session.name) {
      setRenameDialogOpen(false);
      return;
    }
    renameMutation.mutate(trimmed);
  };

  const openRenameDialog = () => {
    setNewName(sessionQuery.data?.name ?? "");
    setRenameDialogOpen(true);
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (sessionQuery.isPending) {
    return <DocumentDetailSkeleton backLabel={t("back")} />;
  }

  // ── Error states ───────────────────────────────────────────────────────────
  if (sessionQuery.isError) {
    const isNotFound = getErrorStatus(sessionQuery.error) === 404;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <FileX className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">
            {isNotFound ? t("errors.notFoundTitle") : t("errors.loadFailedTitle")}
          </h1>
          <p className="text-muted-foreground">
            {isNotFound
              ? t("errors.notFoundDescription")
              : t("errors.loadFailedDescription")}
          </p>
        </div>
        <div className="flex gap-2">
          {!isNotFound && (
            <Button variant="outline" onClick={() => sessionQuery.refetch()}>
              {t("errors.retry")}
            </Button>
          )}
          <Link href="/documents">
            <Button className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("back")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const session = sessionQuery.data;
  const documentName = session.name;
  const previewUrl = api.getDocumentDownloadUrl(session.document_id);

  const versionsData = versionsQuery.data;
  const versions: DocumentVersion[] = versionsData?.versions ?? [];
  const sortedVersions = [...versions].sort((a, b) => b.version - a.version);
  const currentVersion = versionsData
    ? versions.find((v) => v.version === versionsData.current_version)
    : undefined;
  const oldestVersion =
    versions.length > 0
      ? versions.reduce((min, v) => (v.version < min.version ? v : min))
      : undefined;
  const latestVersion = sortedVersions[0];
  const canRestoreOriginal = versions.length > 1;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/documents"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("back")}
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
            <FileText className="h-6 w-6 text-red-500" />
          </div>
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-2xl font-bold sm:text-3xl" title={documentName}>
              {documentName}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {latestVersion && (
                <span>
                  {t("lastModified", { date: formatDate(latestVersion.created_at) })}
                </span>
              )}
              {currentVersion && <span>{formatBytes(currentVersion.size_bytes)}</span>}
              <Badge variant="secondary">
                {t("info.pagesValue", { count: session.page_count })}
              </Badge>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/editor/${id}`}>
            <Button className="gap-2">
              <ExternalLink className="h-4 w-4" />
              {t("actions.edit")}
            </Button>
          </Link>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t("actions.download")}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setShareDialogOpen(true)}
          >
            <Share2 className="h-4 w-4" />
            {t("actions.share")}
          </Button>
          <Button variant="outline" className="gap-2" onClick={openRenameDialog}>
            <Pencil className="h-4 w-4" />
            {t("actions.rename")}
          </Button>
          <Button
            variant="outline"
            className="gap-2 text-destructive hover:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            {t("actions.delete")}
          </Button>
        </div>
      </div>

      {/* Content grid: preview (dominant) + side panel */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* PDF Preview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("preview.title")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[65vh] min-h-[420px] overflow-hidden rounded-b-xl border-t bg-muted/30">
              <iframe
                src={`${previewUrl}#toolbar=0&navpanes=0`}
                className="h-full w-full border-0"
                title={documentName}
              />
            </div>
          </CardContent>
        </Card>

        {/* Side panel */}
        <div className="space-y-6">
          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle>{t("info.title")}</CardTitle>
              <CardDescription>{t("info.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <MetadataRow label={t("info.fileName")} value={documentName} />
              <Separator />
              <MetadataRow label={t("info.fileType")} value="PDF" />
              <Separator />
              <MetadataRow
                label={t("info.fileSize")}
                value={
                  currentVersion ? formatBytes(currentVersion.size_bytes) : "--"
                }
              />
              <Separator />
              <MetadataRow
                label={t("info.pages")}
                value={t("info.pagesValue", { count: session.page_count })}
              />
              <Separator />
              <MetadataRow
                label={t("info.created")}
                value={oldestVersion ? formatDate(oldestVersion.created_at) : "--"}
              />
              <Separator />
              <MetadataRow
                label={t("info.lastModified")}
                value={latestVersion ? formatDate(latestVersion.created_at) : "--"}
              />
            </CardContent>
          </Card>

          {/* Version history */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4" />
                {t("versions.title")}
              </CardTitle>
              <CardDescription>{t("versions.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              {versionsQuery.isPending ? (
                <div className="space-y-3">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : versionsQuery.isError ? (
                <div className="space-y-2 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t("versions.loadFailed")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => versionsQuery.refetch()}
                  >
                    {t("errors.retry")}
                  </Button>
                </div>
              ) : sortedVersions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("versions.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {sortedVersions.map((version) => {
                    const isCurrent =
                      version.version === versionsData?.current_version;
                    return (
                      <li
                        key={version.version}
                        className={`rounded-lg border p-3 ${
                          isCurrent ? "border-primary/40 bg-primary/5" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {t("versions.version", { version: version.version })}
                          </p>
                          {isCurrent && (
                            <Badge>{t("versions.current")}</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(version.created_at)} ·{" "}
                          {formatBytes(version.size_bytes)}
                        </p>
                        {version.comment && (
                          <p
                            className="mt-1 truncate text-xs italic text-muted-foreground"
                            title={version.comment}
                          >
                            {version.comment}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
            {canRestoreOriginal && (
              <CardFooter>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => setRestoreDialogOpen(true)}
                  disabled={restoreMutation.isPending}
                >
                  <RotateCcw className="h-4 w-4" />
                  {t("versions.restoreOriginal")}
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCard("renameDialog.title")}</DialogTitle>
            <DialogDescription>{tCard("renameDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="document-detail-name">{tCard("renameDialog.label")}</Label>
            <Input
              id="document-detail-name"
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
              disabled={renameMutation.isPending}
            >
              {tCard("renameDialog.cancel")}
            </Button>
            <Button
              onClick={handleRename}
              disabled={renameMutation.isPending || !newName.trim()}
            >
              {renameMutation.isPending ? (
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCard("deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {tCard("deleteDialog.description", { name: documentName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleteMutation.isPending}
            >
              {tCard("deleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
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

      {/* Restore Original Confirmation Dialog */}
      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("restoreDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("restoreDialog.description", { name: documentName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRestoreDialogOpen(false)}
              disabled={restoreMutation.isPending}
            >
              {t("restoreDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => restoreMutation.mutate()}
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("restoreDialog.restoring")}
                </>
              ) : (
                t("restoreDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Dialog (reused component) */}
      <ShareDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        documentId={id}
        documentName={documentName}
      />
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <p className="shrink-0 text-sm font-medium">{label}</p>
      <p className="min-w-0 truncate text-right text-sm text-muted-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}

function DocumentDetailSkeleton({ backLabel }: { backLabel: string }) {
  return (
    <div className="space-y-6">
      <Link
        href="/documents"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-[65vh] min-h-[420px] lg:col-span-2" />
        <div className="space-y-6">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </div>
  );
}
