"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@giga-pdf/ui";
import { FileText } from "lucide-react";
import { getAuthToken, type SemanticSearchResult } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";

/**
 * One card = one document PAGE, carrying every hit on it. The search page
 * collapses the per-line results into this shape so the same page is never
 * shown twice; the card then highlights ALL of the page's matched boxes.
 */
export interface GroupedSemanticResult {
  document_id: string;
  document_name: string;
  page: number;
  /** Best (max) similarity among the page's hits. */
  score: number;
  /** Every matched box on the page (PDF user-space points). */
  bboxes: SemanticSearchResult["bbox"][];
  /** A few matched snippets, for the text preview. */
  snippets: string[];
}

interface SemanticResultCardProps {
  result: GroupedSemanticResult;
  /** The searched query, used to highlight matching terms in the snippet. */
  query?: string;
}

/** A highlight rectangle in rendered-image pixels. */
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PreviewState {
  url: string;
  imageWidth: number;
  imageHeight: number;
  /** All highlight rects the backend mapped from the page's bboxes. */
  highlights: Rect[];
}

/**
 * Wrap occurrences of the query terms in the snippet with <mark>. Semantic
 * search matches by meaning, so the exact words may not appear — we highlight
 * what is present (case-insensitive, terms of ≥ 2 chars).
 */
function highlightTerms(text: string, query: string | undefined): ReactNode {
  const terms = Array.from(
    new Set(
      (query ?? "")
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  );
  if (terms.length === 0) return text;

  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark
        key={index}
        className="rounded bg-yellow-200 px-0.5 font-medium text-foreground dark:bg-yellow-500/40"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/**
 * One grouped semantic-search hit: renders the matching page as a large
 * thumbnail with EVERY matched box highlighted, plus the snippet, score and a
 * click-through to the editor at that page.
 *
 * The page image + the bbox→pixel mapping are produced server-side by
 * POST /api/pdf/document-page-image (rotation-aware); this component only scales
 * the returned rects into the rendered <img> via percentages.
 */
export function SemanticResultCard({ result, query }: SemanticResultCardProps) {
  const t = useTranslations("semanticSearch");
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [failed, setFailed] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const revoke = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    void (async () => {
      try {
        const token = await getAuthToken();
        const res = await fetch("/api/pdf/document-page-image", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            storedDocumentId: result.document_id,
            page: result.page,
            scale: 1.5,
            bboxes: result.bboxes,
          }),
        });
        if (!res.ok) throw new Error(`preview returned ${res.status}`);

        const blob = await res.blob();
        if (cancelled) return;
        revoke();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;

        const imageWidth = Number(res.headers.get("X-Image-Width")) || 0;
        const imageHeight = Number(res.headers.get("X-Image-Height")) || 0;
        let highlights: Rect[] = [];
        const rectsHeader = res.headers.get("X-Bbox-Rects");
        if (rectsHeader) {
          try {
            const parsed = JSON.parse(rectsHeader) as Rect[];
            if (Array.isArray(parsed)) highlights = parsed;
          } catch {
            /* ignore malformed header — just render the page without rects */
          }
        }

        setPreview({ url, imageWidth, imageHeight, highlights });
      } catch (err) {
        if (cancelled) return;
        clientLogger.warn("[search] page preview failed:", err);
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      revoke();
    };
    // The bbox set is stable per (document, page); re-fetch when either changes.
  }, [result.document_id, result.page, result.bboxes.length]);

  const openInEditor = () => {
    router.push(`/editor/${result.document_id}?page=${result.page}`);
  };

  const percent = Math.round(Math.min(Math.max(result.score, 0), 1) * 100);

  // Rects as percentages of the rendered image so they scale with the
  // responsive <img> (object-contain keeps the aspect ratio intact).
  const highlightStyles =
    preview && preview.imageWidth > 0 && preview.imageHeight > 0
      ? preview.highlights.map((rect) => ({
          left: `${(rect.left / preview.imageWidth) * 100}%`,
          top: `${(rect.top / preview.imageHeight) * 100}%`,
          width: `${(rect.width / preview.imageWidth) * 100}%`,
          height: `${(rect.height / preview.imageHeight) * 100}%`,
        }))
      : [];

  const snippet = result.snippets.join("  …  ");

  return (
    <button
      type="button"
      onClick={openInEditor}
      className="group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("openInEditor")}
    >
      <div
        className="relative w-full overflow-hidden bg-muted/40"
        style={{
          aspectRatio:
            preview && preview.imageWidth > 0 && preview.imageHeight > 0
              ? `${preview.imageWidth} / ${preview.imageHeight}`
              : "3 / 4",
        }}
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.url}
              alt={result.document_name}
              loading="lazy"
              className="h-full w-full object-contain object-top"
            />
            {highlightStyles.map((style, index) => (
              <div
                key={index}
                aria-hidden
                className="pointer-events-none absolute rounded-sm bg-yellow-300/30 ring-2 ring-yellow-400"
                style={style}
              />
            ))}
          </>
        ) : failed ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileText size={32} aria-hidden />
            <span className="text-xs">{t("previewFailed")}</span>
          </div>
        ) : (
          <div className="h-full w-full animate-pulse bg-muted" />
        )}
        <Badge
          variant="secondary"
          className="absolute right-2 top-2 bg-background/90"
        >
          {t("scoreLabel", { percent })}
        </Badge>
        {result.bboxes.length > 1 && (
          <Badge
            variant="secondary"
            className="absolute left-2 top-2 bg-background/90"
          >
            {t("matchCount", { count: result.bboxes.length })}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1 p-3">
        <p className="truncate text-sm font-medium" title={result.document_name}>
          {result.document_name}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("page", { page: result.page })}
        </p>
        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
          {highlightTerms(snippet, query)}
        </p>
      </div>
    </button>
  );
}
