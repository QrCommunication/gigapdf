"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { X, ShieldAlert, Loader2 } from "lucide-react";
import type { PageObject } from "@giga-pdf/types";
import {
  detectPii,
  matchesToRects,
  type PiiKind,
  type PiiMatch,
} from "./lib/pii-detection";
import type { WebRedactionRect } from "./lib/redact-pii";

export interface RedactPiiDialogProps {
  open: boolean;
  onClose: () => void;
  /** Parsed scene-graph pages to scan for PII. */
  pages: PageObject[];
  /** True while the redaction bake is in flight (drives the spinner). */
  isApplying?: boolean;
  /** Confirm: redact the detected regions. The editor handles bake + reload. */
  onConfirm: (rects: WebRedactionRect[]) => void;
}

const KIND_ORDER: PiiKind[] = ["email", "phone", "iban", "creditCard", "ssn", "siren"];

/**
 * RedactPiiDialog — auto-detect PII (emails, phones, IBANs, cards, FR
 * SSN/SIREN) across the document and permanently redact every match. Detection
 * runs client-side on the parsed scene graph; the confirm hands the regions to
 * the editor which bakes them via the engine (`redactPii`) and reloads.
 */
export function RedactPiiDialog({
  open,
  onClose,
  pages,
  isApplying = false,
  onConfirm,
}: RedactPiiDialogProps) {
  const t = useTranslations("editor.redactPii");
  // Re-detect whenever the dialog opens on a (possibly) new document.
  const matches = useMemo<PiiMatch[]>(
    () => (open ? detectPii(pages) : []),
    [open, pages],
  );

  const countsByKind = useMemo(() => {
    const counts: Partial<Record<PiiKind, number>> = {};
    for (const m of matches) {
      counts[m.kind] = (counts[m.kind] ?? 0) + 1;
    }
    return counts;
  }, [matches]);

  const [acknowledged, setAcknowledged] = useState(false);

  if (!open) return null;

  const total = matches.length;

  const handleConfirm = () => {
    if (total === 0 || isApplying) return;
    onConfirm(matchesToRects(matches));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="redact-pii-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isApplying) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-muted-foreground" />
            <h2
              id="redact-pii-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            aria-label={t("close")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pb-6 pt-2 space-y-4">
          {total === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noneFound")}</p>
          ) : (
            <>
              <p className="text-sm text-foreground">
                {t("foundCount", { count: total })}
              </p>
              <ul className="rounded-md border border-input bg-muted/30 divide-y divide-border text-sm">
                {KIND_ORDER.filter((k) => countsByKind[k]).map((kind) => (
                  <li
                    key={kind}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="text-foreground">{t(`kinds.${kind}`)}</span>
                    <span className="text-xs font-medium text-muted-foreground">
                      {countsByKind[kind]}
                    </span>
                  </li>
                ))}
              </ul>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <span className="text-muted-foreground">{t("irreversible")}</span>
              </label>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isApplying}
              className="px-4 py-2 text-sm rounded-md border border-input hover:bg-muted disabled:opacity-50"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={total === 0 || !acknowledged || isApplying}
              className="px-4 py-2 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 flex items-center gap-2"
            >
              {isApplying && <Loader2 size={14} className="animate-spin" />}
              {t("redactButton", { count: total })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
