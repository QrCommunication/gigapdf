"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { DataTable } from "@/components/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { fr, enUS } from "date-fns/locale";
import { Badge } from "@giga-pdf/ui";
import { RefreshCw, X, CheckCircle, Loader2, AlertCircle, RotateCcw, Trash2 } from "lucide-react";
import { jobsApi, type Job, type JobStats } from "@/lib/api";

const getStatusVariant = (status: string) => {
  switch (status) {
    case "completed":
      return "default";
    case "processing":
      return "secondary";
    case "failed":
      return "destructive";
    case "cancelled":
      return "outline";
    default:
      return "outline";
  }
};

export default function JobsPage() {
  const t = useTranslations("jobs");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const dateLocale = locale === "fr" ? fr : enUS;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<JobStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const columns: ColumnDef<Job>[] = useMemo(() => [
    {
      accessorKey: "job_type",
      header: t("table.type"),
      cell: ({ row }) => (
        <div>
          <div className="font-medium capitalize">{row.getValue("job_type")}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {row.original.id.slice(0, 8)}...
          </div>
        </div>
      ),
    },
    {
      accessorKey: "owner_id",
      header: t("table.tenant"),
      cell: ({ row }) => (
        <div className="font-mono text-xs">
          {(row.getValue("owner_id") as string).slice(0, 12)}...
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: t("table.status"),
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        return (
          <Badge variant={getStatusVariant(status) as "default" | "secondary" | "destructive" | "outline"}>
            {status}
          </Badge>
        );
      },
    },
    {
      accessorKey: "progress",
      header: t("table.progress"),
      cell: ({ row }) => {
        const progress = row.getValue("progress") as number;
        const status = row.original.status;
        return (
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  status === "failed" ? "bg-destructive" : "bg-primary"
                }`}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {Math.round(progress * 100)}%
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "created_at",
      header: t("table.createdAt"),
      cell: ({ row }) => {
        const date = row.getValue("created_at") as string;
        return formatDistanceToNow(new Date(date), { addSuffix: true, locale: dateLocale });
      },
    },
    {
      accessorKey: "duration_seconds",
      header: t("table.duration"),
      cell: ({ row }) => {
        const duration = row.getValue("duration_seconds") as number | undefined;
        if (!duration) return "-";
        if (duration < 60) return `${duration.toFixed(1)}s`;
        return `${(duration / 60).toFixed(1)}m`;
      },
    },
    {
      id: "actions",
      header: t("table.actions"),
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <div className="flex items-center gap-2">
            {(status === "pending" || status === "processing") && (
              <button className="rounded-md p-2 hover:bg-accent" title={tCommon("cancel")}>
                <X className="h-4 w-4 text-destructive" />
              </button>
            )}
            {status === "failed" && (
              <button className="rounded-md p-2 hover:bg-accent" title={tCommon("retry")}>
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            {status === "completed" && (
              <CheckCircle className="h-4 w-4 text-green-600" />
            )}
            {(status === "completed" || status === "failed" || status === "cancelled") && (
              <button className="rounded-md p-2 hover:bg-accent" title={tCommon("delete")}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        );
      },
    },
  ], [t, tCommon, dateLocale]);

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [jobsResponse, statsResponse] = await Promise.all([
        jobsApi.list({
          page: 1,
          page_size: 50,
          status: statusFilter || undefined,
        }),
        jobsApi.getStats(),
      ]);
      setJobs(jobsResponse.jobs);
      setStats(statsResponse);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
      setError(err instanceof Error ? err.message : tCommon("error"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, tCommon]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(fetchJobs, 10000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  if (loading && jobs.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">{error}</p>
        <button
          onClick={fetchJobs}
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
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <button
          onClick={fetchJobs}
          disabled={loading}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`mr-2 h-4 w-4 inline ${loading ? "animate-spin" : ""}`} />
          {tCommon("refresh")}
        </button>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-5">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">{tCommon("total")}</div>
            <div className="text-2xl font-bold">{stats.total_jobs}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">{t("status.pending")}</div>
            <div className="text-2xl font-bold text-yellow-600">{stats.pending_jobs}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">{t("status.running")}</div>
            <div className="text-2xl font-bold text-blue-600">{stats.processing_jobs}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">{t("status.completed")}</div>
            <div className="text-2xl font-bold text-green-600">{stats.completed_jobs}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">{t("status.failed")}</div>
            <div className="text-2xl font-bold text-red-600">{stats.failed_jobs}</div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">{t("filters.allStatuses")}</option>
          <option value="pending">{t("status.pending")}</option>
          <option value="processing">{t("status.running")}</option>
          <option value="completed">{t("status.completed")}</option>
          <option value="failed">{t("status.failed")}</option>
          <option value="cancelled">{t("status.cancelled")}</option>
        </select>
      </div>

      <DataTable columns={columns} data={jobs} searchKey="job_type" />
    </div>
  );
}
