"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Loader2 } from "lucide-react";
import { statsApi, type RevenueDataPoint } from "@/lib/api";
import { useTranslations } from "next-intl";

export function RevenueChart() {
  const t = useTranslations("dashboard.charts.revenue");
  const [data, setData] = useState<RevenueDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const revenueData = await statsApi.getRevenue(6);
        setData(revenueData);
      } catch (error) {
        console.error("Failed to fetch revenue data:", error);
        setData([]);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

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

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold">{t("title")}</h3>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-[300px] text-muted-foreground">
          {t("noData")}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `€${value}`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              formatter={(value: number, name: string) => {
                if (name === "revenue") return [`€${value.toFixed(2)}`, t("revenue")];
                return [value, t("subscriptions")];
              }}
            />
            <Legend />
            <Bar
              yAxisId="left"
              dataKey="revenue"
              name={t("revenue")}
              fill="hsl(var(--primary))"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              yAxisId="right"
              dataKey="subscribers"
              name={t("subscriptions")}
              fill="hsl(217, 91%, 60%)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
