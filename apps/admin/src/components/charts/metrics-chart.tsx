"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Loader2 } from "lucide-react";
import { infrastructureApi, type MetricPoint } from "@/lib/api";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { fr, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";

interface MetricsChartProps {
  timeRange?: "24h" | "7d" | "30d";
  onTimeRangeChange?: (range: "24h" | "7d" | "30d") => void;
}

export function MetricsChart({ timeRange = "24h", onTimeRangeChange }: MetricsChartProps) {
  const t = useTranslations("infrastructure.charts.metrics");
  const locale = useLocale();
  const dateLocale = locale === "fr" ? fr : enUS;
  const [data, setData] = useState<MetricPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await infrastructureApi.getMetricsHistory(timeRange);
        setData(response.points);
      } catch (error) {
        console.error("Failed to fetch metrics history:", error);
        setData([]);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [timeRange]);

  const formatTime = (time: string) => {
    const date = new Date(time);
    if (timeRange === "24h") {
      return format(date, "HH:mm", { locale: dateLocale });
    } else if (timeRange === "7d") {
      return format(date, "EEE HH:mm", { locale: dateLocale });
    }
    return format(date, "dd/MM", { locale: dateLocale });
  };

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{t("title")}</h3>
          <TimeRangeSelector
            value={timeRange}
            onChange={onTimeRangeChange}
            t={t}
          />
        </div>
        <div className="flex items-center justify-center h-[300px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t("title")}</h3>
        <TimeRangeSelector
          value={timeRange}
          onChange={onTimeRangeChange}
          t={t}
        />
      </div>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-[300px] text-muted-foreground">
          {t("noData")}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11 }}
              tickLine={false}
              tickFormatter={formatTime}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              labelFormatter={(label) => format(new Date(label), "PPpp", { locale: dateLocale })}
              formatter={(value, name) => {
                const v = value as number;
                if (name === "cpu") return [`${v.toFixed(1)}%`, t("cpu")];
                if (name === "memory") return [`${v.toFixed(1)}%`, t("memory")];
                if (name === "disk") return [`${v.toFixed(1)}%`, t("disk")];
                return [v, name];
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="cpu"
              name={t("cpu")}
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="memory"
              name={t("memory")}
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="disk"
              name={t("disk")}
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

interface TimeRangeSelectorProps {
  value: "24h" | "7d" | "30d";
  onChange?: (range: "24h" | "7d" | "30d") => void;
  t: (key: string) => string;
}

function TimeRangeSelector({ value, onChange, t }: TimeRangeSelectorProps) {
  const ranges: ("24h" | "7d" | "30d")[] = ["24h", "7d", "30d"];

  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {ranges.map((range) => (
        <button
          key={range}
          onClick={() => onChange?.(range)}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            value === range
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t(`range.${range}`)}
        </button>
      ))}
    </div>
  );
}
