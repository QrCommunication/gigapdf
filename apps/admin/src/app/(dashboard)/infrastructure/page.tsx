"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { StatsCard } from "@/components/stats-card";
import { CostsChart } from "@/components/charts/costs-chart";
import { MetricsChart } from "@/components/charts/metrics-chart";
import {
  DollarSign,
  Cpu,
  MemoryStick,
  HardDrive,
  Database,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  infrastructureApi,
  type CurrentCosts,
  type CurrentMetrics,
  type CategoryCost,
} from "@/lib/api";

export default function InfrastructurePage() {
  const t = useTranslations("infrastructure");
  const tCommon = useTranslations("common");
  const [costs, setCosts] = useState<CurrentCosts | null>(null);
  const [metrics, setMetrics] = useState<CurrentMetrics | null>(null);
  const [metricsTimeRange, setMetricsTimeRange] = useState<"24h" | "7d" | "30d">("24h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      setError(null);

      const [costsData, metricsData] = await Promise.all([
        infrastructureApi.getCurrentCosts(),
        infrastructureApi.getCurrentMetrics(),
      ]);

      setCosts(costsData);
      setMetrics(metricsData);
    } catch (err) {
      console.error("Failed to fetch infrastructure data:", err);
      setError(err instanceof Error ? err.message : tCommon("error"));
    }
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      await fetchData();
      setLoading(false);
    }
    load();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Trigger metrics collection
      await infrastructureApi.triggerMetricsCollection();
      // Refresh data
      await fetchData();
    } catch (err) {
      console.error("Failed to refresh metrics:", err);
    }
    setRefreshing(false);
  };

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

  // Find main cost categories
  const computeCost = costs?.by_category.find((c) => c.name === "Compute")?.cost ?? 0;
  const dbCost = costs?.by_category.find((c) => c.name === "Managed Databases")?.cost ?? 0;
  const storageCost = costs?.by_category.find((c) => c.name === "Storage")?.cost ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {t("refresh")}
        </button>
      </div>

      {/* Cost Stats */}
      <div>
        <h2 className="text-xl font-semibold mb-4">{t("costs.title")}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t("costs.period")}: {costs?.billing_period}
        </p>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title={t("costs.total")}
            value={`${costs?.total_eur.toFixed(2) ?? "0.00"}€`}
            icon={DollarSign}
            format="none"
          />
          <StatsCard
            title={t("costs.compute")}
            value={`${computeCost.toFixed(2)}€`}
            icon={Cpu}
            format="none"
          />
          <StatsCard
            title={t("costs.database")}
            value={`${dbCost.toFixed(2)}€`}
            icon={Database}
            format="none"
          />
          <StatsCard
            title={t("costs.storage")}
            value={`${storageCost.toFixed(2)}€`}
            icon={HardDrive}
            format="none"
          />
        </div>
      </div>

      {/* Performance Stats */}
      <div>
        <h2 className="text-xl font-semibold mb-4">{t("performance.title")}</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title={t("performance.cpu")}
            value={`${metrics?.cpu_percent.toFixed(1) ?? 0}%`}
            icon={Cpu}
            format="none"
          />
          <StatsCard
            title={t("performance.memory")}
            value={`${metrics?.memory.used_gb.toFixed(1) ?? 0}/${metrics?.memory.total_gb.toFixed(1) ?? 0} GB`}
            description={`${metrics?.memory.percent.toFixed(1) ?? 0}%`}
            icon={MemoryStick}
            format="none"
          />
          <StatsCard
            title={t("performance.disk")}
            value={`${metrics?.disk.used_gb.toFixed(1) ?? 0}/${metrics?.disk.total_gb.toFixed(1) ?? 0} GB`}
            description={`${metrics?.disk.percent.toFixed(1) ?? 0}%`}
            icon={HardDrive}
            format="none"
          />
          <StatsCard
            title={t("performance.s3")}
            value={`${metrics?.s3.total_mb.toFixed(2) ?? 0} MB`}
            description={`${metrics?.s3.objects_count ?? 0} ${t("performance.objects")}`}
            icon={Database}
            format="none"
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <CostsChart months={12} />
        <MetricsChart
          timeRange={metricsTimeRange}
          onTimeRangeChange={setMetricsTimeRange}
        />
      </div>

      {/* Resources Table */}
      {costs && costs.resources.length > 0 && (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4">{t("resources.title")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">{t("resources.product")}</th>
                  <th className="text-left py-3 px-4 font-medium">{t("resources.resource")}</th>
                  <th className="text-left py-3 px-4 font-medium">{t("resources.category")}</th>
                  <th className="text-right py-3 px-4 font-medium">{t("resources.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {costs.resources.map((resource, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="py-3 px-4">{resource.product_name}</td>
                    <td className="py-3 px-4 text-muted-foreground">{resource.resource_name}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 text-xs rounded-full bg-muted">
                        {resource.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-medium">{resource.cost.toFixed(2)}€</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
