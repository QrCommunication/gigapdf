"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@giga-pdf/ui";
import { Key, Loader2, Plus } from "lucide-react";
import { api, ApiKeyResponse } from "@/lib/api";
import { ApiKeyCard } from "@/components/developers/api-key-card";
import { CreateKeyDialog } from "@/components/developers/create-key-dialog";

export default function DevelopersPage() {
  const t = useTranslations("developers");

  const [keys, setKeys] = useState<ApiKeyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      setError(null);
      const data = await api.listApiKeys();
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t("createKey")}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && keys.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16">
          <Key className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">{t("noKeys.title")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("noKeys.description")}
          </p>
          <Button className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t("createKey")}
          </Button>
        </div>
      )}

      {/* Key list */}
      {!loading && keys.length > 0 && (
        <div className="space-y-4">
          {keys.map((key) => (
            <ApiKeyCard
              key={key.id}
              apiKey={key}
              onUpdated={loadKeys}
              onError={setError}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={loadKeys}
      />
    </div>
  );
}
