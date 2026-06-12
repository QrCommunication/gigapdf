"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { storageKeys } from "@giga-pdf/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@giga-pdf/ui";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";
import { TagInput, userTagsQueryKey } from "./tag-input";

interface ManageTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentName: string;
  /** Current tags of the document (chips are pre-filled with them). */
  initialTags: string[];
  /** Called after a successful save with the persisted tag list. */
  onSaved?: (tags: string[]) => void;
}

/**
 * "Manage tags" dialog shared by the card menu, the table menu and the
 * detail page. Saves the full replacement list via
 * PATCH /storage/documents/{id} and refreshes the tag autocomplete cache.
 */
export function ManageTagsDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
  initialTags,
  onSaved,
}: ManageTagsDialogProps) {
  const t = useTranslations("documents.tags");
  const tToasts = useTranslations("documents.toasts");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tags, setTags] = useState<string[]>(initialTags);

  // Re-sync the draft each time the dialog opens for a (possibly different)
  // document — dialog instances are reused across rows. Render-time state
  // adjustment ("adjusting state when props change", react.dev) instead of
  // an effect: no extra commit, no cascading render.
  const [lastOpenKey, setLastOpenKey] = useState<string | null>(null);
  const openKey = open ? documentId : null;
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    if (openKey !== null) setTags(initialTags);
  }

  const suggestionsQuery = useQuery({
    queryKey: userTagsQueryKey,
    queryFn: () => api.getUserTags(),
    enabled: open,
    staleTime: 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: (nextTags: string[]) =>
      api.updateStoredDocument(documentId, { tags: nextTags }),
    onSuccess: (data) => {
      toast({ title: tToasts("tagsUpdated") });
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
      queryClient.invalidateQueries({ queryKey: userTagsQueryKey });
      onSaved?.(data.tags);
      onOpenChange(false);
    },
    onError: (error) => {
      clientLogger.error("manage-tags-dialog.save-failed", error);
      toast({ variant: "destructive", title: tToasts("tagsUpdateFailed") });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialog.title")}</DialogTitle>
          <DialogDescription>
            {t("dialog.description", { name: documentName })}
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <TagInput
            value={tags}
            onChange={setTags}
            suggestions={suggestionsQuery.data ?? []}
            disabled={saveMutation.isPending}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saveMutation.isPending}
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            onClick={() => saveMutation.mutate(tags)}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("dialog.saving")}
              </>
            ) : (
              t("dialog.save")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
