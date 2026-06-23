"use client";

import { useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import type { DocumentLanguageInfo } from "@giga-pdf/types";

interface DocumentLanguageBadgeProps {
  /** Detected language info from the parse (read-only). Renders nothing when absent. */
  documentLanguage?: DocumentLanguageInfo;
  className?: string;
}

/** Translation key for a detected script string (falls back to "other"). */
const SCRIPT_KEY: Record<string, string> = {
  latin: "scriptLatin",
  cyrillic: "scriptCyrillic",
  arabic: "scriptArabic",
  hebrew: "scriptHebrew",
  greek: "scriptGreek",
  cjk: "scriptCjk",
};

/**
 * Read-only badge surfacing the document's detected dominant script + reading
 * direction (and ISO-639-1 code when available). Mounted at the top of the
 * document-info sidebar. Renders nothing when detection was undecidable so the
 * sidebar stays uncluttered for plain documents.
 */
export function DocumentLanguageBadge({
  documentLanguage,
  className,
}: DocumentLanguageBadgeProps) {
  const t = useTranslations("editor.language");
  if (!documentLanguage) return null;

  const { direction, script, lang } = documentLanguage;
  const scriptLabel = t(SCRIPT_KEY[script] ?? "scriptOther");
  const directionLabel =
    direction === "rtl"
      ? t("directionRtl")
      : direction === "neutral"
        ? t("directionNeutral")
        : t("directionLtr");

  return (
    <div
      className={`flex items-center gap-2 border-b px-3 py-2 text-xs ${className ?? ""}`}
      title={t("tooltip")}
    >
      <Languages className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium text-muted-foreground">{t("title")}</span>
      <span className="flex flex-wrap items-center gap-1">
        <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
          {scriptLabel}
        </span>
        {lang ? (
          <span className="rounded bg-muted px-1.5 py-0.5 uppercase text-foreground">
            {lang}
          </span>
        ) : null}
        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
          {directionLabel}
        </span>
      </span>
    </div>
  );
}
