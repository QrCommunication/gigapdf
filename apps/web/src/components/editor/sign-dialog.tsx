"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, FileSignature, ShieldCheck, TriangleAlert } from "lucide-react";
import { useSignPdf, downloadBlob } from "@giga-pdf/api";

export interface SignDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  /** Suggested filename for the resulting download. */
  baseFilename?: string;
  /**
   * Called with the signed PDF when the user chooses to apply the signature
   * to the current document (instead of downloading a copy). When omitted,
   * the dialog falls back to download-only behaviour.
   */
  onApplied?: (blob: Blob) => void;
}

/** What to do with the signed PDF once produced. */
type OutputMode = "apply" | "download";

/** Route-aligned cap on the P12 container size. */
const MAX_P12_SIZE_BYTES = 1024 * 1024;

/**
 * SignDialog — apply a PKCS#7 detached digital signature to the current PDF
 * using a user-provided PKCS#12 (.p12/.pfx) certificate.
 *
 * SECURITY: the certificate file and its passphrase live only in this
 * component's state for the duration of the request — they are never
 * persisted nor logged, client or server side.
 */
export function SignDialog({
  open,
  onClose,
  currentFile,
  baseFilename = "signed.pdf",
  onApplied,
}: SignDialogProps) {
  const t = useTranslations("editor.sign");
  const [p12File, setP12File] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [outputMode, setOutputMode] = useState<OutputMode>("apply");
  const signPdf = useSignPdf();

  // Without an onApplied callback there is nothing to apply the result to —
  // the dialog degrades to download-only behaviour.
  const canApplyToDocument = Boolean(onApplied);

  const p12TooLarge = p12File !== null && p12File.size > MAX_P12_SIZE_BYTES;

  const resetSecrets = () => {
    setP12File(null);
    setPassphrase("");
  };

  const handleClose = () => {
    // Never keep credential material around once the dialog closes.
    resetSecrets();
    signPdf.reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile || !p12File || p12TooLarge) return;
    const blob = await signPdf.mutateAsync({
      file: currentFile,
      p12: p12File,
      passphrase,
      options: {
        reason: reason.trim() || undefined,
        location: location.trim() || undefined,
        contactInfo: contactInfo.trim() || undefined,
      },
    });
    if (canApplyToDocument && outputMode === "apply") {
      // Hand the signed binary to the editor so it replaces the live
      // document (and gets persisted) instead of only producing a download.
      onApplied?.(blob);
    } else {
      downloadBlob(blob, baseFilename.replace(/\.pdf$/i, "") + ".signed.pdf");
    }
    handleClose();
  };

  if (!open) return null;

  const errorMessage = signPdf.isError
    ? (signPdf.error as Error)?.name === "InvalidCertificateError"
      ? t("errors.invalidCertificate")
      : t("errors.generic")
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <FileSignature size={18} className="text-muted-foreground" />
            <h2
              id="sign-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("close")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="px-6 pb-6 pt-2 space-y-4">
          <div>
            <label
              htmlFor="sign-p12-input"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("certificateLabel")}
            </label>
            <input
              id="sign-p12-input"
              type="file"
              accept=".p12,.pfx,application/x-pkcs12"
              onChange={(e) => setP12File(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-foreground file:mr-3 file:px-3 file:py-2 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:font-medium file:text-foreground hover:file:bg-muted file:cursor-pointer"
              required
            />
            {p12TooLarge && (
              <p className="mt-1 text-xs text-destructive">
                {t("errors.certificateTooLarge")}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="sign-passphrase-input"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("passphraseLabel")}
            </label>
            <input
              id="sign-passphrase-input"
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="sign-reason-input"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("reasonLabel")}
            </label>
            <input
              id="sign-reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={255}
              placeholder={t("reasonPlaceholder")}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="sign-location-input"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("locationLabel")}
            </label>
            <input
              id="sign-location-input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={255}
              placeholder={t("locationPlaceholder")}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="sign-contact-input"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("contactLabel")}
            </label>
            <input
              id="sign-contact-input"
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
              maxLength={255}
              placeholder={t("contactPlaceholder")}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{t("privacyNote")}</p>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t("lastOperationWarning")}
            </p>
          </div>

          {canApplyToDocument && (
            <fieldset>
              <legend className="block text-sm font-medium text-foreground mb-1">
                {t("modeLabel")}
              </legend>
              <div className="space-y-2">
                {(
                  [
                    {
                      value: "apply",
                      label: t("applyToDocument"),
                      hint: t("applyToDocumentHint"),
                    },
                    {
                      value: "download",
                      label: t("downloadOnly"),
                      hint: t("downloadOnlyHint"),
                    },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                      outputMode === option.value
                        ? "border-primary bg-primary/5"
                        : "border-input hover:bg-muted"
                    }`}
                  >
                    <input
                      type="radio"
                      name="sign-output-mode"
                      value={option.value}
                      checked={outputMode === option.value}
                      onChange={() => setOutputMode(option.value)}
                      className="mt-0.5 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {option.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {errorMessage && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-md border border-input hover:bg-muted"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={
                !currentFile || !p12File || p12TooLarge || signPdf.isPending
              }
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {signPdf.isPending && (
                <Loader2 size={14} className="animate-spin" />
              )}
              {t("submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
