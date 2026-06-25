"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useGetPdfMetadata, downloadBlob } from "@giga-pdf/api";
import type { DocumentMetadata } from "@giga-pdf/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "view" | "edit";

/** Shape returned by GET /api/pdf/metadata — metadata + raw XMP packet. */
interface MetadataGetResult {
  metadata: DocumentMetadata;
  xmp?: string | null;
}

/** Catalog `/PageLayout` names accepted by the engine (ISO 32000-1 §7.7.2). */
const PAGE_LAYOUT_OPTIONS = [
  "SinglePage",
  "OneColumn",
  "TwoColumnLeft",
  "TwoColumnRight",
  "TwoPageLeft",
  "TwoPageRight",
] as const;

/** Catalog `/PageMode` names accepted by the engine (ISO 32000-1 §7.7.2). */
const PAGE_MODE_OPTIONS = [
  "UseNone",
  "UseOutlines",
  "UseThumbs",
  "FullScreen",
  "UseOC",
  "UseAttachments",
] as const;

/** Boolean `/ViewerPreferences` keys exposed to the user. */
const VIEWER_BOOLEAN_KEYS = [
  "hideToolbar",
  "hideMenubar",
  "hideWindowUI",
  "fitWindow",
  "centerWindow",
  "displayDocTitle",
] as const;

type ViewerBooleanKey = (typeof VIEWER_BOOLEAN_KEYS)[number];

/** Payload accepted by the metadata `set` action (mirrors the route contract). */
interface SetMetadataPayload {
  metadata?: Partial<DocumentMetadata>;
  xmp?: string;
  viewerPreferences?: Record<string, boolean | "L2R" | "R2L">;
  pageLayout?: string;
  pageMode?: string;
}

// ─── Network helper ───────────────────────────────────────────────────────────

/** Best-effort bearer header (cookie session still authenticates same-origin). */
function getAuthHeader(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * POST a `set` operation to /api/pdf/metadata and return the modified PDF as a
 * Blob. Sends only the fields present in `payload`; the route applies Info →
 * display preferences → XMP in that order.
 */
async function postMetadataSet(
  file: File,
  payload: SetMetadataPayload,
): Promise<Blob> {
  const form = new FormData();
  form.append("file", file);
  form.append("action", "set");
  if (payload.metadata) form.append("metadata", JSON.stringify(payload.metadata));
  if (payload.xmp !== undefined) form.append("xmp", payload.xmp);
  if (payload.viewerPreferences)
    form.append("viewerPreferences", JSON.stringify(payload.viewerPreferences));
  if (payload.pageLayout) form.append("pageLayout", payload.pageLayout);
  if (payload.pageMode) form.append("pageMode", payload.pageMode);

  const response = await fetch("/api/pdf/metadata", {
    method: "POST",
    headers: getAuthHeader(),
    body: form,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = (await response.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new Error(message);
  }
  return response.blob();
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MetadataDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentFile: File | null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

interface ReadOnlyFieldProps {
  label: string;
  value: string | null | undefined;
  id: string;
}

function ReadOnlyField({ label, value, id }: ReadOnlyFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-muted-foreground mb-1"
      >
        {label}
      </label>
      <div
        id={id}
        className="w-full min-h-9 px-3 py-2 rounded-md border border-input bg-muted/40 text-sm text-foreground break-words"
      >
        {value ?? <span className="text-muted-foreground italic">—</span>}
      </div>
    </div>
  );
}

interface TextInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: TextInputProps) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

interface SelectFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  unchangedLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
}

function SelectField({
  id,
  value,
  onChange,
  unchangedLabel,
  options,
  disabled,
}: SelectFieldProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option value="">{unchangedLabel}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
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
      className="flex items-center gap-2 text-sm text-foreground select-none cursor-pointer"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      {label}
    </label>
  );
}

interface KeywordsInputProps {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  placeholder: string;
  addLabel: string;
  removeLabel: (keyword: string) => string;
  disabled?: boolean;
}

function KeywordsInput({
  keywords,
  onChange,
  placeholder,
  addLabel,
  removeLabel,
  disabled,
}: KeywordsInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addKeyword = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      // Split by comma to allow pasting multiple at once
      const parts = trimmed
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const next = [...keywords];
      for (const part of parts) {
        if (!next.includes(part)) {
          next.push(part);
        }
      }
      onChange(next);
      setInputValue("");
    },
    [keywords, onChange]
  );

  const removeKeyword = useCallback(
    (index: number) => {
      onChange(keywords.filter((_, i) => i !== index));
    },
    [keywords, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        addKeyword(inputValue);
      } else if (
        e.key === "Backspace" &&
        inputValue === "" &&
        keywords.length > 0
      ) {
        onChange(keywords.slice(0, -1));
      }
    },
    [addKeyword, inputValue, keywords, onChange]
  );

  const handleBlur = useCallback(() => {
    if (inputValue.trim()) {
      addKeyword(inputValue);
    }
  }, [addKeyword, inputValue]);

  return (
    <div
      className={[
        "min-h-10 w-full flex flex-wrap gap-1.5 px-2 py-1.5 rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring transition-shadow",
        disabled ? "cursor-not-allowed opacity-50" : "",
      ].join(" ")}
      onClick={() => !disabled && inputRef.current?.focus()}
    >
      {keywords.map((kw, i) => (
        <span
          key={`${kw}-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
        >
          {kw}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeKeyword(i);
              }}
              aria-label={removeLabel(kw)}
              className="hover:text-primary/60 transition-colors focus-visible:outline-none"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={keywords.length === 0 ? placeholder : ""}
        className="flex-1 min-w-24 h-6 bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed"
        aria-label={addLabel}
      />
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

/** A titled section divider used to group the Edit form. */
function SectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new Date(raw).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return raw;
  }
}

// ─── View Panel ───────────────────────────────────────────────────────────────

interface ViewPanelProps {
  file: File | null;
  metadata: DocumentMetadata | null;
  xmp: string | null;
  isLoading: boolean;
  error: string | null;
}

function ViewPanel({ file, metadata, xmp, isLoading, error }: ViewPanelProps) {
  const t = useTranslations("editor.metadata");

  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
        <svg
          className="h-8 w-8 opacity-40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        <p className="text-sm">{t("noFile")}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
        <svg
          className="h-6 w-6 animate-spin"
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
        <p className="text-sm">{t("loading")}</p>
      </div>
    );
  }

  if (error) {
    return <ErrorBanner message={error} />;
  }

  if (!metadata) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ReadOnlyField id="view-title" label={t("fields.title")} value={metadata.title} />
        <ReadOnlyField id="view-author" label={t("fields.author")} value={metadata.author} />
        <ReadOnlyField id="view-subject" label={t("fields.subject")} value={metadata.subject} />
        <ReadOnlyField id="view-creator" label={t("fields.creator")} value={metadata.creator} />
        <ReadOnlyField id="view-producer" label={t("fields.producer")} value={metadata.producer} />
        <ReadOnlyField
          id="view-page-count"
          label={t("fields.pageCount")}
          value={String(metadata.pageCount)}
        />
        <ReadOnlyField
          id="view-pdf-version"
          label={t("fields.pdfVersion")}
          value={metadata.pdfVersion}
        />
        <ReadOnlyField
          id="view-encrypted"
          label={t("fields.encrypted")}
          value={metadata.isEncrypted ? t("yes") : t("no")}
        />
        <ReadOnlyField
          id="view-creation-date"
          label={t("fields.creationDate")}
          value={formatDate(metadata.creationDate)}
        />
        <ReadOnlyField
          id="view-modification-date"
          label={t("fields.modificationDate")}
          value={formatDate(metadata.modificationDate)}
        />
      </div>

      <div>
        <label
          htmlFor="view-keywords"
          className="block text-xs font-medium text-muted-foreground mb-1"
        >
          {t("fields.keywords")}
        </label>
        <div
          id="view-keywords"
          className="w-full min-h-9 px-3 py-2 rounded-md border border-input bg-muted/40"
        >
          {metadata.keywords.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {metadata.keywords.map((kw, i) => (
                <span
                  key={`${kw}-${i}`}
                  className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
                >
                  {kw}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground italic">—</span>
          )}
        </div>
      </div>

      <div>
        <label
          htmlFor="view-xmp"
          className="block text-xs font-medium text-muted-foreground mb-1"
        >
          {t("xmp.label")}
        </label>
        {xmp && xmp.trim().length > 0 ? (
          <pre
            id="view-xmp"
            className="w-full max-h-48 overflow-auto px-3 py-2 rounded-md border border-input bg-muted/40 text-xs text-foreground whitespace-pre-wrap break-words"
          >
            {xmp}
          </pre>
        ) : (
          <div
            id="view-xmp"
            className="w-full min-h-9 px-3 py-2 rounded-md border border-input bg-muted/40"
          >
            <span className="text-sm text-muted-foreground italic">
              {t("xmp.none")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Edit Panel ───────────────────────────────────────────────────────────────

interface EditPanelProps {
  file: File | null;
  initialMetadata: DocumentMetadata | null;
  initialXmp: string | null;
}

function EditPanel({ file, initialMetadata, initialXmp }: EditPanelProps) {
  const t = useTranslations("editor.metadata");

  // ── Info fields ──
  const [title, setTitle] = useState(initialMetadata?.title ?? "");
  const [author, setAuthor] = useState(initialMetadata?.author ?? "");
  const [subject, setSubject] = useState(initialMetadata?.subject ?? "");
  const [keywords, setKeywords] = useState<string[]>(
    initialMetadata?.keywords ?? []
  );
  const [creator, setCreator] = useState(initialMetadata?.creator ?? "");

  // ── Display preferences ──
  const [pageLayout, setPageLayout] = useState("");
  const [pageMode, setPageMode] = useState("");
  const [direction, setDirection] = useState("");
  const [viewerBooleans, setViewerBooleans] = useState<
    Record<ViewerBooleanKey, boolean>
  >({
    hideToolbar: false,
    hideMenubar: false,
    hideWindowUI: false,
    fitWindow: false,
    centerWindow: false,
    displayDocTitle: false,
  });

  // ── Advanced XMP ──
  const [xmp, setXmp] = useState(initialXmp ?? "");
  const [xmpDirty, setXmpDirty] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Sync fields when initial data loads (e.g. after the View tab populates it).
  useEffect(() => {
    if (initialMetadata) {
      setTitle(initialMetadata.title ?? "");
      setAuthor(initialMetadata.author ?? "");
      setSubject(initialMetadata.subject ?? "");
      setKeywords(initialMetadata.keywords ?? []);
      setCreator(initialMetadata.creator ?? "");
    }
  }, [initialMetadata]);

  useEffect(() => {
    setXmp(initialXmp ?? "");
    setXmpDirty(false);
  }, [initialXmp]);

  const toggleViewerBoolean = useCallback(
    (key: ViewerBooleanKey, value: boolean) => {
      setViewerBooleans((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!file) {
        setError(t("noFileSelected"));
        return;
      }

      const payload: SetMetadataPayload = {
        metadata: {
          title: title.trim() || null,
          author: author.trim() || null,
          subject: subject.trim() || null,
          keywords,
          creator: creator.trim() || null,
        },
      };

      // Viewer preferences: send only the keys the user explicitly enabled so we
      // never clobber preferences the document already had (the engine leaves
      // omitted keys untouched).
      const viewerPreferences: Record<string, boolean | "L2R" | "R2L"> = {};
      for (const key of VIEWER_BOOLEAN_KEYS) {
        if (viewerBooleans[key]) viewerPreferences[key] = true;
      }
      if (direction === "L2R" || direction === "R2L") {
        viewerPreferences.direction = direction;
      }
      if (Object.keys(viewerPreferences).length > 0) {
        payload.viewerPreferences = viewerPreferences;
      }

      if (pageLayout) payload.pageLayout = pageLayout;
      if (pageMode) payload.pageMode = pageMode;
      // Only push a raw XMP packet when the user actually edited it.
      if (xmpDirty && xmp.trim().length > 0) payload.xmp = xmp;

      setIsSaving(true);
      try {
        const blob = await postMetadataSet(file, payload);
        const filename = file.name.replace(/\.pdf$/i, "") + "_metadata.pdf";
        downloadBlob(blob, filename);
        setSuccess(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : t("updateFailed");
        setError(message);
      } finally {
        setIsSaving(false);
      }
    },
    [
      file,
      title,
      author,
      subject,
      keywords,
      creator,
      viewerBooleans,
      direction,
      pageLayout,
      pageMode,
      xmp,
      xmpDirty,
      t,
    ]
  );

  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
        <svg
          className="h-8 w-8 opacity-40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        <p className="text-sm">{t("noFile")}</p>
      </div>
    );
  }

  const layoutOptions = PAGE_LAYOUT_OPTIONS.map((value) => ({
    value,
    label: t(`layoutOptions.${value}`),
  }));
  const modeOptions = PAGE_MODE_OPTIONS.map((value) => ({
    value,
    label: t(`modeOptions.${value}`),
  }));
  const directionOptions = [
    { value: "L2R", label: t("direction.L2R") },
    { value: "R2L", label: t("direction.R2L") },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── Info fields ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <FieldLabel htmlFor="edit-title">{t("fields.title")}</FieldLabel>
          <TextInput
            id="edit-title"
            value={title}
            onChange={setTitle}
            placeholder={t("placeholders.title")}
            disabled={isSaving}
          />
        </div>

        <div>
          <FieldLabel htmlFor="edit-author">{t("fields.author")}</FieldLabel>
          <TextInput
            id="edit-author"
            value={author}
            onChange={setAuthor}
            placeholder={t("placeholders.author")}
            disabled={isSaving}
          />
        </div>

        <div className="sm:col-span-2">
          <FieldLabel htmlFor="edit-subject">{t("fields.subject")}</FieldLabel>
          <TextInput
            id="edit-subject"
            value={subject}
            onChange={setSubject}
            placeholder={t("placeholders.subject")}
            disabled={isSaving}
          />
        </div>

        <div>
          <FieldLabel htmlFor="edit-creator">{t("fields.creator")}</FieldLabel>
          <TextInput
            id="edit-creator"
            value={creator}
            onChange={setCreator}
            placeholder={t("placeholders.creator")}
            disabled={isSaving}
          />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor="edit-keywords-input">{t("fields.keywords")}</FieldLabel>
        <KeywordsInput
          keywords={keywords}
          onChange={setKeywords}
          placeholder={t("keywords.placeholder")}
          addLabel={t("keywords.addAria")}
          removeLabel={(kw) => t("keywords.removeAria", { keyword: kw })}
          disabled={isSaving}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("keywords.hint")}</p>
      </div>

      {/* ── Display preferences ── */}
      <SectionHeader
        title={t("display.title")}
        description={t("display.description")}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <FieldLabel htmlFor="edit-page-layout">{t("display.pageLayout")}</FieldLabel>
          <SelectField
            id="edit-page-layout"
            value={pageLayout}
            onChange={setPageLayout}
            unchangedLabel={t("display.unchanged")}
            options={layoutOptions}
            disabled={isSaving}
          />
        </div>

        <div>
          <FieldLabel htmlFor="edit-page-mode">{t("display.pageMode")}</FieldLabel>
          <SelectField
            id="edit-page-mode"
            value={pageMode}
            onChange={setPageMode}
            unchangedLabel={t("display.unchanged")}
            options={modeOptions}
            disabled={isSaving}
          />
        </div>

        <div className="sm:col-span-2">
          <FieldLabel htmlFor="edit-direction">{t("display.direction")}</FieldLabel>
          <SelectField
            id="edit-direction"
            value={direction}
            onChange={setDirection}
            unchangedLabel={t("display.unchanged")}
            options={directionOptions}
            disabled={isSaving}
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground mb-1">
          {t("display.viewerOptions")}
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {VIEWER_BOOLEAN_KEYS.map((key) => (
            <CheckboxField
              key={key}
              id={`edit-vp-${key}`}
              label={t(`viewerPrefs.${key}`)}
              checked={viewerBooleans[key]}
              onChange={(checked) => toggleViewerBoolean(key, checked)}
              disabled={isSaving}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("display.viewerHint")}</p>
      </fieldset>

      {/* ── Advanced XMP ── */}
      <SectionHeader title={t("xmp.title")} description={t("xmp.description")} />

      <div>
        <FieldLabel htmlFor="edit-xmp">{t("xmp.fieldLabel")}</FieldLabel>
        <textarea
          id="edit-xmp"
          value={xmp}
          onChange={(e) => {
            setXmp(e.target.value);
            setXmpDirty(true);
          }}
          disabled={isSaving}
          rows={6}
          spellCheck={false}
          placeholder={t("xmp.placeholder")}
          className="w-full px-3 py-2 rounded-md border border-input bg-background font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("xmp.hint")}</p>
      </div>

      <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          {t("readOnlyFields")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ReadOnlyField
            id="edit-creation-date"
            label={t("fields.creationDate")}
            value={formatDate(initialMetadata?.creationDate)}
          />
          <ReadOnlyField
            id="edit-modification-date"
            label={t("fields.modificationDate")}
            value={formatDate(initialMetadata?.modificationDate)}
          />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {success && <SuccessBanner message={t("updateSuccess")} />}

      <SubmitButton loading={isSaving}>
        {isSaving ? t("saving") : t("saveDownload")}
      </SubmitButton>
    </form>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

/**
 * MetadataDialog — modal to view and edit PDF document metadata: the `/Info`
 * fields (title, author, subject, keywords, creator), the catalog display
 * preferences (`/PageLayout`, `/PageMode`, `/ViewerPreferences`) and the raw XMP
 * `/Metadata` packet.
 *
 * Data is loaded automatically on mount when a file is provided. The Edit tab
 * pre-populates from the loaded metadata and produces a downloaded PDF with the
 * updated values.
 */
export function MetadataDialog({
  isOpen,
  onClose,
  currentFile,
}: MetadataDialogProps) {
  const t = useTranslations("editor.metadata");
  const [activeTab, setActiveTab] = useState<TabId>("view");
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null);
  const [xmp, setXmp] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const getMetadata = useGetPdfMetadata();

  // Load metadata whenever the dialog opens with a file
  useEffect(() => {
    if (!isOpen || !currentFile) {
      setMetadata(null);
      setXmp(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;

    setMetadata(null);
    setXmp(null);
    setLoadError(null);

    getMetadata
      .mutateAsync(currentFile)
      .then((result) => {
        if (!cancelled) {
          const r = result as MetadataGetResult;
          setMetadata(r.metadata);
          setXmp(r.xmp ?? null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t("loadFailed");
          setLoadError(message);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentFile]);

  const handleTabChange = useCallback((id: TabId) => {
    setActiveTab(id);
  }, []);

  if (!isOpen) return null;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "view", label: t("tabs.view") },
    { id: "edit", label: t("tabs.edit") },
  ];

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metadata-dialog-title"
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
              id="metadata-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("title")}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
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
              onClick={handleTabChange}
            />
          ))}
        </div>

        {/* Tab content */}
        <div className="px-6 py-6" role="tabpanel">
          {activeTab === "view" && (
            <ViewPanel
              file={currentFile}
              metadata={metadata}
              xmp={xmp}
              isLoading={getMetadata.isPending}
              error={loadError}
            />
          )}
          {activeTab === "edit" && (
            <EditPanel
              file={currentFile}
              initialMetadata={metadata}
              initialXmp={xmp}
            />
          )}
        </div>
      </div>
    </div>
  );
}
