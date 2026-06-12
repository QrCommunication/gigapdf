"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Input } from "@giga-pdf/ui";
import { X } from "lucide-react";
import { storageKeys } from "@giga-pdf/api";
import { cn } from "@/lib/utils";

/** Hard limit enforced by the backend (PATCH /storage/documents tags). */
export const MAX_TAGS = 20;

/**
 * Query key for the user's distinct tag list
 * (GET /api/v1/storage/documents/tags). Scoped under the documents prefix
 * so any documents() invalidation refreshes it too — tags derive from
 * document metadata.
 */
export const userTagsQueryKey = [...storageKeys.documents(), "tags"] as const;

/**
 * Normalize a raw tag the same way the backend does (lowercase + trim) so
 * the chips shown locally match what the API will persist.
 */
function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase();
}

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Existing user tags offered as autocomplete suggestions. */
  suggestions?: string[];
  disabled?: boolean;
  maxTags?: number;
  autoFocus?: boolean;
}

/**
 * Chip-based tag editor: Enter or comma adds the current input, Backspace
 * on an empty input removes the last chip, suggestions (filtered on the
 * current input, minus already-selected tags) are clickable.
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  disabled = false,
  maxTags = MAX_TAGS,
  autoFocus = false,
}: TagInputProps) {
  const t = useTranslations("documents.tags");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);

  const limitReached = value.length >= maxTags;

  const visibleSuggestions = useMemo(() => {
    const query = normalizeTag(draft);
    const selected = new Set(value);
    return suggestions
      .filter((tag) => !selected.has(tag))
      .filter((tag) => (query ? tag.includes(query) : true))
      .slice(0, 8);
  }, [draft, suggestions, value]);

  const addTag = (raw: string) => {
    const tag = normalizeTag(raw).slice(0, 50);
    if (!tag || disabled) return;
    if (value.includes(tag)) {
      setDraft("");
      return;
    }
    if (value.length >= maxTags) return;
    onChange([...value, tag]);
    setDraft("");
  };

  const removeTag = (tag: string) => {
    if (disabled) return;
    onChange(value.filter((existing) => existing !== tag));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && value.length > 0) {
      event.preventDefault();
      const last = value[value.length - 1];
      if (last !== undefined) removeTag(last);
    }
  };

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-md border bg-background p-2",
          focused && "ring-2 ring-ring ring-offset-2",
          disabled && "opacity-60"
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            <span className="max-w-[140px] truncate">{tag}</span>
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-muted-foreground/20"
              onClick={(event) => {
                event.stopPropagation();
                removeTag(tag);
              }}
              disabled={disabled}
              aria-label={t("remove", { tag })}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          ref={inputRef}
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            // Commit whatever is typed when leaving the field — a half-typed
            // tag silently lost on blur is the #1 chip-input frustration.
            if (draft.trim()) addTag(draft);
          }}
          placeholder={limitReached ? undefined : t("inputPlaceholder")}
          disabled={disabled || limitReached}
          autoFocus={autoFocus}
          aria-label={t("label")}
          className="h-7 min-w-[120px] flex-1 border-0 p-0 shadow-none focus-visible:ring-0"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {limitReached ? t("maxReached", { max: maxTags }) : t("addHint", { max: maxTags })}
      </p>

      {visibleSuggestions.length > 0 && !limitReached && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {t("suggestions")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {visibleSuggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                // preventDefault on mousedown: otherwise the input blur fires
                // first and commits the half-typed draft as a second tag.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(tag)}
                disabled={disabled}
                className="rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface TagChipsProps {
  tags: string[];
  /** Number of chips displayed before collapsing into a "+N" counter. */
  max?: number;
  className?: string;
}

/**
 * Compact read-only chip list for cards: shows at most `max` tags plus a
 * "+N" counter for the rest. Renders nothing when the list is empty.
 */
export function TagChips({ tags, max = 3, className }: TagChipsProps) {
  const t = useTranslations("documents.tags");
  if (tags.length === 0) return null;

  const visible = tags.slice(0, max);
  const hidden = tags.length - visible.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {visible.map((tag) => (
        <Badge key={tag} variant="secondary" className="max-w-[110px] px-1.5 py-0 text-[11px] font-normal">
          <span className="truncate">{tag}</span>
        </Badge>
      ))}
      {hidden > 0 && (
        <Badge
          variant="outline"
          className="px-1.5 py-0 text-[11px] font-normal"
          title={tags.slice(max).join(", ")}
        >
          {t("moreCount", { count: hidden })}
        </Badge>
      )}
    </div>
  );
}
