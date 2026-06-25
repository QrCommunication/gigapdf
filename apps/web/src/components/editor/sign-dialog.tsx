"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import {
  X,
  Loader2,
  FileSignature,
  ShieldCheck,
  TriangleAlert,
  Clock,
  PenLine,
  ShieldHalf,
  Stamp,
  ListChecks,
  BadgeCheck,
  ShieldAlert,
} from "lucide-react";
import { useSignPdf, downloadBlob, pdfService } from "@giga-pdf/api";

export interface SignDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  /** Suggested filename for the resulting download. */
  baseFilename?: string;
  /**
   * Called with the signed/certified PDF when the user chooses to apply it to
   * the current document (instead of downloading a copy). When omitted, the
   * dialog falls back to download-only behaviour.
   */
  onApplied?: (blob: Blob) => void;
}

/** Which task the dialog is performing. */
type DialogMode = "sign" | "certify" | "verify";

/** What to do with the produced PDF (sign + certify only). */
type OutputMode = "apply" | "download";

/**
 * Signature assurance level (sign mode):
 * - `basic`       — plain PKCS#7 detached signature.
 * - `timestamped` — PAdES-B-T: adds an RFC 3161 trusted timestamp (FreeTSA).
 * - `ltv`         — PAdES-LTV (B-LT): a B-T signature + a /DSS carrying the
 *                   chain and OCSP/CRL revocation material. Implies a timestamp.
 */
type SignatureLevel = "basic" | "timestamped" | "ltv";

/** DocMDP permission level (certify mode). */
type DocMdpLevel = 1 | 2 | 3;

/** Per-signature verify verdict, derived from the engine's SignatureReport. */
type SignatureStatus = "valid" | "modified" | "invalid";

/** The shape returned by the verify endpoint, derived from the service. */
type VerifyResult = Awaited<ReturnType<typeof pdfService.verifyPdfSignatures>>;
type SignatureReportRow = VerifyResult["reports"][number];
type SignatureMetaRow = VerifyResult["signatures"][number];

/** Route-aligned cap on the P12 container size. */
const MAX_P12_SIZE_BYTES = 1024 * 1024;

/** Cryptographic verdict for one signature row. */
function signatureStatus(report: SignatureReportRow): SignatureStatus {
  const cryptoOk = report.byteRangeOk && report.digestOk && report.signatureOk;
  if (!cryptoOk) return "invalid";
  return report.coversWholeDocument ? "valid" : "modified";
}

/** Renders a PDF date string (`D:YYYYMMDDHHmmSS…`) as `DD/MM/YYYY HH:mm`. */
function formatPdfDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/.exec(raw);
  if (!m) return raw;
  const [, y, mo, d, h = "00", mi = "00"] = m;
  return `${d}/${mo}/${y} ${h}:${mi}`;
}

/**
 * SignDialog — apply a digital signature to the current PDF, with three modes:
 *
 *  - **Sign**     PKCS#7 detached signature from a user-provided PKCS#12
 *                 (.p12/.pfx), optionally PAdES-B-T (timestamp) or PAdES-LTV.
 *  - **Certify**  DocMDP author certification declaring which later changes are
 *                 permitted (uses a generated self-signed identity).
 *  - **Verify**   list and cryptographically verify every signature.
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

  const [mode, setMode] = useState<DialogMode>("sign");

  // Sign-mode state.
  const [p12File, setP12File] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [signerName, setSignerName] = useState("");
  const [level, setLevel] = useState<SignatureLevel>("basic");

  // Certify-mode state.
  const [docmdpLevel, setDocmdpLevel] = useState<DocMdpLevel>(2);

  // Shared output target (sign + certify).
  const [outputMode, setOutputMode] = useState<OutputMode>("apply");

  const signPdf = useSignPdf();
  const certify = useMutation({
    mutationFn: ({
      file,
      options,
    }: {
      file: File;
      options: Parameters<typeof pdfService.certifyPdf>[1];
    }) => pdfService.certifyPdf(file, options),
  });
  const verify = useMutation({
    mutationFn: (file: File) => pdfService.verifyPdfSignatures(file),
  });

  // Without an onApplied callback there is nothing to apply the result to —
  // the dialog degrades to download-only behaviour.
  const canApplyToDocument = Boolean(onApplied);

  const p12TooLarge = p12File !== null && p12File.size > MAX_P12_SIZE_BYTES;
  const isPending = signPdf.isPending || certify.isPending || verify.isPending;

  const resetSecrets = () => {
    setP12File(null);
    setPassphrase("");
  };

  const handleClose = () => {
    // Never keep credential material around once the dialog closes.
    resetSecrets();
    signPdf.reset();
    certify.reset();
    verify.reset();
    onClose();
  };

  /** Apply the produced binary to the document, or download a copy, then close. */
  const finishBinary = (blob: Blob) => {
    if (canApplyToDocument && outputMode === "apply") {
      onApplied?.(blob);
    } else {
      const suffix = mode === "certify" ? ".certified.pdf" : ".signed.pdf";
      downloadBlob(blob, baseFilename.replace(/\.pdf$/i, "") + suffix);
    }
    handleClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile) return;

    if (mode === "verify") {
      // Read-only: keep the dialog open to show the results.
      await verify.mutateAsync(currentFile);
      return;
    }

    if (mode === "certify") {
      const blob = await certify.mutateAsync({
        file: currentFile,
        options: {
          docmdpLevel,
          reason: reason.trim() || undefined,
          signerName: signerName.trim() || undefined,
        },
      });
      finishBinary(blob);
      return;
    }

    // mode === "sign"
    if (!p12File || p12TooLarge) return;
    const blob = await signPdf.mutateAsync({
      file: currentFile,
      p12: p12File,
      passphrase,
      options: {
        reason: reason.trim() || undefined,
        location: location.trim() || undefined,
        contactInfo: contactInfo.trim() || undefined,
        signerName: signerName.trim() || undefined,
        // `ltv` implies a B-T timestamp server-side and takes precedence over
        // `timestamp`; both are derived from the single level selector.
        timestamp: level === "timestamped",
        ltv: level === "ltv",
      },
    });
    finishBinary(blob);
  };

  if (!open) return null;

  // Mode-aware error message.
  let errorMessage: string | null = null;
  if (mode === "sign" && signPdf.isError) {
    const name = (signPdf.error as Error)?.name;
    errorMessage =
      name === "InvalidCertificateError"
        ? t("errors.invalidCertificate")
        : name === "TsaUnreachableError"
          ? t("errors.tsaUnreachable")
          : name === "LtvUnreachableError"
            ? t("errors.ltvUnreachable")
            : t("errors.generic");
  } else if (mode === "certify" && certify.isError) {
    errorMessage = t("errors.certifyFailed");
  } else if (mode === "verify" && verify.isError) {
    errorMessage = t("errors.verifyFailed");
  }

  const submitDisabled =
    !currentFile ||
    isPending ||
    (mode === "sign" && (!p12File || p12TooLarge));

  const submitLabel =
    mode === "verify"
      ? t("verifyButton")
      : mode === "certify"
        ? t("certifyButton")
        : t("submit");

  const verifyResult = verify.data;

  const tabs: ReadonlyArray<{ value: DialogMode; Icon: typeof PenLine; label: string }> =
    [
      { value: "sign", Icon: FileSignature, label: t("tabSign") },
      { value: "certify", Icon: Stamp, label: t("tabCertify") },
      { value: "verify", Icon: ListChecks, label: t("tabVerify") },
    ];

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
              {t("headerTitle")}
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

        {/* Mode selector */}
        <div
          role="tablist"
          aria-label={t("headerTitle")}
          className="mx-6 mt-1 mb-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1"
        >
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={mode === tab.value}
              onClick={() => setMode(tab.value)}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
                mode === tab.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.Icon size={14} className="shrink-0" />
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="px-6 pb-6 pt-2 space-y-4">
          {mode === "sign" && (
            <>
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

              <fieldset>
                <legend className="block text-sm font-medium text-foreground mb-1">
                  {t("levelLabel")}
                </legend>
                <div className="space-y-2">
                  {(
                    [
                      {
                        value: "basic",
                        Icon: PenLine,
                        label: t("levelBasic"),
                        hint: t("levelBasicHint"),
                      },
                      {
                        value: "timestamped",
                        Icon: Clock,
                        label: t("levelTimestamped"),
                        hint: t("levelTimestampedHint"),
                      },
                      {
                        value: "ltv",
                        Icon: ShieldHalf,
                        label: t("levelLtv"),
                        hint: t("levelLtvHint"),
                      },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-start gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                        level === option.value
                          ? "border-primary bg-primary/5"
                          : "border-input hover:bg-muted"
                      }`}
                    >
                      <input
                        type="radio"
                        name="sign-level"
                        value={option.value}
                        checked={level === option.value}
                        onChange={() => setLevel(option.value)}
                        className="mt-0.5 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <option.Icon size={14} className="shrink-0 text-muted-foreground" />
                          {option.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {option.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {level === "ltv" && (
                  <p className="mt-2 text-xs text-muted-foreground">{t("ltvCaHint")}</p>
                )}
              </fieldset>

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
            </>
          )}

          {mode === "certify" && (
            <>
              <p className="text-sm text-muted-foreground">{t("certifyIntro")}</p>

              <div>
                <label
                  htmlFor="certify-name-input"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("signerNameLabel")}
                </label>
                <input
                  id="certify-name-input"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  maxLength={255}
                  placeholder={t("signerNamePlaceholder")}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label
                  htmlFor="certify-reason-input"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("reasonLabel")}
                </label>
                <input
                  id="certify-reason-input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={255}
                  placeholder={t("reasonPlaceholder")}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <fieldset>
                <legend className="block text-sm font-medium text-foreground mb-1">
                  {t("docmdpLabel")}
                </legend>
                <div className="space-y-2">
                  {(
                    [
                      { value: 1, label: t("docmdpLevel1"), hint: t("docmdpLevel1Hint") },
                      { value: 2, label: t("docmdpLevel2"), hint: t("docmdpLevel2Hint") },
                      { value: 3, label: t("docmdpLevel3"), hint: t("docmdpLevel3Hint") },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-start gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                        docmdpLevel === option.value
                          ? "border-primary bg-primary/5"
                          : "border-input hover:bg-muted"
                      }`}
                    >
                      <input
                        type="radio"
                        name="certify-docmdp"
                        value={option.value}
                        checked={docmdpLevel === option.value}
                        onChange={() => setDocmdpLevel(option.value)}
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

              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{t("certifySelfSignedHint")}</p>
              </div>

              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t("lastOperationWarning")}
                </p>
              </div>
            </>
          )}

          {mode === "verify" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("verifyIntro")}</p>

              {verifyResult && verifyResult.reports.length === 0 && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-3">
                  <ShieldHalf size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t("verifyEmpty")}</p>
                </div>
              )}

              {verifyResult && verifyResult.reports.length > 0 && (
                <ul className="space-y-2">
                  {verifyResult.reports.map((report, i) => {
                    const meta: SignatureMetaRow | undefined =
                      verifyResult.signatures.find(
                        (s) => s.fieldName === report.fieldName,
                      ) ?? verifyResult.signatures[i];
                    const status = signatureStatus(report);
                    const signer =
                      meta?.signerName ||
                      report.signerCommonName ||
                      t("verifyUnknownSigner");
                    const date = formatPdfDate(meta?.date ?? null);
                    const badge =
                      status === "valid"
                        ? {
                            Icon: BadgeCheck,
                            label: t("verifyValid"),
                            cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                          }
                        : status === "modified"
                          ? {
                              Icon: TriangleAlert,
                              label: t("verifyValidModified"),
                              cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                            }
                          : {
                              Icon: ShieldAlert,
                              label: t("verifyInvalid"),
                              cls: "border-destructive/40 bg-destructive/10 text-destructive",
                            };
                    return (
                      <li
                        key={report.fieldName || `sig-${i}`}
                        className="rounded-md border border-border bg-muted/30 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {signer}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}
                          >
                            <badge.Icon size={12} className="shrink-0" />
                            {badge.label}
                          </span>
                        </div>
                        <dl className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                          {meta?.reason && (
                            <div className="flex gap-1">
                              <dt className="font-medium">{t("verifyReason")}:</dt>
                              <dd className="truncate">{meta.reason}</dd>
                            </div>
                          )}
                          {date && (
                            <div className="flex gap-1">
                              <dt className="font-medium">{t("verifyDate")}:</dt>
                              <dd>{date}</dd>
                            </div>
                          )}
                          <div className="flex gap-1">
                            <dt className="font-medium">{t("verifyAlgorithm")}:</dt>
                            <dd>{report.algorithm}</dd>
                          </div>
                          <div className="flex gap-1">
                            <dt className="font-medium">{t("verifyCoverage")}:</dt>
                            <dd>
                              {report.coversWholeDocument
                                ? t("verifyCoversWhole")
                                : t("verifyCoversPartial")}
                            </dd>
                          </div>
                        </dl>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Output target — sign + certify only. */}
          {mode !== "verify" && canApplyToDocument && (
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

          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-md border border-input hover:bg-muted"
            >
              {mode === "verify" && verifyResult ? t("done") : t("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {isPending && <Loader2 size={14} className="animate-spin" />}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
