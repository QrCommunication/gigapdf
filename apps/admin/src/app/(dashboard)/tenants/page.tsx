"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { formatDate } from "@/lib/utils";
import { Badge } from "@giga-pdf/ui";
import {
  Eye,
  Edit,
  Trash2,
  Plus,
  Loader2,
  AlertCircle,
  RefreshCw,
  Users,
  FileText,
  HardDrive,
  Building2,
} from "lucide-react";
import Link from "next/link";
import { tenantsApi, type Tenant, type TenantStats } from "@/lib/api";

const getStatusVariant = (status: string) => {
  switch (status) {
    case "active":
      return "default";
    case "trial":
      return "secondary";
    case "suspended":
      return "destructive";
    case "cancelled":
      return "outline";
    default:
      return "outline";
  }
};

export default function TenantsPage() {
  const t = useTranslations("tenants");
  const tCommon = useTranslations("common");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const columns: ColumnDef<Tenant>[] = [
    {
      accessorKey: "name",
      header: t("table.name"),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.getValue("name")}</div>
          <div className="text-xs text-muted-foreground">{row.original.email}</div>
        </div>
      ),
    },
    {
      accessorKey: "slug",
      header: t("table.slug"),
      cell: ({ row }) => (
        <code className="text-xs bg-muted px-1 py-0.5 rounded">
          {row.getValue("slug")}
        </code>
      ),
    },
    {
      accessorKey: "status",
      header: t("table.status"),
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        return (
          <Badge variant={getStatusVariant(status) as "default" | "secondary" | "destructive" | "outline"}>
            {status}
          </Badge>
        );
      },
    },
    {
      accessorKey: "member_count",
      header: t("table.users"),
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span>{row.original.member_count}</span>
          <span className="text-muted-foreground">/ {row.original.max_members}</span>
        </div>
      ),
    },
    {
      accessorKey: "document_count",
      header: t("table.documents"),
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <FileText className="h-3 w-3 text-muted-foreground" />
          <span>{row.original.document_count}</span>
        </div>
      ),
    },
    {
      accessorKey: "storage_used_formatted",
      header: t("table.storage"),
      cell: ({ row }) => (
        <div>
          <div className="text-sm">{row.original.storage_used_formatted}</div>
          <div className="w-20 h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(row.original.storage_percentage, 100)}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      accessorKey: "created_at",
      header: t("table.createdAt"),
      cell: ({ row }) => formatDate(row.getValue("created_at")),
    },
    {
      id: "actions",
      header: t("table.actions"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Link
            href={`/tenants/${row.original.id}`}
            className="rounded-md p-2 hover:bg-accent"
            title={tCommon("view")}
          >
            <Eye className="h-4 w-4" />
          </Link>
          <button className="rounded-md p-2 hover:bg-accent" title={tCommon("edit")}>
            <Edit className="h-4 w-4" />
          </button>
          <button
            className="rounded-md p-2 hover:bg-accent"
            title={tCommon("delete")}
            onClick={() => handleDelete(row.original.id)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </button>
        </div>
      ),
    },
  ];

  const fetchTenants = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [tenantsResponse, statsResponse] = await Promise.all([
        tenantsApi.list({
          page: 1,
          page_size: 50,
          status: statusFilter as "active" | "suspended" | "trial" | "cancelled" | undefined || undefined,
        }),
        tenantsApi.getStats(),
      ]);
      setTenants(tenantsResponse.tenants);
      setStats(statsResponse);
    } catch (err) {
      console.error("Failed to fetch tenants:", err);
      setError(err instanceof Error ? err.message : tCommon("error"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const handleDelete = async (tenantId: string) => {
    if (!confirm(t("modal.deleteConfirm"))) {
      return;
    }
    try {
      await tenantsApi.delete(tenantId);
      fetchTenants();
    } catch (err) {
      console.error("Failed to delete tenant:", err);
      alert(tCommon("error"));
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    try {
      await tenantsApi.create({
        name: formData.get("name") as string,
        slug: formData.get("slug") as string,
        email: formData.get("email") as string,
        description: formData.get("description") as string || undefined,
        max_members: parseInt(formData.get("max_members") as string) || 5,
      });
      setShowCreateModal(false);
      fetchTenants();
    } catch (err) {
      console.error("Failed to create tenant:", err);
      alert(err instanceof Error ? err.message : tCommon("error"));
    }
  };

  if (loading && tenants.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && tenants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">{error}</p>
        <button
          onClick={fetchTenants}
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
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {t("create")}
          </button>
          <button
            onClick={fetchTenants}
            disabled={loading}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 inline mr-2 ${loading ? "animate-spin" : ""}`} />
            {tCommon("refresh")}
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{tCommon("total")}</span>
            </div>
            <div className="text-2xl font-bold">{stats.total_tenants}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm text-muted-foreground">{t("status.active")}</span>
            </div>
            <div className="text-2xl font-bold text-green-600">{stats.active_tenants}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-yellow-500" />
              <span className="text-sm text-muted-foreground">{t("status.trial")}</span>
            </div>
            <div className="text-2xl font-bold text-yellow-600">{stats.trial_tenants}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("table.storage")}</span>
            </div>
            <div className="text-2xl font-bold">{stats.total_storage_formatted}</div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">{t("filters.allStatuses")}</option>
          <option value="active">{t("status.active")}</option>
          <option value="trial">{t("status.trial")}</option>
          <option value="suspended">{t("status.suspended")}</option>
          <option value="cancelled">{t("status.cancelled")}</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={tenants}
        searchKey="name"
        searchPlaceholder={t("search")}
      />

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">{t("modal.createTitle")}</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-sm font-medium">{t("form.name")}</label>
                <input
                  type="text"
                  name="name"
                  required
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder={t("form.namePlaceholder")}
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("form.slug")}</label>
                <input
                  type="text"
                  name="slug"
                  required
                  pattern="^[a-z0-9-]+$"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder={t("form.slugPlaceholder")}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  name="email"
                  required
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="admin@acme.com"
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("form.maxUsers")}</label>
                <input
                  type="number"
                  name="max_members"
                  defaultValue={5}
                  min={1}
                  max={1000}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  {tCommon("cancel")}
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {tCommon("create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
