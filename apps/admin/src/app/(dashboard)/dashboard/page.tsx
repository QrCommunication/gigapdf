"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { StatsCard } from "@/components/stats-card";
import { UsageChart } from "@/components/charts/usage-chart";
import { RevenueChart } from "@/components/charts/revenue-chart";
import {
  Users,
  FileText,
  HardDrive,
  Activity,
  TrendingUp,
  Briefcase,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { statsApi, type DashboardStats, type RecentActivity } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { fr, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dateLocale = locale === "fr" ? fr : enUS;

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const [statsData, activityData] = await Promise.all([
          statsApi.getOverview(),
          statsApi.getActivity(5),
        ]);

        setStats(statsData);
        setActivity(activityData);
      } catch (err) {
        console.error("Failed to fetch dashboard data:", err);
        setError(err instanceof Error ? err.message : tCommon("error"));
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [tCommon]);

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
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          {tCommon("retry")}
        </button>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "text-green-600";
      case "warning":
        return "text-yellow-600";
      case "error":
        return "text-red-600";
      default:
        return "text-muted-foreground";
    }
  };

  const getActivityIcon = (type: string) => {
    if (type.includes("document")) return "📄";
    if (type.includes("job")) return "⚙️";
    if (type.includes("user")) return "👤";
    return "📋";
  };

  const allHealthy = stats?.system_health.every((s) => s.status === "healthy");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title={t("stats.totalUsers")}
          value={stats?.total_users ?? 0}
          icon={Users}
        />
        <StatsCard
          title={t("stats.totalDocuments")}
          value={stats?.total_documents ?? 0}
          icon={FileText}
        />
        <StatsCard
          title={t("stats.storageUsed")}
          value={stats?.total_storage_formatted ?? "0 B"}
          icon={HardDrive}
          format="none"
        />
        <StatsCard
          title={t("stats.activeJobs")}
          value={stats?.active_jobs ?? 0}
          icon={Briefcase}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <UsageChart />
        <RevenueChart />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">{t("systemStatus.title")}</h3>
            <div className={`flex items-center gap-2 ${allHealthy ? "text-green-600" : "text-yellow-600"}`}>
              <Activity className="h-4 w-4" />
              <span className="text-sm font-medium">
                {allHealthy ? t("systemStatus.allOperational") : t("systemStatus.issuesDetected")}
              </span>
            </div>
          </div>
          <div className="space-y-3">
            {stats?.system_health.map((service) => (
              <div key={service.name} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{service.name}</span>
                <div className="flex items-center gap-2">
                  {service.latency && (
                    <span className="text-xs text-muted-foreground">{service.latency}</span>
                  )}
                  <span className={`text-sm font-medium capitalize ${getStatusColor(service.status)}`}>
                    {service.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">{t("recentActivity.title")}</h3>
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-3">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("recentActivity.noActivity")}</p>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="text-sm">
                  <p className="font-medium">
                    {getActivityIcon(item.type)} {item.description}
                  </p>
                  <p className="text-muted-foreground">
                    {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true, locale: dateLocale })}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
