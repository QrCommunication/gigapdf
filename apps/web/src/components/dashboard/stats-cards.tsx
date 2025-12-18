"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@giga-pdf/ui";
import { FileText, FolderOpen, HardDrive } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface StatsCardsProps {
  totalDocuments: number;
  totalSize: number;
  recentDocuments: number;
}

export function StatsCards({
  totalDocuments,
  totalSize,
  recentDocuments,
}: StatsCardsProps) {
  const t = useTranslations("dashboard.stats");

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t("totalDocuments")}</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalDocuments}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t("storageUsed")}</CardTitle>
          <HardDrive className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatBytes(totalSize)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t("recentActivity")}</CardTitle>
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{recentDocuments}</div>
        </CardContent>
      </Card>
    </div>
  );
}
