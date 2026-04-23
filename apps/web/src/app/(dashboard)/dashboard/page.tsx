"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { DocumentGrid } from "@/components/dashboard/document-grid";
import { Button, Skeleton } from "@giga-pdf/ui";
import { Plus, Upload } from "lucide-react";
import { api, StoredDocument, QuotaSummary } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";

interface DashboardDocument {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tDocs = useTranslations("documents");
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<DashboardDocument[]>([]);
  const [quota, setQuota] = useState<QuotaSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch documents and quota in parallel
      const [docsResponse, quotaResponse] = await Promise.all([
        api.listDocuments({ per_page: 6 }).catch(() => ({ items: [], pagination: { total: 0, page: 1, per_page: 6, total_pages: 0 } })),
        api.getQuota().catch(() => null),
      ]);

      // Transform documents to the expected format
      const transformedDocs: DashboardDocument[] = docsResponse.items.map((doc: StoredDocument) => ({
        id: doc.stored_document_id,
        name: doc.name,
        size: doc.file_size_bytes || 0,
        createdAt: new Date(doc.created_at),
        updatedAt: new Date(doc.modified_at),
      }));

      setDocuments(transformedDocs);
      setQuota(quotaResponse);
    } catch (err) {
      clientLogger.error("dashboard.load-failed", err);
      setError(tDocs("upload.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleNewDocument = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError(tDocs("upload.error"));
      return;
    }

    try {
      setUploading(true);
      setError(null);

      // Upload the document
      const uploadResult = await api.uploadDocument(file);

      // Fetch the PDF Blob from the server before saving
      const downloadRes = await fetch(
        `/api/v1/documents/${uploadResult.document_id}/download`,
        { credentials: "include" }
      );
      if (!downloadRes.ok) {
        throw new Error(`Failed to download PDF: ${downloadRes.status}`);
      }
      const pdfBlob = await downloadRes.blob();

      // Save to storage with the PDF Blob
      await api.saveDocument({
        file: pdfBlob,
        name: file.name.replace(".pdf", ""),
        tags: [],
      });

      // Reload dashboard data
      await loadDashboardData();

    } catch (err) {
      clientLogger.error("dashboard.upload-failed", err);
      setError(err instanceof Error ? err.message : tDocs("upload.error"));
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const totalDocuments = quota?.documents.count ?? documents.length;
  const totalSize = quota?.storage.used_bytes ?? documents.reduce((acc, doc) => acc + doc.size, 0);
  const recentDocuments = documents.filter(
    (doc) => doc.updatedAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  ).length;

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-48" />
            <Skeleton className="mt-2 h-5 w-96" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <div>
          <Skeleton className="mb-4 h-8 w-48" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {t("welcome")}
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
              {tDocs("upload.uploading")}
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              {t("newDocument")}
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <StatsCards
        totalDocuments={totalDocuments}
        totalSize={totalSize}
        recentDocuments={recentDocuments}
      />

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">{t("recentDocuments")}</h2>
          {documents.length > 0 && (
            <Button variant="outline" onClick={() => router.push("/documents")}>
              {t("allDocuments")}
            </Button>
          )}
        </div>

        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
            <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">{t("noDocuments.title")}</h3>
            <p className="mb-4 text-muted-foreground">
              {t("noDocuments.description")}
            </p>
            <Button onClick={handleNewDocument}>
              <Plus className="mr-2 h-4 w-4" />
              {t("uploadDocument")}
            </Button>
          </div>
        ) : (
          <DocumentGrid documents={documents} onDelete={loadDashboardData} />
        )}
      </div>
    </div>
  );
}
