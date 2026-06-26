"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from "@giga-pdf/ui";
import { FilePlus2, Loader2 } from "lucide-react";

export type BlankSize = "a4" | "letter" | "legal";
export type BlankOrientation = "portrait" | "landscape";

/** Named page sizes offered by the dialog (kept in sync with /api/pdf/blank). */
const SIZES: readonly BlankSize[] = ["a4", "letter", "legal"];

interface BlankDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired with the chosen size + orientation when the user confirms. */
  onCreate: (options: { size: BlankSize; orientation: BlankOrientation }) => void;
  /** True while the blank document is being generated + stored. */
  creating: boolean;
}

/**
 * Small dialog to pick a page size + orientation for a brand-new blank PDF.
 * Pure presentation: the actual generation/upload/navigation is owned by the
 * documents page (it has the storage client + router). Defaults to A4 portrait,
 * reset every time the dialog opens; closing is blocked while a creation is in
 * flight to preserve the spinner feedback.
 */
export function BlankDocumentDialog({
  open,
  onOpenChange,
  onCreate,
  creating,
}: BlankDocumentDialogProps) {
  const t = useTranslations("documents.blank");
  const [size, setSize] = useState<BlankSize>("a4");
  const [orientation, setOrientation] = useState<BlankOrientation>("portrait");

  // Reset to defaults each time the dialog opens.
  useEffect(() => {
    if (open) {
      setSize("a4");
      setOrientation("portrait");
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block closing mid-creation to keep the progress feedback visible.
        if (creating && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Page size */}
          <div className="space-y-2">
            <Label htmlFor="blank-size">{t("sizeLabel")}</Label>
            <Select
              value={size}
              onValueChange={(value) => setSize(value as BlankSize)}
              disabled={creating}
            >
              <SelectTrigger id="blank-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`size.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Orientation */}
          <div className="space-y-2">
            <Label>{t("orientationLabel")}</Label>
            <ToggleGroup
              type="single"
              value={orientation}
              onValueChange={(value) => {
                // Radix yields "" when the active item is toggled off — ignore
                // it so an orientation is always selected.
                if (value === "portrait" || value === "landscape") {
                  setOrientation(value);
                }
              }}
              variant="outline"
              className="justify-start"
              disabled={creating}
            >
              <ToggleGroupItem value="portrait" aria-label={t("orientation.portrait")}>
                {t("orientation.portrait")}
              </ToggleGroupItem>
              <ToggleGroupItem value="landscape" aria-label={t("orientation.landscape")}>
                {t("orientation.landscape")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            {t("cancel")}
          </Button>
          <Button onClick={() => onCreate({ size, orientation })} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                {t("creating")}
              </>
            ) : (
              <>
                <FilePlus2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("create")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
