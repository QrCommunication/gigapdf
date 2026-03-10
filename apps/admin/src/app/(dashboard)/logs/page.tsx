"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { DataTable } from "@/components/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@giga-pdf/ui";
import { AlertCircle, Info, AlertTriangle, CheckCircle, Loader2, RefreshCw, Download } from "lucide-react";
import { logsApi, type LogEntry, type LogStats } from "@/lib/api";
import { useTranslations } from "next-intl";

const getLevelIcon = (level: string) => {
  switch (level) {
    case "error":
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    case "success":
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    default:
      return <Info className="h-4 w-4 text-blue-600" />;
  }
};

export default function LogsPage() {
  const t = useTranslations("logs");
  const tCommon = useTranslations("common");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");

  const columns = useMemo<ColumnDef<LogEntry>[]>(() => ([
    {
      accessorKey: "level",
      header: t("table.level"),
      cell: ({ row }) => {
        const level = row.getValue("level") as string;
        return (
          <div className="flex items-center gap-2">
            {getLevelIcon(level)}
            <Badge
              variant={
                level === "error"
                  ? "destructive"
                  : level === "warning"
                  ? "secondary"
                  : "default"
              }
            >
              {level}
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "message",
      header: t("table.message"),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.getValue("message")}</div>
          {row.original.user_id && (
            <div className="text-xs text-muted-foreground font-mono">
              {t("table.user")}: {row.original.user_id.slice(0, 12)}...
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "source",
      header: t("table.source"),
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {row.getValue("source")}
        </Badge>
      ),
    },
    {
      accessorKey: "timestamp",
      header: t("table.time"),
      cell: ({ row }) => {
        const timestamp = row.getValue("timestamp") as string;
        return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
      },
    },
  ]), [t]);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [logsResponse, statsResponse] = await Promise.all([
        logsApi.list({
          page: 1,
          page_size: 100,
          level: levelFilter || undefined,
          source: sourceFilter || undefined,
        }),
        logsApi.getStats(),
      ]);
      setLogs(logsResponse.logs);
      setStats(statsResponse);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      setError(err instanceof Error ? err.message : t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [levelFilter, sourceFilter, t]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleExport = async (format: "json" | "csv") => {
    try {
      const data = await logsApi.export(format);
      const blob = new Blob(
        [format === "json" ? JSON.stringify(data, null, 2) : (data as string)],
        { type: format === "json" ? "application/json" : "text/csv" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `logs.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">{error}</p>
        <button
          onClick={fetchLogs}
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
        <div className="flex gap-2">
          <button
            onClick={() => handleExport("json")}
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            <Download className="h-4 w-4 inline mr-1" />
            {tCommon("export")}
          </button>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 inline mr-1 ${loading ? "animate-spin" : ""}`} />
            {tCommon("refresh")}
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-muted-foreground">{t("stats.info")}</span>
            </div>
            <div className="text-2xl font-bold">{stats.info_count}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm text-muted-foreground">{t("stats.success")}</span>
            </div>
            <div className="text-2xl font-bold text-green-600">{stats.success_count}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <span className="text-sm text-muted-foreground">{t("stats.warning")}</span>
            </div>
            <div className="text-2xl font-bold text-yellow-600">{stats.warning_count}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-sm text-muted-foreground">{t("stats.error")}</span>
            </div>
            <div className="text-2xl font-bold text-red-600">{stats.error_count}</div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">{t("filters.allLevels")}</option>
          <option value="info">{t("filters.levels.info")}</option>
          <option value="warning">{t("filters.levels.warning")}</option>
          <option value="error">{t("filters.levels.error")}</option>
          <option value="success">{t("filters.levels.success")}</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">{t("filters.allSources")}</option>
          <option value="job">{t("filters.sources.job")}</option>
          <option value="document">{t("filters.sources.document")}</option>
          <option value="user">{t("filters.sources.user")}</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={logs}
        searchKey="message"
        searchPlaceholder={t("searchPlaceholder")}
      />
    </div>
  );
}
