"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@giga-pdf/ui";
import { FileText } from "lucide-react";
import { getAuthToken, type SemanticSearchResult } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";

interface SemanticResultCardProps {
  result: SemanticSearchResult;
}

interface PreviewState {
  url: string;
  imageWidth: number;
  imageHeight: number;
  /** Highlight rect in image pixels, if the backend mapped the bbox. */
  highlight: { left: number; top: number; width: number; height: number } | null;
}

/**
 * One semantic-search hit: renders the matching page as a large thumbnail with
 * the matched bbox highlighted, plus the snippet, score and a click-through to
 * the editor at that page.
 *
 * The page image + the bbox→pixel mapping are produced server-side by
 * POST /api/pdf/document-page-image (rotation-aware), so this component only
 * scales the returned rect into the rendered <img> via percentages.
 */
export function SemanticResultCard({ result }: SemanticResultCardProps) {
  const t = useTranslations("semanticSearch");
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [failed, setFailed] = useState(false);
  // Track the created object URL so we revoke it on unmount / result change.
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
            bbox: result.bbox,
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
        const bw = Number(res.headers.get("X-Bbox-Width"));
        const highlight =
          Number.isFinite(bw) && bw > 0
            ? {
                left: Number(res.headers.get("X-Bbox-Left")) || 0,
                top: Number(res.headers.get("X-Bbox-Top")) || 0,
                width: bw,
                height: Number(res.headers.get("X-Bbox-Height")) || 0,
              }
            : null;

        setPreview({ url, imageWidth, imageHeight, highlight });
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
  }, [result.document_id, result.page, result.bbox]);

  const openInEditor = () => {
    router.push(`/editor/${result.document_id}?page=${result.page}`);
  };

  const percent = Math.round(Math.min(Math.max(result.score, 0), 1) * 100);

  // Highlight rect as percentages of the rendered image so it scales with the
  // responsive <img> (object-contain keeps the aspect ratio intact).
  const highlightStyle =
    preview?.highlight && preview.imageWidth > 0 && preview.imageHeight > 0
      ? {
          left: `${(preview.highlight.left / preview.imageWidth) * 100}%`,
          top: `${(preview.highlight.top / preview.imageHeight) * 100}%`,
          width: `${(preview.highlight.width / preview.imageWidth) * 100}%`,
          height: `${(preview.highlight.height / preview.imageHeight) * 100}%`,
        }
      : null;

  return (
    <button
      type="button"
      onClick={openInEditor}
      className="group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("openInEditor")}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted/40">
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.url}
              alt={result.document_name}
              loading="lazy"
              className="h-full w-full object-contain object-top"
            />
            {highlightStyle && (
              <div
                aria-hidden
                className="pointer-events-none absolute rounded-sm bg-yellow-300/30 ring-2 ring-yellow-400"
                style={highlightStyle}
              />
            )}
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
      </div>

      <div className="flex flex-col gap-1 p-3">
        <p className="truncate text-sm font-medium" title={result.document_name}>
          {result.document_name}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("page", { page: result.page })}
        </p>
        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
          {result.snippet}
        </p>
      </div>
    </button>
  );
}
