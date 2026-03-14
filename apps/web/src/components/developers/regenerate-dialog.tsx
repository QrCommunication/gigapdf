"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@giga-pdf/ui";
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

interface RegenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyType: "publishable" | "secret";
  onConfirm: () => Promise<string>;
}

export function RegenerateDialog({
  open,
  onOpenChange,
  keyType,
  onConfirm,
}: RegenerateDialogProps) {
  const t = useTranslations("developers.regenerateDialog");
  const tCommon = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const handleConfirm = async () => {
    try {
      setLoading(true);
      const key = await onConfirm();
      setNewKey(key);
    } catch {
      // Error handled by parent
    } finally {
      setLoading(false);
    }
  };

  const handleClose = (value: boolean) => {
    if (!value) {
      setNewKey(null);
    }
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {keyType === "publishable"
              ? t("publishableDescription")
              : t("secretDescription")}
          </DialogDescription>
        </DialogHeader>

        {newKey ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              {t("success")}
            </div>
            <KeyDisplay
              label={keyType === "publishable" ? "Publishable Key" : "Secret Key"}
              value={newKey}
            />
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
            <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              {t("warning")}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {newKey ? tCommon("close") : tCommon("cancel")}
          </Button>
          {!newKey && (
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? t("regenerating") : t("confirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
