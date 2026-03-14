"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@giga-pdf/ui";
import { Input } from "@giga-pdf/ui";
import { Label } from "@giga-pdf/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@giga-pdf/ui";
import { AlertTriangle, Loader2 } from "lucide-react";
import { KeyDisplay } from "./key-display";
import { api, CreateApiKeyResponse } from "@/lib/api";

interface CreateKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateKeyDialog({ open, onOpenChange, onCreated }: CreateKeyDialogProps) {
  const t = useTranslations("developers.createDialog");
  const tSuccess = useTranslations("developers.createSuccess");
  const tErrors = useTranslations("developers.errors");
  const tCommon = useTranslations("common");

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("read,write");
  const [domains, setDomains] = useState("");
  const [rateLimit, setRateLimit] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateApiKeyResponse | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;

    try {
      setLoading(true);
      setError(null);
      const response = await api.createApiKey({
        name: name.trim(),
        scopes: scopes || undefined,
        allowed_domains: domains || undefined,
        rate_limit: rateLimit,
      });
      setResult(response);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : tErrors("createFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = (value: boolean) => {
    if (!value) {
      setName("");
      setScopes("read,write");
      setDomains("");
      setRateLimit(60);
      setError(null);
      setResult(null);
    }
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>{tSuccess("title")}</DialogTitle>
              <DialogDescription>{tSuccess("description")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <KeyDisplay
                label={tSuccess("publishableKey")}
                value={result.publishable_key}
              />
              <KeyDisplay
                label={tSuccess("secretKey")}
                value={result.key}
              />
              <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
                <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  {tSuccess("warning")}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={() => handleClose(false)}>
                {tSuccess("done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="key-name">{t("name")}</Label>
                <Input
                  id="key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="key-scopes">{t("scopes")}</Label>
                <Input
                  id="key-scopes"
                  value={scopes}
                  onChange={(e) => setScopes(e.target.value)}
                  placeholder={t("scopesPlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="key-domains">{t("domains")}</Label>
                <Input
                  id="key-domains"
                  value={domains}
                  onChange={(e) => setDomains(e.target.value)}
                  placeholder={t("domainsPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">{t("domainsHelp")}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="key-rate-limit">{t("rateLimit")}</Label>
                <Input
                  id="key-rate-limit"
                  type="number"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(Number(e.target.value))}
                  min={1}
                  max={10000}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={handleCreate} disabled={loading || !name.trim()}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? t("creating") : t("create")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
