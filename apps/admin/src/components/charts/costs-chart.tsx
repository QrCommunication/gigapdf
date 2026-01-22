"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Loader2 } from "lucide-react";
import { infrastructureApi, type MonthCost } from "@/lib/api";
import { useTranslations } from "next-intl";

interface CostsChartProps {
  months?: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  Compute: "#3b82f6",
  "Managed Databases": "#8b5cf6",
  Storage: "#22c55e",
  Network: "#f59e0b",
  Other: "#6b7280",
};

export function CostsChart({ months = 12 }: CostsChartProps) {
  const t = useTranslations("infrastructure.charts.costs");
  const [data, setData] = useState<MonthCost[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await infrastructureApi.getCostHistory(months);
        setData(response.history);

        // Extract unique categories
        const allCategories = new Set<string>();
        response.history.forEach((month) => {
          Object.keys(month.by_category).forEach((cat) => allCategories.add(cat));
        });
        setCategories(Array.from(allCategories));
      } catch (error) {
        console.error("Failed to fetch cost history:", error);
        setData([]);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [months]);

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold">{t("title")}</h3>
        <div className="flex items-center justify-center h-[300px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Transform data for stacked area chart
  const chartData = data.map((month) => ({
    period: month.period,
    total: month.total,
    ...month.by_category,
  }));

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold">{t("title")}</h3>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-[300px] text-muted-foreground">
          {t("noData")}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}€`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              formatter={(value: number) => [`${value.toFixed(2)}€`, ""]}
              labelFormatter={(label) => `${t("period")}: ${label}`}
            />
            <Legend />
            {categories.map((category) => (
              <Area
                key={category}
                type="monotone"
                dataKey={category}
                name={category}
                stackId="1"
                stroke={CATEGORY_COLORS[category] || "#6b7280"}
                fill={CATEGORY_COLORS[category] || "#6b7280"}
                fillOpacity={0.6}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
