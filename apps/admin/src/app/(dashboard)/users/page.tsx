"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { DataTable, type DataTableColumnDef } from "@/components/data-table";
import { formatDate } from "@/lib/utils";
import { Badge } from "@giga-pdf/ui";
import { Eye, Edit, Trash2, Loader2, AlertCircle, RefreshCw, KeyRound, MailCheck } from "lucide-react";
import { usersApi, type User } from "@/lib/api";

export default function UsersPage() {
  const t = useTranslations("users");
  const tCommon = useTranslations("common");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const handleVerifyEmail = useCallback(async (user: User) => {
    setActionLoading(user.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await usersApi.verifyEmail(user.id);
      setUsers((current) =>
        current.map((item) => (item.id === user.id ? { ...item, email_verified: true } : item))
      );
      setActionMessage(t("actions.emailVerified"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tCommon("error"));
    } finally {
      setActionLoading(null);
    }
  }, [t, tCommon]);

  const columns: DataTableColumnDef<User>[] = useMemo(() => [
    {
      accessorKey: "id",
      header: t("table.name"),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">
            {row.original.name || `${row.original.id.slice(0, 8)}...`}
          </div>
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
      accessorKey: "storage_used_bytes",
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
      header: t("table.documents"),
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
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <button className="rounded-md p-2 hover:bg-accent" title={tCommon("view")}>
            <Eye className="h-4 w-4" />
          </button>
          <button className="rounded-md p-2 hover:bg-accent" title={tCommon("edit")}>
            <Edit className="h-4 w-4" />
          </button>
          <button
            className="rounded-md p-2 hover:bg-accent"
            title={t("actions.resetPassword")}
            onClick={() => {
              setPasswordUser(row.original);
              setNewPassword("");
              setActionError(null);
            }}
          >
            <KeyRound className="h-4 w-4" />
          </button>
          <button
            className="rounded-md p-2 hover:bg-accent disabled:opacity-40"
            title={t("actions.verifyEmail")}
            disabled={row.original.email_verified || actionLoading === row.original.id}
            onClick={() => handleVerifyEmail(row.original)}
          >
            <MailCheck className="h-4 w-4" />
          </button>
          <button className="rounded-md p-2 hover:bg-accent" title={tCommon("delete")}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </button>
        </div>
      ),
    },
  ], [t, tCommon, actionLoading, handleVerifyEmail]);

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

  const handleResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordUser) return;
    setActionLoading(passwordUser.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await usersApi.resetPassword(passwordUser.id, newPassword);
      setPasswordUser(null);
      setNewPassword("");
      setActionMessage(t("actions.passwordReset"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tCommon("error"));
    } finally {
      setActionLoading(null);
    }
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

      {actionMessage && <p role="status" className="text-sm text-green-600">{actionMessage}</p>}
      {actionError && !passwordUser && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      <DataTable
        columns={columns}
        data={users}
        searchKey="id"
        searchPlaceholder={t("search")}
      />

      {passwordUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
            className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
          >
            <h2 id="reset-password-title" className="text-xl font-semibold">
              {t("actions.resetPassword")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{passwordUser.email}</p>
            <form className="mt-6 space-y-4" onSubmit={handleResetPassword}>
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium">
                  {t("form.newPassword")}
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  aria-describedby="new-password-hint"
                />
                <p id="new-password-hint" className="mt-1 text-xs text-muted-foreground">
                  {t("form.passwordHint")}
                </p>
              </div>
              {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPasswordUser(null)}
                  className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                >
                  {tCommon("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === passwordUser.id}
                  className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {actionLoading === passwordUser.id ? tCommon("loading") : t("actions.confirmReset")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
