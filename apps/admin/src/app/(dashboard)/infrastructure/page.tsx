"use client";

import { useCallback, useEffect, useState } from "react";
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
  Download,
  Network,
} from "lucide-react";
import {
  infrastructureApi,
  type CurrentCosts,
  type CurrentMetrics,
  type MonthCost,
  type UserBandwidth,
  usersApi,
  type User,
} from "@/lib/api";

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000_000) return `${(bytes / 1_000_000_000_000).toFixed(2)} To`;
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} Go`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} Mo`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)} ko`;
  return `${bytes} o`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function aggregateYear(history: MonthCost[]): CurrentCosts {
  const categories = new Map<string, { cost: number; product_count: number }>();
  history.forEach((month) => {
    Object.entries(month.by_category).forEach(([name, cost]) => {
      const current = categories.get(name) || { cost: 0, product_count: 0 };
      current.cost += cost;
      current.product_count += 1;
      categories.set(name, current);
    });
  });

  return {
    total_eur: sum(history.map((month) => month.total)),
    billing_period: `${new Date().getFullYear()} — 12 mois glissants`,
    by_category: Array.from(categories, ([name, value]) => ({ name, ...value })),
    resources: [],
    downloaded_bytes: sum(history.map((month) => month.downloaded_bytes)),
    free_bandwidth_bytes: sum(history.map((month) => month.free_bandwidth_bytes)),
    bandwidth_overage_bytes: 0,
    bandwidth_overage_usd: sum(history.map((month) => month.bandwidth_overage_usd)),
    storage_tb_started: sum(history.map((month) => month.storage_tb_started)),
    storage_cost_eur: sum(history.map((month) => month.storage_cost_eur)),
    hosting_cost_eur: sum(history.map((month) => month.hosting_cost_eur)),
  };
}

export default function InfrastructurePage() {
  const t = useTranslations("infrastructure");
  const tCommon = useTranslations("common");
  const [costs, setCosts] = useState<CurrentCosts | null>(null);
  const [metrics, setMetrics] = useState<CurrentMetrics | null>(null);
  const [viewMode, setViewMode] = useState<"month" | "year">("month");
  const [metricsTimeRange, setMetricsTimeRange] = useState<"24h" | "7d" | "30d">("24h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bandwidthUsers, setBandwidthUsers] = useState<UserBandwidth[]>([]);
  const [userOptions, setUserOptions] = useState<User[]>([]);
  const [selectedBandwidthUser, setSelectedBandwidthUser] = useState("");

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [metricsData, historyData, monthCosts, bandwidthUsersData] = await Promise.all([
        infrastructureApi.getCurrentMetrics(),
        infrastructureApi.getCostHistory(viewMode === "year" ? 12 : 1),
        viewMode === "month" ? infrastructureApi.getCurrentCosts() : Promise.resolve(null),
        infrastructureApi.getBandwidthUsers(undefined, selectedBandwidthUser || undefined),
      ]);
      setMetrics(metricsData);
      setCosts(monthCosts || aggregateYear(historyData.history));
      setBandwidthUsers(bandwidthUsersData);
    } catch (err) {
      console.error("Failed to fetch infrastructure data:", err);
      setError(err instanceof Error ? err.message : tCommon("error"));
    }
  }, [selectedBandwidthUser, tCommon, viewMode]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      await fetchData();
      setLoading(false);
    }
    load();
  }, [fetchData]);

  useEffect(() => {
    async function loadUsers() {
      try {
        const response = await usersApi.list({ page: 1, page_size: 100 });
        setUserOptions(response.users);
      } catch (err) {
        console.error("Failed to fetch users for bandwidth filter:", err);
      }
    }
    loadUsers();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await infrastructureApi.triggerMetricsCollection();
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

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{t("costs.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("costs.period")}: {costs?.billing_period} · {t("costs.ht")}
            </p>
          </div>
          <div className="inline-flex rounded-md border p-1" aria-label={t("costs.interval")}>
            {(["month", "year"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {t(`costs.${mode}`)}
              </button>
            ))}
          </div>
        </div>
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

      <div>
        <h2 className="mb-1 text-xl font-semibold">{t("bandwidth.title")}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t("bandwidth.subtitle")}</p>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title={t("bandwidth.downloaded")}
            value={formatBytes(costs?.downloaded_bytes ?? 0)}
            icon={Download}
            format="none"
          />
          <StatsCard
            title={t("bandwidth.included")}
            value={formatBytes(costs?.free_bandwidth_bytes ?? 0)}
            icon={Network}
            format="none"
          />
          <StatsCard
            title={t("bandwidth.overage")}
            value={`$${(costs?.bandwidth_overage_usd ?? 0).toFixed(4)}`}
            icon={DollarSign}
            format="none"
          />
          <StatsCard
            title={t("bandwidth.storageTier")}
            value={`${costs?.storage_tb_started ?? 0} To`}
            description={`${(costs?.storage_cost_eur ?? 0).toFixed(2)}€ HT`}
            icon={Database}
            format="none"
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{t("bandwidth.byUser")}</h2>
            <p className="text-sm text-muted-foreground">{t("bandwidth.byUserSubtitle")}</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span>{t("bandwidth.userFilter")}</span>
            <select
              value={selectedBandwidthUser}
              onChange={(event) => setSelectedBandwidthUser(event.target.value)}
              className="max-w-xs rounded-md border bg-background px-3 py-2"
            >
              <option value="">{t("bandwidth.topTen")}</option>
              {userOptions.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.email || user.id}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-4 py-3 text-left font-medium">{t("bandwidth.user")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("bandwidth.downloaded")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("bandwidth.included")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("bandwidth.overage")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("bandwidth.storageTier")}</th>
              </tr>
            </thead>
            <tbody>
              {bandwidthUsers.map((user) => (
                <tr key={user.user_id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{user.name || user.user_id}</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{formatBytes(user.downloaded_bytes)}</td>
                  <td className="px-4 py-3 text-right">{formatBytes(user.free_bandwidth_bytes)}</td>
                  <td className="px-4 py-3 text-right">${user.bandwidth_overage_usd.toFixed(4)}</td>
                  <td className="px-4 py-3 text-right">{formatBytes(user.storage_bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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

      <div className="grid gap-6 lg:grid-cols-2">
        <CostsChart months={viewMode === "year" ? 12 : 1} />
        <MetricsChart
          timeRange={metricsTimeRange}
          onTimeRangeChange={setMetricsTimeRange}
        />
      </div>

      {viewMode === "month" && costs && costs.resources.length > 0 && (
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
