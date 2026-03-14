"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@giga-pdf/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@giga-pdf/ui";
import { Badge } from "@giga-pdf/ui";
import { Switch } from "@giga-pdf/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@giga-pdf/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@giga-pdf/ui";
import { Globe, Loader2, MoreVertical, RefreshCw, Trash2, Zap } from "lucide-react";
import { KeyDisplay } from "./key-display";
import { RegenerateDialog } from "./regenerate-dialog";
import { api, ApiKeyResponse } from "@/lib/api";

interface ApiKeyCardProps {
  apiKey: ApiKeyResponse;
  onUpdated: () => void;
  onError: (message: string) => void;
}

export function ApiKeyCard({ apiKey, onUpdated, onError }: ApiKeyCardProps) {
  const t = useTranslations("developers.card");
  const tActions = useTranslations("developers.actions");
  const tDelete = useTranslations("developers.deleteDialog");
  const tErrors = useTranslations("developers.errors");
  const tCommon = useTranslations("common");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [regenerateType, setRegenerateType] = useState<"publishable" | "secret" | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const scopes = Array.isArray(apiKey.scopes)
    ? apiKey.scopes
    : typeof apiKey.scopes === "string"
      ? (apiKey.scopes as string).split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  const domains = Array.isArray(apiKey.allowed_domains)
    ? apiKey.allowed_domains
    : typeof apiKey.allowed_domains === "string"
      ? (apiKey.allowed_domains as string).split(",").map((d) => d.trim()).filter(Boolean)
      : [];

  const handleToggleStatus = async () => {
    try {
      setStatusLoading(true);
      await api.updateApiKey(apiKey.id, { is_active: !apiKey.is_active });
      onUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : tErrors("updateFailed"));
    } finally {
      setStatusLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      setDeleteLoading(true);
      await api.deleteApiKey(apiKey.id);
      setDeleteOpen(false);
      onUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : tErrors("deleteFailed"));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRegenerate = async (): Promise<string> => {
    try {
      if (regenerateType === "publishable") {
        const res = await api.regeneratePublishableKey(apiKey.id);
        onUpdated();
        return res.key;
      } else {
        const res = await api.regenerateSecretKey(apiKey.id);
        onUpdated();
        return res.key;
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : tErrors("regenerateFailed"));
      throw err;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return t("never");
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">{apiKey.name}</CardTitle>
            <Badge variant={apiKey.is_active ? "default" : "secondary"}>
              {apiKey.is_active ? t("active") : t("inactive")}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={apiKey.is_active}
              onCheckedChange={handleToggleStatus}
              disabled={statusLoading}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setRegenerateType("publishable")}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {tActions("regeneratePublishable")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRegenerateType("secret")}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {tActions("regenerateSecret")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {tActions("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Keys */}
          <div className="grid gap-3 sm:grid-cols-2">
            {apiKey.publishable_key_prefix && (
              <KeyDisplay
                label={t("publishableKey")}
                value={apiKey.publishable_key_prefix + "••••••••"}
                masked
              />
            )}
            <KeyDisplay
              label={t("secretKey")}
              value={apiKey.key_prefix + "••••••••"}
              masked
            />
          </div>

          {/* Metadata */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {scopes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{t("scopes")}:</span>
                <div className="flex gap-1">
                  {scopes.map((scope) => (
                    <Badge key={scope} variant="outline" className="text-xs">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              <span>
                {domains.length > 0 ? domains.join(", ") : t("noDomains")}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              <span>{t("rateLimitValue", { count: apiKey.rate_limit })}</span>
            </div>

            <div>
              <span className="font-medium">{t("lastUsed")}:</span>{" "}
              {formatDate(apiKey.last_used_at)}
            </div>

            <div>
              <span className="font-medium">{t("created")}:</span>{" "}
              {formatDate(apiKey.created_at)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tDelete("title")}</DialogTitle>
            <DialogDescription>
              {tDelete("description", { name: apiKey.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteLoading}
            >
              {deleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deleteLoading ? tDelete("deleting") : tDelete("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate dialog */}
      {regenerateType && (
        <RegenerateDialog
          open={!!regenerateType}
          onOpenChange={(open) => !open && setRegenerateType(null)}
          keyType={regenerateType}
          onConfirm={handleRegenerate}
        />
      )}
    </>
  );
}
