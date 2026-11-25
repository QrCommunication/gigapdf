"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, DatabaseBackup, Loader2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { backupApi, type BackupRun } from "@/lib/api";
import { formatDate } from "@/lib/utils";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} Go`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} Mo`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)} ko`;
  return `${bytes} o`;
}

export default function BackupsPage() {
  const t = useTranslations("backups");
  const tCommon = useTranslations("common");
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      setError(null);
      setRuns(await backupApi.listRuns());
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tCommon]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const runOperation = async (operation: "backup" | "test") => {
    setRefreshing(true);
    setMessage(null);
    try {
      const response = operation === "backup"
        ? await backupApi.runBackup()
        : await backupApi.runRestoreTest();
      setMessage(response.message);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("error"));
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={fetchRuns}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
            {tCommon("refresh")}
          </button>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => runOperation("test")}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            {t("runTest")}
          </button>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => runOperation("backup")}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {t("runNow")}
          </button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {t("schedule")}
      </div>
      {message && <p role="status" className="text-sm text-green-600">{message}</p>}
      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </p>
      )}

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5" />
          <h2 className="text-xl font-semibold">{t("history")}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-4 py-3 text-left font-medium">{t("type")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("status")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("started")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("file")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("size")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("details")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b last:border-0">
                  <td className="px-4 py-3">{t(`types.${run.run_type}`)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${
                      run.status === "success"
                        ? "bg-green-100 text-green-800"
                        : run.status === "failed"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted"
                    }`}>
                      {t(`statuses.${run.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{formatDate(run.started_at)}</td>
                  <td className="max-w-md px-4 py-3">
                    <div className="truncate" title={run.destination || undefined}>
                      {run.filename || "—"}
                    </div>
                    {run.destination && (
                      <div className="truncate text-xs text-muted-foreground" title={run.destination}>
                        {run.destination}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{formatBytes(run.size_bytes)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{run.details || "—"}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    {t("empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
