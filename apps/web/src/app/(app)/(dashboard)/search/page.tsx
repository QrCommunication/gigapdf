"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input } from "@giga-pdf/ui";
import { Search, ScanSearch, Loader2 } from "lucide-react";
import { api, type SemanticSearchResult } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";
import {
  SemanticResultCard,
  type GroupedSemanticResult,
} from "@/components/search/semantic-result-card";

type SearchStatus = "idle" | "loading" | "done" | "error" | "unavailable";

// Fetch more blocks than we display: many blocks collapse into one card per
// (document, page) after grouping, so we over-fetch to keep enough cards.
const RESULT_LIMIT = 60;

/**
 * Collapse per-line results into ONE entry per (document, PAGE). A document that
 * matches on several pages yields several cards (one per page — wanted), but each
 * page appears exactly ONCE, with all of its hits condensed (boxes + snippets +
 * a match count), never repeated. Best score first.
 */
function groupResultsByPage(results: SemanticSearchResult[]): GroupedSemanticResult[] {
  const groups = new Map<string, GroupedSemanticResult>();
  for (const r of results) {
    const key = `${r.document_id}#${r.page}`;
    const hasBox = !!r.bbox && (r.bbox.w > 0 || r.bbox.h > 0);
    const existing = groups.get(key);
    if (existing) {
      if (r.score > existing.score) existing.score = r.score;
      if (hasBox) existing.bboxes.push(r.bbox);
      if (r.snippet && existing.snippets.length < 3) existing.snippets.push(r.snippet);
      existing.matchTotal += 1;
    } else {
      groups.set(key, {
        document_id: r.document_id,
        document_name: r.document_name,
        page: r.page,
        score: r.score,
        bboxes: hasBox ? [r.bbox] : [],
        snippets: r.snippet ? [r.snippet] : [],
        matchTotal: 1,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.score - a.score);
}

// useSearchParams() exige une frontière <Suspense> côté Next 16 (la page se
// suspend tant que les search params client ne sont pas résolus).
export default function SemanticSearchPage() {
  return (
    <Suspense fallback={null}>
      <SemanticSearchView />
    </Suspense>
  );
}

function SemanticSearchView() {
  const t = useTranslations("semanticSearch");
  const searchParams = useSearchParams();
  // Query d'amorçage depuis l'URL (?q=…), p.ex. depuis la Command Palette.
  const initialQuery = searchParams?.get("q") ?? "";

  // Initialisation paresseuse : pré-remplit l'input avec la query de l'URL.
  const [query, setQuery] = useState(() => initialQuery);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [results, setResults] = useState<SemanticSearchResult[]>([]);
  // The query that produced `results` — used to highlight matching terms in the
  // result snippets (kept separate from the live input the user may keep typing).
  const [submittedQuery, setSubmittedQuery] = useState("");

  // Appel async pur : seule source de l'effet de bord réseau, partagée par le
  // submit manuel ET l'amorçage par ?q=. Ne dérive aucun state — il ne fait que
  // DÉCLENCHER la requête.
  const executeSearch = useCallback(async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (trimmed.length === 0) return;

    setSubmittedQuery(trimmed);
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
  }, []);

  // Déclenche la recherche UNE fois par valeur de ?q= (dépendance = q seul).
  // Pas de boucle : l'effet n'écrit pas dans `query`/searchParams, il ne fait
  // qu'appeler l'async. Modifier l'input ensuite n'altère pas `q`.
  useEffect(() => {
    if (initialQuery.trim().length === 0) return;
    void executeSearch(initialQuery);
  }, [initialQuery, executeSearch]);

  const runSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await executeSearch(query);
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

      <SearchBody status={status} results={results} query={submittedQuery} />
    </div>
  );
}

function SearchBody({
  status,
  results,
  query,
}: {
  status: SearchStatus;
  results: SemanticSearchResult[];
  query: string;
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

  // One card per (document, page): several pages of a document each get their
  // own card (wanted), but a given page is shown once with all its hits merged.
  const grouped = groupResultsByPage(results);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("resultsCount", { count: grouped.length })}
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {grouped.map((result) => (
          <SemanticResultCard
            key={`${result.document_id}-${result.page}`}
            result={result}
            query={query}
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
