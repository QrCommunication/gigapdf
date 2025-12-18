"use client";

import { useEffect, useState, useCallback } from "react";
import { DataTable } from "@/components/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@giga-pdf/ui";
import { AlertCircle, Info, AlertTriangle, CheckCircle, Loader2, RefreshCw, Download } from "lucide-react";
import { logsApi, type LogEntry, type LogStats } from "@/lib/api";

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

const columns: ColumnDef<LogEntry>[] = [
  {
    accessorKey: "level",
    header: "Level",
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
    header: "Message",
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.getValue("message")}</div>
        {row.original.user_id && (
          <div className="text-xs text-muted-foreground font-mono">
            User: {row.original.user_id.slice(0, 12)}...
          </div>
        )}
      </div>
    ),
  },
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) => (
      <Badge variant="outline" className="capitalize">
        {row.getValue("source")}
      </Badge>
    ),
  },
  {
    accessorKey: "timestamp",
    header: "Time",
    cell: ({ row }) => {
      const timestamp = row.getValue("timestamp") as string;
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    },
  },
];

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");

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
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [levelFilter, sourceFilter]);

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
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">System Logs</h1>
          <p className="text-muted-foreground">View system activity and errors</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport("json")}
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            <Download className="h-4 w-4 inline mr-1" />
            Export
          </button>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 inline mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-muted-foreground">Info</span>
            </div>
            <div className="text-2xl font-bold">{stats.info_count}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm text-muted-foreground">Success</span>
            </div>
            <div className="text-2xl font-bold text-green-600">{stats.success_count}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <span className="text-sm text-muted-foreground">Warning</span>
            </div>
            <div className="text-2xl font-bold text-yellow-600">{stats.warning_count}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-sm text-muted-foreground">Error</span>
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
          <option value="">All Levels</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
          <option value="success">Success</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">All Sources</option>
          <option value="job">Jobs</option>
          <option value="document">Documents</option>
          <option value="user">Users</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={logs}
        searchKey="message"
        searchPlaceholder="Search logs..."
      />
    </div>
  );
}
