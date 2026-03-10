"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { formatDate } from "@/lib/utils";
import { Badge } from "@giga-pdf/ui";
import { Eye, Trash2, RotateCcw, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { documentsApi, type Document } from "@/lib/api";

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const tCommon = useTranslations("common");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const columns: ColumnDef<Document>[] = useMemo(() => [
    {
      accessorKey: "name",
      header: t("table.name"),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.getValue("name")}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {row.original.id.slice(0, 8)}...
          </div>
        </div>
      ),
    },
    {
      accessorKey: "owner_id",
      header: t("table.owner"),
      cell: ({ row }) => (
        <div className="font-mono text-xs">
          {(row.getValue("owner_id") as string).slice(0, 12)}...
        </div>
      ),
    },
    {
      accessorKey: "file_size_formatted",
      header: t("table.size"),
    },
    {
      accessorKey: "page_count",
      header: t("table.pages"),
    },
    {
      accessorKey: "current_version",
      header: "Version",
      cell: ({ row }) => `v${row.getValue("current_version")}`,
    },
    {
      accessorKey: "is_deleted",
      header: t("table.status"),
      cell: ({ row }) => {
        const isDeleted = row.getValue("is_deleted") as boolean;
        return (
          <Badge variant={isDeleted ? "destructive" : "default"}>
            {isDeleted ? t("status.deleted") : t("status.active")}
          </Badge>
        );
      },
    },
    {
      accessorKey: "created_at",
      header: t("table.createdAt"),
      cell: ({ row }) => formatDate(row.getValue("created_at")),
    },
    {
      id: "actions",
      header: t("table.actions"),
      cell: ({ row }) => {
        const isDeleted = row.original.is_deleted;
        return (
          <div className="flex items-center gap-2">
            <button className="rounded-md p-2 hover:bg-accent" title={tCommon("view")}>
              <Eye className="h-4 w-4" />
            </button>
            {isDeleted ? (
              <button className="rounded-md p-2 hover:bg-accent" title={tCommon("retry")}>
                <RotateCcw className="h-4 w-4 text-green-600" />
              </button>
            ) : (
              <button className="rounded-md p-2 hover:bg-accent" title={tCommon("delete")}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </button>
            )}
          </div>
        );
      },
    },
  ], [t, tCommon]);

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await documentsApi.list({
        page: 1,
        page_size: 50,
        include_deleted: includeDeleted,
      });
      setDocuments(response.documents);
    } catch (err) {
      console.error("Failed to fetch documents:", err);
      setError(err instanceof Error ? err.message : tCommon("error"));
    } finally {
      setLoading(false);
    }
  }, [includeDeleted, tCommon]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">{error}</p>
        <button
          onClick={fetchDocuments}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          {tCommon("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => setIncludeDeleted(e.target.checked)}
              className="rounded border-gray-300"
            />
            {t("status.deleted")}
          </label>
          <button
            onClick={fetchDocuments}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <RefreshCw className="mr-2 h-4 w-4 inline" />
            {tCommon("refresh")}
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={documents}
        searchKey="name"
        searchPlaceholder={t("search")}
      />
    </div>
  );
}
