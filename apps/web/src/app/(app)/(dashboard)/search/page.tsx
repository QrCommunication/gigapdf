"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Input } from "@giga-pdf/ui";
import { Search, ScanSearch, Loader2 } from "lucide-react";
import { api, type SemanticSearchResult } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";
import { SemanticResultCard } from "@/components/search/semantic-result-card";

type SearchStatus = "idle" | "loading" | "done" | "error" | "unavailable";

const RESULT_LIMIT = 24;

export default function SemanticSearchPage() {
  const t = useTranslations("semanticSearch");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [results, setResults] = useState<SemanticSearchResult[]>([]);

  const runSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) return;

    setStatus("loading");
    try {
      const response = await api.semanticSearch(trimmed, RESULT_LIMIT);
      if (!response.semantic_search_available) {
        setResults([]);
        setStatus("unavailable");
        return;
      }
      setResults(response.results);
      setStatus("done");
    } catch (err) {
      clientLogger.error("[search] semantic search failed:", err);
      setResults([]);
      setStatus("error");
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      <form onSubmit={runSearch} className="flex max-w-2xl gap-2">
        <div className="relative flex-1">
          <Search
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("placeholder")}
            className="pl-9"
            aria-label={t("placeholder")}
          />
        </div>
        <Button type="submit" disabled={status === "loading" || query.trim().length === 0}>
          {status === "loading" ? (
            <>
              <Loader2 size={16} className="mr-2 animate-spin" aria-hidden />
              {t("searching")}
            </>
          ) : (
            t("searchButton")
          )}
        </Button>
      </form>

      <SearchBody status={status} results={results} />
    </div>
  );
}

function SearchBody({
  status,
  results,
}: {
  status: SearchStatus;
  results: SemanticSearchResult[];
}) {
  const t = useTranslations("semanticSearch");

  if (status === "loading") {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[3/4] w-full animate-pulse rounded-lg border bg-muted"
          />
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <EmptyState
        icon={<ScanSearch size={40} aria-hidden />}
        title={t("errorTitle")}
        description={t("errorDescription")}
      />
    );
  }

  if (status === "unavailable") {
    return (
      <EmptyState
        icon={<ScanSearch size={40} aria-hidden />}
        title={t("unavailableTitle")}
        description={t("unavailableDescription")}
      />
    );
  }

  if (status === "idle") {
    return (
      <EmptyState
        icon={<Search size={40} aria-hidden />}
        title={t("idleTitle")}
        description={t("idleDescription")}
      />
    );
  }

  if (results.length === 0) {
    return (
      <EmptyState
        icon={<Search size={40} aria-hidden />}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("resultsCount", { count: results.length })}
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {results.map((result) => (
          <SemanticResultCard
            key={`${result.document_id}-${result.page}-${result.snippet.slice(0, 16)}`}
            result={result}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <div className="space-y-1">
        <p className="text-lg font-medium">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
