"use client";

import { notFound } from "next/navigation";
import { Button } from "@giga-pdf/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@giga-pdf/ui";
import { Download, Edit, Trash2 } from "lucide-react";
import { formatDate, formatBytes } from "@/lib/utils";
import Link from "next/link";
import { use } from "react";
import { useTranslations } from "next-intl";

// Mock data - replace with actual data fetching
const mockDocument = {
  id: "1",
  name: "Annual Report 2024.pdf",
  size: 2048000,
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-20"),
  description: "Annual financial report for fiscal year 2024",
};

interface DocumentPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function DocumentPage({ params }: DocumentPageProps) {
  const { id } = use(params);
  const t = useTranslations("documents.detail");
  // In a real app, fetch the document based on params.id
  if (id !== mockDocument.id) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{mockDocument.name}</h1>
          <p className="text-muted-foreground">
            {t("lastModified", { date: formatDate(mockDocument.updatedAt) })}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/editor/${id}`}>
            <Button className="gap-2">
              <Edit className="h-4 w-4" />
              {t("actions.edit")}
            </Button>
          </Link>
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            {t("actions.download")}
          </Button>
          <Button variant="outline" className="gap-2">
            <Trash2 className="h-4 w-4" />
            {t("actions.delete")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("info.title")}</CardTitle>
            <CardDescription>{t("info.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium">{t("info.fileName")}</p>
              <p className="text-sm text-muted-foreground">{mockDocument.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium">{t("info.fileSize")}</p>
              <p className="text-sm text-muted-foreground">
                {formatBytes(mockDocument.size)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium">{t("info.created")}</p>
              <p className="text-sm text-muted-foreground">
                {formatDate(mockDocument.createdAt)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium">{t("info.lastModified")}</p>
              <p className="text-sm text-muted-foreground">
                {formatDate(mockDocument.updatedAt)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("description.title")}</CardTitle>
            <CardDescription>{t("description.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {mockDocument.description}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
