"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { formatDate } from "@/lib/utils";
import { Badge } from "@giga-pdf/ui";
import { Eye, Edit, Trash2, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { usersApi, type User } from "@/lib/api";

export default function UsersPage() {
  const t = useTranslations("users");
  const tCommon = useTranslations("common");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const columns: ColumnDef<User>[] = useMemo(() => [
    {
      accessorKey: "id",
      header: t("table.name"),
      cell: ({ row }) => (
        <div>
          <div className="font-medium font-mono text-xs">{row.original.id.slice(0, 8)}...</div>
          <div className="text-xs text-muted-foreground">
            {row.original.email || tCommon("noData")}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "plan_type",
      header: t("table.role"),
      cell: ({ row }) => {
        const plan = row.getValue("plan_type") as string;
        const variant = plan === "enterprise" ? "default" : plan === "pro" ? "secondary" : "outline";
        return <Badge variant={variant as "default" | "secondary" | "outline"}>{plan}</Badge>;
      },
    },
    {
      accessorKey: "storage_used_formatted",
      header: t("table.tenant"),
      cell: ({ row }) => (
        <div className="text-sm">
          <span>{row.original.storage_used_formatted}</span>
          <span className="text-muted-foreground"> / {row.original.storage_limit_formatted}</span>
        </div>
      ),
    },
    {
      accessorKey: "document_count",
      header: t("table.status"),
    },
    {
      accessorKey: "api_calls_used",
      header: "API",
      cell: ({ row }) => (
        <div className="text-sm">
          <span>{row.original.api_calls_used}</span>
          <span className="text-muted-foreground"> / {row.original.api_calls_limit}</span>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: t("table.status"),
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        const variant =
          status === "active"
            ? "default"
            : status === "expired"
            ? "destructive"
            : "secondary";
        return <Badge variant={variant as "default" | "destructive" | "secondary"}>{status}</Badge>;
      },
    },
    {
      accessorKey: "updated_at",
      header: t("table.lastLogin"),
      cell: ({ row }) => formatDate(row.getValue("updated_at")),
    },
    {
      id: "actions",
      header: t("table.actions"),
      cell: () => (
        <div className="flex items-center gap-2">
          <button className="rounded-md p-2 hover:bg-accent" title={tCommon("view")}>
            <Eye className="h-4 w-4" />
          </button>
          <button className="rounded-md p-2 hover:bg-accent" title={tCommon("edit")}>
            <Edit className="h-4 w-4" />
          </button>
          <button className="rounded-md p-2 hover:bg-accent" title={tCommon("delete")}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </button>
        </div>
      ),
    },
  ], [t, tCommon]);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await usersApi.list({ page: 1, page_size: 50 });
      setUsers(response.users);
    } catch (err) {
      console.error("Failed to fetch users:", err);
      setError(err instanceof Error ? err.message : tCommon("error"));
    } finally {
      setLoading(false);
    }
  }, [tCommon]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

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
          onClick={fetchUsers}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          {tCommon("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <button
          onClick={fetchUsers}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <RefreshCw className="mr-2 h-4 w-4 inline" />
          {tCommon("refresh")}
        </button>
      </div>

      <DataTable
        columns={columns}
        data={users}
        searchKey="id"
        searchPlaceholder={t("search")}
      />
    </div>
  );
}
