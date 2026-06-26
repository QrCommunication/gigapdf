"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Globe, Link2, Mail, Phone, X } from "lucide-react";

export type InsertLinkValue =
  | { kind: "url"; url: string }
  | { kind: "page"; page: number }
  /** Define a document-level named destination anchored to `targetPage`. */
  | { kind: "namedCreate"; name: string; targetPage: number }
  /** Link the selected text element to an existing named destination. */
  | { kind: "namedLink"; name: string };

/** Hyperlink URI schemes offered as quick-pick chips in the URL field. */
const URL_SCHEMES = [
  { id: "web", prefix: "https://", icon: Globe },
  { id: "email", prefix: "mailto:", icon: Mail },
  { id: "phone", prefix: "tel:", icon: Phone },
] as const;

// Matches any of the known scheme prefixes at the start of a URL.
const KNOWN_SCHEME = /^(https?:\/\/|mailto:|tel:)/i;

/**
 * Swap the leading scheme of `current` for `prefix`, preserving everything
 * after the existing scheme (so toggling Web → Email keeps the typed address).
 */
function applyScheme(current: string, prefix: string): string {
  const rest = current.replace(KNOWN_SCHEME, "");
  return `${prefix}${rest}`;
}

export interface InsertLinkDialogProps {
  open: boolean;
  onClose: () => void;
  /** Whether a single text element is selected (link target). */
  hasTextTarget: boolean;
  /** Total page count, for clamping the in-document page target. */
  pageCount: number;
  /** Pre-fill from the currently selected element's existing link, if any. */
  initialUrl?: string | null;
  initialPage?: number | null;
  /** Known named destinations, offered as a datalist for the "named" mode. */
  existingNamedDests?: string[];
  onApply: (value: InsertLinkValue) => void;
  /** Remove the link from the selected element. */
  onRemove?: () => void;
}

/**
 * Small dialog to attach a hyperlink (external URL or in-document page) to the
 * selected text element. Mirrors the shape of {@link HeadersFootersDialog}: a
 * fixed overlay modal, a radio band to pick the link mode, and apply/remove
 * actions. Persistence happens via the editor's existing element-update path
 * (TextElement carries `linkUrl` / `linkPage`).
 */
export function InsertLinkDialog({
  open,
  onClose,
  hasTextTarget,
  pageCount,
  initialUrl = null,
  initialPage = null,
  existingNamedDests = [],
  onApply,
  onRemove,
}: InsertLinkDialogProps) {
  const t = useTranslations("editor.insert.linkDialog");
  const tl = useTranslations("editor.links");
  const [mode, setMode] = useState<"url" | "page" | "named">("url");
  const [url, setUrl] = useState("");
  const [page, setPage] = useState(1);
  // "named" mode: define a destination, or link selected text to one.
  const [namedAction, setNamedAction] = useState<"create" | "link">("create");
  const [destName, setDestName] = useState("");
  const [destPage, setDestPage] = useState(1);

  // Re-seed the form from the selected element each time the dialog OPENS.
  // Tracking the open transition during render (React-idiomatic reset) rather
  // than an effect avoids a redundant render pass — the values come from props.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setNamedAction("create");
    setDestName("");
    setDestPage(1);
    if (initialPage && initialPage > 0) {
      setMode("page");
      setPage(initialPage);
      setUrl("");
    } else {
      setMode("url");
      setUrl(initialUrl ?? "");
      setPage(1);
    }
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  if (!open) return null;

  const hasExistingLink = Boolean(initialUrl) || Boolean(initialPage);
  const urlValid = /^(https?:\/\/|mailto:|tel:)/i.test(url.trim());
  const pageValid = Number.isFinite(page) && page >= 1 && page <= pageCount;
  const destNameValid = destName.trim().length > 0;
  const destPageValid =
    Number.isFinite(destPage) && destPage >= 1 && destPage <= pageCount;
  // Creating a destination is document-level (no text target needed); every
  // other mode acts on the selected text element.
  const canApply =
    mode === "url"
      ? hasTextTarget && urlValid
      : mode === "page"
        ? hasTextTarget && pageValid
        : namedAction === "create"
          ? destNameValid && destPageValid
          : hasTextTarget && destNameValid;

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canApply) return;
    if (mode === "url") {
      onApply({ kind: "url", url: url.trim() });
    } else if (mode === "page") {
      onApply({ kind: "page", page });
    } else if (namedAction === "create") {
      onApply({ kind: "namedCreate", name: destName.trim(), targetPage: destPage });
    } else {
      onApply({ kind: "namedLink", name: destName.trim() });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insert-link-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <Link2 size={18} className="text-muted-foreground" />
            <h2
              id="insert-link-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleApply} className="px-6 pb-6 pt-2 space-y-4">
          {!hasTextTarget && !(mode === "named" && namedAction === "create") ? (
            <p className="text-sm text-muted-foreground">{t("noTarget")}</p>
          ) : null}

          {/* Mode switch: external URL vs in-document page */}
          <fieldset>
            <legend className="block text-sm font-medium text-foreground mb-1">
              {t("modeLabel")}
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {(["url", "page", "named"] as const).map((m) => (
                <label
                  key={m}
                  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors text-sm ${
                    mode === m
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-input text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="insert-link-mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    className="sr-only"
                  />
                  {m === "url"
                    ? t("modeUrl")
                    : m === "page"
                      ? t("modePage")
                      : t("modeNamed")}
                </label>
              ))}
            </div>
          </fieldset>

          {mode === "url" ? (
            <div>
              <label
                htmlFor="insert-link-url"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t("urlLabel")}
              </label>
              <div
                className="flex flex-wrap gap-1.5 mb-2"
                role="group"
                aria-label={tl("schemeLabel")}
              >
                {URL_SCHEMES.map(({ id, prefix, icon: Icon }) => {
                  const active = url.trim().toLowerCase().startsWith(prefix);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setUrl((prev) => applyScheme(prev, prefix))}
                      aria-pressed={active}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors ${
                        active
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-input text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon size={13} />
                      {tl(`scheme_${id}`)}
                    </button>
                  );
                })}
              </div>
              <input
                id="insert-link-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("urlPlaceholder")}
                inputMode="url"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {url.trim() && !urlValid ? (
                <p className="mt-1 text-xs text-destructive">{t("urlInvalid")}</p>
              ) : null}
            </div>
          ) : mode === "page" ? (
            <div>
              <label
                htmlFor="insert-link-page"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t("pageLabel", { count: pageCount })}
              </label>
              <input
                id="insert-link-page"
                type="number"
                min={1}
                max={pageCount}
                value={page}
                onChange={(e) =>
                  setPage(
                    Math.min(
                      pageCount,
                      Math.max(1, Number(e.target.value) || 1),
                    ),
                  )
                }
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Named destinations: define one, or link selected text to one. */}
              <fieldset>
                <legend className="block text-sm font-medium text-foreground mb-1">
                  {t("namedActionLabel")}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {(["create", "link"] as const).map((a) => (
                    <label
                      key={a}
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors text-sm ${
                        namedAction === a
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-input text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <input
                        type="radio"
                        name="insert-link-named-action"
                        value={a}
                        checked={namedAction === a}
                        onChange={() => setNamedAction(a)}
                        className="sr-only"
                      />
                      {a === "create" ? t("namedCreate") : t("namedLink")}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label
                  htmlFor="insert-link-dest-name"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("nameLabel")}
                </label>
                <input
                  id="insert-link-dest-name"
                  list="insert-link-named-dests"
                  value={destName}
                  onChange={(e) => setDestName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {existingNamedDests.length > 0 ? (
                  <datalist id="insert-link-named-dests">
                    {existingNamedDests.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                ) : null}
              </div>

              {namedAction === "create" ? (
                <div>
                  <label
                    htmlFor="insert-link-dest-page"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    {t("namedTargetPageLabel", { count: pageCount })}
                  </label>
                  <input
                    id="insert-link-dest-page"
                    type="number"
                    min={1}
                    max={pageCount}
                    value={destPage}
                    onChange={(e) =>
                      setDestPage(
                        Math.min(pageCount, Math.max(1, Number(e.target.value) || 1)),
                      )
                    }
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {hasTextTarget ? t("namedLinkHint") : t("noTarget")}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            {hasExistingLink && onRemove && mode !== "named" ? (
              <button
                type="button"
                onClick={() => {
                  onRemove();
                }}
                className="px-4 py-2 text-sm rounded-md border border-input text-destructive hover:bg-destructive/10"
              >
                {t("remove")}
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md border border-input hover:bg-muted"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={!canApply}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t("apply")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
