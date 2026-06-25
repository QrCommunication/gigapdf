"use client";

import React, { useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  useEncryptPdf,
  useDecryptPdf,
  useGetPermissions,
  useSetPermissions,
  downloadBlob,
} from "@giga-pdf/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "encrypt" | "decrypt" | "permissions";
type Algorithm = "AES-128" | "AES-256";
/** How a document is protected on the Encrypt tab. */
type EncryptMethod = "password" | "certificates";
/** How a protected document is unlocked on the Decrypt tab. */
type DecryptMethod = "password" | "certificate";

/**
 * `accept` filter for X.509 recipient certificates (DER or PEM).
 */
const CERTIFICATE_ACCEPT =
  ".cer,.crt,.pem,.der,application/x-x509-ca-cert,application/x-x509-user-cert,application/pkix-cert";

/**
 * `accept` filter for a PKCS#1 RSA private key (DER or PEM).
 */
const PRIVATE_KEY_ACCEPT =
  ".key,.pem,.der,application/x-pem-file,application/pkcs8";

interface DocumentPermissions {
  print: boolean;
  modify: boolean;
  copy: boolean;
  annotate: boolean;
  fillForms: boolean;
  extract: boolean;
  assemble: boolean;
  printHighQuality: boolean;
}

const ALL_PERMISSIONS: DocumentPermissions = {
  print: true,
  modify: true,
  copy: true,
  annotate: true,
  fillForms: true,
  extract: true,
  assemble: true,
  printHighQuality: true,
};

/**
 * Ordered list of permission flags. Labels are resolved at render time via
 * `t(\`permissions.${key}\`)` so they stay localized.
 */
const PERMISSION_KEYS: ReadonlyArray<keyof DocumentPermissions> = [
  "print",
  "modify",
  "copy",
  "annotate",
  "fillForms",
  "extract",
  "assemble",
  "printHighQuality",
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface EncryptDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile?: File | null;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface TabButtonProps {
  id: TabId;
  label: string;
  activeTab: TabId;
  onClick: (id: TabId) => void;
}

function TabButton({ id, label, activeTab, onClick }: TabButtonProps) {
  const isActive = activeTab === id;
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={[
        "flex-1 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
      ].join(" ")}
      aria-selected={isActive}
      role="tab"
    >
      {label}
    </button>
  );
}

interface FieldLabelProps {
  htmlFor: string;
  children: React.ReactNode;
}

function FieldLabel({ htmlFor, children }: FieldLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-foreground mb-1.5"
    >
      {children}
    </label>
  );
}

interface TextInputProps {
  id: string;
  type?: "text" | "password";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function TextInput({
  id,
  type = "text",
  value,
  onChange,
  placeholder,
  disabled,
}: TextInputProps) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

interface CheckboxFieldProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function CheckboxField({
  id,
  label,
  checked,
  onChange,
  disabled,
}: CheckboxFieldProps) {
  return (
    <label
      htmlFor={id}
      className="flex items-center gap-2.5 cursor-pointer select-none group"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="text-sm text-foreground group-hover:text-foreground/80">
        {label}
      </span>
    </label>
  );
}

interface FilePickerProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}

function FilePicker({ file, onFileChange, disabled }: FilePickerProps) {
  const t = useTranslations("editor.encrypt");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0] ?? null;
      onFileChange(picked);
      // Reset so the same file can be re-selected if needed
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFileChange]
  );

  return (
    <div>
      <FieldLabel htmlFor="encrypt-file-input">{t("filePdfLabel")}</FieldLabel>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="h-10 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("chooseFile")}
        </button>
        <span className="text-sm text-muted-foreground truncate max-w-[240px]">
          {file ? file.name : t("noFileSelected")}
        </span>
      </div>
      <input
        ref={inputRef}
        id="encrypt-file-input"
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleChange}
        className="sr-only"
        aria-label={t("selectPdfFileAria")}
      />
    </div>
  );
}

interface SegmentedOption<T extends string> {
  id: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}

/** Small radio-group segmented control used to pick the encryption method. */
function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-input bg-background p-0.5"
    >
      {options.map((option) => {
        const isActive = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={[
              "px-3 py-1.5 text-sm font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface SingleFilePickerProps {
  id: string;
  label: string;
  accept: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
  hint?: string;
}

/** Generic single-file picker (used for the certificate and the private key). */
function SingleFilePicker({
  id,
  label,
  accept,
  file,
  onFileChange,
  disabled,
  hint,
}: SingleFilePickerProps) {
  const t = useTranslations("editor.encrypt");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFileChange(e.target.files?.[0] ?? null);
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFileChange]
  );

  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="h-10 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("chooseFile")}
        </button>
        <span className="text-sm text-muted-foreground truncate max-w-[240px]">
          {file ? file.name : t("noFileSelected")}
        </span>
      </div>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="sr-only"
        aria-label={label}
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface MultiFilePickerProps {
  id: string;
  label: string;
  accept: string;
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
  hint?: string;
}

/** Multi-file picker accumulating the recipient certificates for encryption. */
function MultiFilePicker({
  id,
  label,
  accept,
  files,
  onFilesChange,
  disabled,
  hint,
}: MultiFilePickerProps) {
  const t = useTranslations("editor.encrypt");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(e.target.files ?? []);
      if (picked.length > 0) onFilesChange([...files, ...picked]);
      if (inputRef.current) inputRef.current.value = "";
    },
    [files, onFilesChange]
  );

  const removeAt = useCallback(
    (index: number) => {
      onFilesChange(files.filter((_, i) => i !== index));
    },
    [files, onFilesChange]
  );

  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="h-10 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("addCertificates")}
      </button>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple
        onChange={handleChange}
        className="sr-only"
        aria-label={label}
      />
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-sm"
            >
              <span className="truncate text-foreground">{f.name}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={disabled}
                aria-label={t("removeFileAria", { name: f.name })}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface ErrorBannerProps {
  message: string;
}

function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
    >
      <svg
        className="mt-0.5 h-4 w-4 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
          clipRule="evenodd"
        />
      </svg>
      <span>{message}</span>
    </div>
  );
}

interface SuccessBannerProps {
  message: string;
}

function SuccessBanner({ message }: SuccessBannerProps) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5 text-sm text-green-700 dark:text-green-400"
    >
      <svg
        className="h-4 w-4 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
          clipRule="evenodd"
        />
      </svg>
      <span>{message}</span>
    </div>
  );
}

interface SubmitButtonProps {
  loading: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

function SubmitButton({ loading, disabled, children }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="w-full h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}

// ─── Tab panels ──────────────────────────────────────────────────────────────

interface EncryptPanelProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  showFilePicker: boolean;
}

function EncryptPanel({ file, onFileChange, showFilePicker }: EncryptPanelProps) {
  const t = useTranslations("editor.encrypt");
  const [method, setMethod] = useState<EncryptMethod>("password");
  const [userPassword, setUserPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [recipientCerts, setRecipientCerts] = useState<File[]>([]);
  const [algorithm, setAlgorithm] = useState<Algorithm>("AES-256");
  const [permissions, setPermissions] =
    useState<DocumentPermissions>(ALL_PERMISSIONS);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const encryptPdf = useEncryptPdf();

  const activeFile = file;

  const togglePermission = useCallback(
    (key: keyof DocumentPermissions, checked: boolean) => {
      setPermissions((prev) => ({ ...prev, [key]: checked }));
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!activeFile) {
        setError(t("errorSelectFile"));
        return;
      }

      if (
        method === "password" &&
        !userPassword.trim() &&
        !ownerPassword.trim()
      ) {
        setError(t("errorPasswordRequired"));
        return;
      }

      if (method === "certificates" && recipientCerts.length === 0) {
        setError(t("errorCertRequired"));
        return;
      }

      try {
        const blob = await encryptPdf.mutateAsync({
          file: activeFile,
          options:
            method === "certificates"
              ? {
                  certificates: recipientCerts,
                  algorithm,
                  permissions: { ...permissions },
                }
              : {
                  userPassword: userPassword.trim() || undefined,
                  ownerPassword: ownerPassword.trim() || undefined,
                  algorithm,
                  permissions: { ...permissions },
                },
        });

        const filename = activeFile.name.replace(/\.pdf$/i, "") + "_encrypted.pdf";
        downloadBlob(blob, filename);
        setSuccess(true);
        setUserPassword("");
        setOwnerPassword("");
        setRecipientCerts([]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("errorEncryptFailed");
        setError(message);
      }
    },
    [
      activeFile,
      method,
      userPassword,
      ownerPassword,
      recipientCerts,
      algorithm,
      permissions,
      encryptPdf,
      t,
    ]
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {showFilePicker && (
        <FilePicker
          file={file}
          onFileChange={onFileChange}
          disabled={encryptPdf.isPending}
        />
      )}

      <div>
        <FieldLabel htmlFor="encrypt-method">{t("protectionMethod")}</FieldLabel>
        <SegmentedControl<EncryptMethod>
          value={method}
          onChange={setMethod}
          ariaLabel={t("protectionMethod")}
          disabled={encryptPdf.isPending}
          options={[
            { id: "password", label: t("methodPassword") },
            { id: "certificates", label: t("methodCertificates") },
          ]}
        />
      </div>

      {method === "password" ? (
        <>
          <div>
            <FieldLabel htmlFor="encrypt-user-password">
              {t("userPassword")}{" "}
              <span className="text-muted-foreground font-normal">
                {t("optional")}
              </span>
            </FieldLabel>
            <TextInput
              id="encrypt-user-password"
              type="password"
              value={userPassword}
              onChange={setUserPassword}
              placeholder={t("userPasswordPlaceholder")}
              disabled={encryptPdf.isPending}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("userPasswordHint")}
            </p>
          </div>

          <div>
            <FieldLabel htmlFor="encrypt-owner-password">
              {t("ownerPassword")}{" "}
              <span className="text-muted-foreground font-normal">
                {t("optional")}
              </span>
            </FieldLabel>
            <TextInput
              id="encrypt-owner-password"
              type="password"
              value={ownerPassword}
              onChange={setOwnerPassword}
              placeholder={t("ownerPasswordPlaceholder")}
              disabled={encryptPdf.isPending}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("ownerPasswordHint")}
            </p>
          </div>
        </>
      ) : (
        <MultiFilePicker
          id="encrypt-recipient-certs"
          label={t("recipientCertificates")}
          accept={CERTIFICATE_ACCEPT}
          files={recipientCerts}
          onFilesChange={setRecipientCerts}
          disabled={encryptPdf.isPending}
          hint={t("recipientCertificatesHint")}
        />
      )}

      <div>
        <FieldLabel htmlFor="encrypt-algorithm">
          {t("encryptionAlgorithm")}
        </FieldLabel>
        <select
          id="encrypt-algorithm"
          value={algorithm}
          onChange={(e) => setAlgorithm(e.target.value as Algorithm)}
          disabled={encryptPdf.isPending}
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="AES-256">{t("algorithmAes256")}</option>
          <option value="AES-128">{t("algorithmAes128")}</option>
        </select>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-foreground mb-3">
          {t("permissionsLegend")}
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pl-0.5">
          {PERMISSION_KEYS.map((key) => (
            <CheckboxField
              key={key}
              id={`encrypt-perm-${key}`}
              label={t(`permissions.${key}`)}
              checked={permissions[key]}
              onChange={(checked) => togglePermission(key, checked)}
              disabled={encryptPdf.isPending}
            />
          ))}
        </div>
      </fieldset>

      {error && <ErrorBanner message={error} />}
      {success && <SuccessBanner message={t("successEncrypt")} />}

      <SubmitButton loading={encryptPdf.isPending}>
        {encryptPdf.isPending ? t("encrypting") : t("encryptDownload")}
      </SubmitButton>
    </form>
  );
}

interface DecryptPanelProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  showFilePicker: boolean;
}

function DecryptPanel({ file, onFileChange, showFilePicker }: DecryptPanelProps) {
  const t = useTranslations("editor.encrypt");
  const [method, setMethod] = useState<DecryptMethod>("password");
  const [password, setPassword] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const decryptPdf = useDecryptPdf();

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!file) {
        setError(t("errorSelectFile"));
        return;
      }

      try {
        let blob: Blob;
        if (method === "password") {
          if (!password.trim()) {
            setError(t("errorDecryptPasswordRequired"));
            return;
          }
          blob = await decryptPdf.mutateAsync({ file, password: password.trim() });
        } else {
          if (!certFile || !keyFile) {
            setError(t("errorCertAndKeyRequired"));
            return;
          }
          blob = await decryptPdf.mutateAsync({
            file,
            certificate: certFile,
            privateKey: keyFile,
          });
        }

        const filename = file.name.replace(/\.pdf$/i, "") + "_decrypted.pdf";
        downloadBlob(blob, filename);
        setSuccess(true);
        setPassword("");
        setCertFile(null);
        setKeyFile(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("errorDecryptFailed");
        setError(message);
      }
    },
    [file, method, password, certFile, keyFile, decryptPdf, t]
  );

  const submitDisabled =
    method === "password" ? !password.trim() : !certFile || !keyFile;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {showFilePicker && (
        <FilePicker
          file={file}
          onFileChange={onFileChange}
          disabled={decryptPdf.isPending}
        />
      )}

      <div>
        <FieldLabel htmlFor="decrypt-method">{t("unlockMethod")}</FieldLabel>
        <SegmentedControl<DecryptMethod>
          value={method}
          onChange={setMethod}
          ariaLabel={t("unlockMethod")}
          disabled={decryptPdf.isPending}
          options={[
            { id: "password", label: t("methodPassword") },
            { id: "certificate", label: t("methodCertificate") },
          ]}
        />
      </div>

      {method === "password" ? (
        <div>
          <FieldLabel htmlFor="decrypt-password">{t("passwordLabel")}</FieldLabel>
          <TextInput
            id="decrypt-password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={t("decryptPasswordPlaceholder")}
            disabled={decryptPdf.isPending}
          />
        </div>
      ) : (
        <>
          <SingleFilePicker
            id="decrypt-certificate"
            label={t("recipientCertificate")}
            accept={CERTIFICATE_ACCEPT}
            file={certFile}
            onFileChange={setCertFile}
            disabled={decryptPdf.isPending}
            hint={t("decryptCertificateHint")}
          />
          <SingleFilePicker
            id="decrypt-private-key"
            label={t("privateKey")}
            accept={PRIVATE_KEY_ACCEPT}
            file={keyFile}
            onFileChange={setKeyFile}
            disabled={decryptPdf.isPending}
            hint={t("privateKeyHint")}
          />
        </>
      )}

      {error && <ErrorBanner message={error} />}
      {success && <SuccessBanner message={t("successDecrypt")} />}

      <SubmitButton loading={decryptPdf.isPending} disabled={submitDisabled}>
        {decryptPdf.isPending ? t("decrypting") : t("decryptDownload")}
      </SubmitButton>
    </form>
  );
}

interface PermissionsPanelProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  showFilePicker: boolean;
}

function PermissionsPanel({
  file,
  onFileChange,
  showFilePicker,
}: PermissionsPanelProps) {
  const t = useTranslations("editor.encrypt");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [permissions, setPermissions] =
    useState<DocumentPermissions>(ALL_PERMISSIONS);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fetchedInfo, setFetchedInfo] = useState<{
    isEncrypted: boolean;
  } | null>(null);

  const getPermissions = useGetPermissions();
  const setPermissionsMutation = useSetPermissions();

  const isPending =
    getPermissions.isPending || setPermissionsMutation.isPending;

  const handleLoadPermissions = useCallback(async () => {
    if (!file) {
      setError(t("errorSelectFile"));
      return;
    }

    setError(null);
    setFetchedInfo(null);

    try {
      const result = await getPermissions.mutateAsync(file);
      setFetchedInfo({ isEncrypted: result.isEncrypted });

      // Merge fetched permissions with defaults (fill missing keys as true)
      const fetched = result.permissions as Partial<Record<keyof DocumentPermissions, boolean>>;
      setPermissions({
        print: fetched.print ?? true,
        modify: fetched.modify ?? true,
        copy: fetched.copy ?? true,
        annotate: fetched.annotate ?? true,
        fillForms: fetched.fillForms ?? true,
        extract: fetched.extract ?? true,
        assemble: fetched.assemble ?? true,
        printHighQuality: fetched.printHighQuality ?? true,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("errorReadPermissions");
      setError(message);
    }
  }, [file, getPermissions, t]);

  const togglePermission = useCallback(
    (key: keyof DocumentPermissions, checked: boolean) => {
      setPermissions((prev) => ({ ...prev, [key]: checked }));
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!file) {
        setError(t("errorSelectFile"));
        return;
      }

      if (!ownerPassword.trim()) {
        setError(t("errorOwnerPasswordRequired"));
        return;
      }

      try {
        const blob = await setPermissionsMutation.mutateAsync({
          file,
          ownerPassword: ownerPassword.trim(),
          permissions: { ...permissions },
        });

        const filename =
          file.name.replace(/\.pdf$/i, "") + "_permissions.pdf";
        downloadBlob(blob, filename);
        setSuccess(true);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("errorSetPermissions");
        setError(message);
      }
    },
    [file, ownerPassword, permissions, setPermissionsMutation, t]
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {showFilePicker && (
        <FilePicker
          file={file}
          onFileChange={onFileChange}
          disabled={isPending}
        />
      )}

      {/* Load current permissions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleLoadPermissions}
          disabled={isPending || !file}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2"
        >
          {getPermissions.isPending && (
            <svg
              className="h-3.5 w-3.5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {t("loadCurrentPermissions")}
        </button>

        {fetchedInfo !== null && (
          <span
            className={[
              "text-xs font-medium px-2 py-1 rounded-full",
              fetchedInfo.isEncrypted
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-muted text-muted-foreground",
            ].join(" ")}
          >
            {fetchedInfo.isEncrypted ? t("encrypted") : t("notEncrypted")}
          </span>
        )}
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-foreground mb-3">
          {t("permissionsToSet")}
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pl-0.5">
          {PERMISSION_KEYS.map((key) => (
            <CheckboxField
              key={key}
              id={`perms-${key}`}
              label={t(`permissions.${key}`)}
              checked={permissions[key]}
              onChange={(checked) => togglePermission(key, checked)}
              disabled={isPending}
            />
          ))}
        </div>
      </fieldset>

      <div>
        <FieldLabel htmlFor="perms-owner-password">
          {t("ownerPassword")}
        </FieldLabel>
        <TextInput
          id="perms-owner-password"
          type="password"
          value={ownerPassword}
          onChange={setOwnerPassword}
          placeholder={t("ownerPasswordPermsPlaceholder")}
          disabled={isPending}
        />
      </div>

      {error && <ErrorBanner message={error} />}
      {success && <SuccessBanner message={t("successPermissions")} />}

      <SubmitButton
        loading={setPermissionsMutation.isPending}
        disabled={!ownerPassword.trim()}
      >
        {setPermissionsMutation.isPending
          ? t("applying")
          : t("applyPermissionsDownload")}
      </SubmitButton>
    </form>
  );
}

// ─── Main dialog ─────────────────────────────────────────────────────────────

/**
 * EncryptDialog — modal for encrypting/decrypting PDFs and managing their
 * permission flags (print, modify, copy, etc.).
 *
 * When `currentFile` is provided the file picker is hidden and that file is
 * used automatically. When it is absent or null a file picker is shown inside
 * each tab panel.
 */
export function EncryptDialog({ open, onClose, currentFile }: EncryptDialogProps) {
  const t = useTranslations("editor.encrypt");
  const [activeTab, setActiveTab] = useState<TabId>("encrypt");
  // Local file state used only when currentFile is not provided
  const [localFile, setLocalFile] = useState<File | null>(null);

  const file = currentFile !== undefined ? (currentFile ?? null) : localFile;
  const showFilePicker = currentFile === undefined || currentFile === null;

  const handleFileChange = useCallback((picked: File | null) => {
    setLocalFile(picked);
  }, []);

  if (!open) return null;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "encrypt", label: t("tabEncrypt") },
    { id: "decrypt", label: t("tabDecrypt") },
    { id: "permissions", label: t("tabPermissions") },
  ];

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="encrypt-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-0">
          <div>
            <h2
              id="encrypt-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("title")}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="mt-0.5 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex mt-5 px-6 border-b border-border"
          role="tablist"
          aria-label={t("tablistLabel")}
        >
          {tabs.map(({ id, label }) => (
            <TabButton
              key={id}
              id={id}
              label={label}
              activeTab={activeTab}
              onClick={setActiveTab}
            />
          ))}
        </div>

        {/* Tab content */}
        <div className="px-6 py-6" role="tabpanel">
          {activeTab === "encrypt" && (
            <EncryptPanel
              file={file}
              onFileChange={handleFileChange}
              showFilePicker={showFilePicker}
            />
          )}
          {activeTab === "decrypt" && (
            <DecryptPanel
              file={file}
              onFileChange={handleFileChange}
              showFilePicker={showFilePicker}
            />
          )}
          {activeTab === "permissions" && (
            <PermissionsPanel
              file={file}
              onFileChange={handleFileChange}
              showFilePicker={showFilePicker}
            />
          )}
        </div>
      </div>
    </div>
  );
}
