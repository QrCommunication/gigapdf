"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  useGetPdfMetadata,
  useSetPdfMetadata,
  downloadBlob,
} from "@giga-pdf/api";
import type { DocumentMetadata } from "@giga-pdf/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "view" | "edit";

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

interface KeywordsInputProps {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  disabled?: boolean;
}

function KeywordsInput({ keywords, onChange, disabled }: KeywordsInputProps) {
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
              aria-label={`Remove keyword "${kw}"`}
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
        placeholder={
          keywords.length === 0 ? "Type and press Enter or comma…" : ""
        }
        className="flex-1 min-w-24 h-6 bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed"
        aria-label="Add keyword"
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
  isLoading: boolean;
  error: string | null;
}

function ViewPanel({ file, metadata, isLoading, error }: ViewPanelProps) {
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
        <p className="text-sm">No file selected</p>
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
        <p className="text-sm">Loading metadata…</p>
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
        <ReadOnlyField id="view-title" label="Title" value={metadata.title} />
        <ReadOnlyField id="view-author" label="Author" value={metadata.author} />
        <ReadOnlyField id="view-subject" label="Subject" value={metadata.subject} />
        <ReadOnlyField id="view-creator" label="Creator" value={metadata.creator} />
        <ReadOnlyField id="view-producer" label="Producer" value={metadata.producer} />
        <ReadOnlyField
          id="view-page-count"
          label="Page count"
          value={String(metadata.pageCount)}
        />
        <ReadOnlyField
          id="view-pdf-version"
          label="PDF version"
          value={metadata.pdfVersion}
        />
        <ReadOnlyField
          id="view-encrypted"
          label="Encrypted"
          value={metadata.isEncrypted ? "Yes" : "No"}
        />
        <ReadOnlyField
          id="view-creation-date"
          label="Creation date"
          value={formatDate(metadata.creationDate)}
        />
        <ReadOnlyField
          id="view-modification-date"
          label="Modification date"
          value={formatDate(metadata.modificationDate)}
        />
      </div>

      <div>
        <label
          htmlFor="view-keywords"
          className="block text-xs font-medium text-muted-foreground mb-1"
        >
          Keywords
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
    </div>
  );
}

// ─── Edit Panel ───────────────────────────────────────────────────────────────

interface EditPanelProps {
  file: File | null;
  initialMetadata: DocumentMetadata | null;
}

function EditPanel({ file, initialMetadata }: EditPanelProps) {
  const [title, setTitle] = useState(initialMetadata?.title ?? "");
  const [author, setAuthor] = useState(initialMetadata?.author ?? "");
  const [subject, setSubject] = useState(initialMetadata?.subject ?? "");
  const [keywords, setKeywords] = useState<string[]>(
    initialMetadata?.keywords ?? []
  );
  const [creator, setCreator] = useState(initialMetadata?.creator ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Sync fields when initialMetadata loads (e.g. after view tab populates data)
  useEffect(() => {
    if (initialMetadata) {
      setTitle(initialMetadata.title ?? "");
      setAuthor(initialMetadata.author ?? "");
      setSubject(initialMetadata.subject ?? "");
      setKeywords(initialMetadata.keywords ?? []);
      setCreator(initialMetadata.creator ?? "");
    }
  }, [initialMetadata]);

  const setMetadata = useSetPdfMetadata();

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!file) {
        setError("No file selected.");
        return;
      }

      const patch: Partial<DocumentMetadata> = {
        title: title.trim() || null,
        author: author.trim() || null,
        subject: subject.trim() || null,
        keywords,
        creator: creator.trim() || null,
      };

      try {
        const blob = await setMetadata.mutateAsync({ file, metadata: patch });
        const filename =
          file.name.replace(/\.pdf$/i, "") + "_metadata.pdf";
        downloadBlob(blob, filename);
        setSuccess(true);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update metadata.";
        setError(message);
      }
    },
    [file, title, author, subject, keywords, creator, setMetadata]
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
        <p className="text-sm">No file selected</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <FieldLabel htmlFor="edit-title">Title</FieldLabel>
          <TextInput
            id="edit-title"
            value={title}
            onChange={setTitle}
            placeholder="Document title"
            disabled={setMetadata.isPending}
          />
        </div>

        <div>
          <FieldLabel htmlFor="edit-author">Author</FieldLabel>
          <TextInput
            id="edit-author"
            value={author}
            onChange={setAuthor}
            placeholder="Author name"
            disabled={setMetadata.isPending}
          />
        </div>

        <div className="sm:col-span-2">
          <FieldLabel htmlFor="edit-subject">Subject</FieldLabel>
          <TextInput
            id="edit-subject"
            value={subject}
            onChange={setSubject}
            placeholder="Document subject"
            disabled={setMetadata.isPending}
          />
        </div>

        <div>
          <FieldLabel htmlFor="edit-creator">Creator</FieldLabel>
          <TextInput
            id="edit-creator"
            value={creator}
            onChange={setCreator}
            placeholder="Application that created the PDF"
            disabled={setMetadata.isPending}
          />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor="edit-keywords-input">Keywords</FieldLabel>
        <KeywordsInput
          keywords={keywords}
          onChange={setKeywords}
          disabled={setMetadata.isPending}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Press Enter or comma to add. Backspace to remove the last tag.
        </p>
      </div>

      <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Read-only fields
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ReadOnlyField
            id="edit-creation-date"
            label="Creation date"
            value={formatDate(initialMetadata?.creationDate)}
          />
          <ReadOnlyField
            id="edit-modification-date"
            label="Modification date"
            value={formatDate(initialMetadata?.modificationDate)}
          />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {success && (
        <SuccessBanner message="Metadata updated successfully. Download started." />
      )}

      <SubmitButton loading={setMetadata.isPending}>
        {setMetadata.isPending ? "Saving…" : "Save & download"}
      </SubmitButton>
    </form>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "view", label: "View" },
  { id: "edit", label: "Edit" },
];

/**
 * MetadataDialog — modal to view and edit PDF document metadata (title, author,
 * subject, keywords, creator, producer, creation/modification dates).
 *
 * Metadata is loaded automatically on mount when a file is provided. The Edit
 * tab pre-populates its form from the loaded metadata and produces a downloaded
 * PDF with the updated values.
 */
export function MetadataDialog({
  isOpen,
  onClose,
  currentFile,
}: MetadataDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>("view");
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const getMetadata = useGetPdfMetadata();

  // Load metadata whenever the dialog opens with a file
  useEffect(() => {
    if (!isOpen || !currentFile) {
      setMetadata(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;

    setMetadata(null);
    setLoadError(null);

    getMetadata
      .mutateAsync(currentFile)
      .then((result) => {
        if (!cancelled) {
          setMetadata(result.metadata);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to load metadata.";
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
              PDF Metadata
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              View or edit document properties such as title, author, and
              keywords.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
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
          aria-label="Metadata options"
        >
          {TABS.map(({ id, label }) => (
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
              isLoading={getMetadata.isPending}
              error={loadError}
            />
          )}
          {activeTab === "edit" && (
            <EditPanel file={currentFile} initialMetadata={metadata} />
          )}
        </div>
      </div>
    </div>
  );
}
