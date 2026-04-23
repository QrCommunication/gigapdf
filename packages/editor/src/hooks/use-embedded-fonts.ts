/**
 * useEmbeddedFonts — load PDF embedded fonts via FontFace API with IndexedDB cache.
 *
 * Usage:
 *   const { fonts, isLoading, getFontFaceName } = useEmbeddedFonts({ documentId });
 *
 * Behaviour:
 *  1. Fetches font metadata list from /api/pdf/fonts/:documentId
 *  2. For each embedded font: checks IndexedDB cache → downloads if absent
 *  3. Registers each font via document.fonts.add(new FontFace(...))
 *  4. On unmount: removes registered FontFace instances (prevents leaks)
 *  5. Loads all fonts in parallel (Promise.allSettled)
 *  6. Respects the NEXT_PUBLIC_FONT_DYNAMIC_LOAD feature flag
 *
 * React 19.2: the React Compiler handles memoization automatically.
 * Manual useMemo/useCallback are kept only where they capture stale closure refs.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { logger } from '@giga-pdf/logger';
import { defaultFontCache, type FontCache } from '../utils/font-cache';

// ─── Type augmentation ────────────────────────────────────────────────────────
// TypeScript 5.9 lib.dom.d.ts does not yet expose FontFaceSet.add/delete
// even though all modern browsers implement them (WHATWG FontFaceSet extends Set).
// We cast via this interface to keep the code typesafe while avoiding `as any`.
interface FontFaceSetWithMutation extends FontFaceSet {
  add(font: FontFace): FontFaceSetWithMutation;
  delete(font: FontFace): boolean;
}
function getFontSet(): FontFaceSetWithMutation {
  return document.fonts as unknown as FontFaceSetWithMutation;
}

// ─── Feature Flag ─────────────────────────────────────────────────────────────

function isFontDynamicLoadEnabled(): boolean {
  if (typeof process === 'undefined') return false;
  return process.env['NEXT_PUBLIC_FONT_DYNAMIC_LOAD'] === 'true';
}

// ─── Embedded types ──────────────────────────────────────────────────────────
// These mirror @giga-pdf/api's ExtractedFontMetadata / FontData.
// They live here to avoid a circular package dependency
// (@giga-pdf/editor must not depend on @giga-pdf/api).

export interface ExtractedFontMetadata {
  fontId: string;
  originalName: string;
  postscriptName: string | null;
  fontFamily: string | null;
  subtype: string;
  isEmbedded: boolean;
  isSubset: boolean;
  format: 'ttf' | 'otf' | 'cff' | null;
  sizeBytes: number | null;
}

// ─── Public Types ─────────────────────────────────────────────────────────────

export type FontLoadStatus = 'pending' | 'loading' | 'loaded' | 'failed';

export interface LoadedFont {
  metadata: ExtractedFontMetadata;
  /** Unique CSS font-family name registered via FontFace API, scoped per document */
  fontFaceName: string;
  status: FontLoadStatus;
  error?: string;
}

export interface UseEmbeddedFontsOptions {
  documentId: string;
  /** Disable hook entirely when false (default: true) */
  enabled?: boolean;
  /**
   * Optional async getter that returns the current JWT token.
   * When provided, token is sent as Authorization: Bearer header.
   */
  getAuthToken?: () => Promise<string | null> | string | null;
  /**
   * Injectable function to fetch font metadata list.
   * Defaults to fetch against /api/v1/pdf/fonts/:documentId.
   * Override in tests or for custom auth handling.
   */
  fetchFontList?: (documentId: string) => Promise<{ fonts: ExtractedFontMetadata[] }>;
  /**
   * Injectable function to fetch font binary as base64.
   * Override in tests to avoid network calls.
   */
  fetchFontData?: (
    documentId: string,
    fontId: string,
  ) => Promise<{ dataBase64: string; format: 'ttf' | 'otf' | 'cff'; mimeType: string }>;
  /** Override the cache instance (useful in tests to inject a mock). */
  cache?: FontCache;
}

export interface UseEmbeddedFontsResult {
  /** Granular per-font load status */
  fonts: LoadedFont[];
  /** True while any font is still in 'pending' or 'loading' state */
  isLoading: boolean;
  /** Set if the font metadata fetch itself failed */
  error: Error | null;
  /**
   * Resolve a raw PDF font originalName to the CSS font-family name
   * registered with the FontFace API.
   * Returns null when the font is not embedded or failed to load.
   */
  getFontFaceName: (originalName: string) => string | null;
  /** Retry a failed font load by fontId. Clears the cache entry first. */
  retry: (fontId: string) => Promise<void>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildFontFaceName(documentId: string, fontId: string): string {
  // Scoped name prevents cross-document collisions in the same browser context
  return `gigapdf-${documentId}-${fontId}`;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  // Array.from avoids noUncheckedIndexedAccess — charCodeAt is safe on string chars
  const bytes = new Uint8Array(
    Array.from({ length: binaryString.length }, (_, i) => binaryString.charCodeAt(i)),
  );
  return bytes.buffer;
}

function formatToMime(format: 'ttf' | 'otf' | 'cff'): string {
  if (format === 'otf' || format === 'cff') return 'font/otf';
  return 'font/ttf';
}

async function defaultFetchFontList(
  documentId: string,
  getToken?: () => Promise<string | null> | string | null,
): Promise<{ fonts: ExtractedFontMetadata[] }> {
  const token = getToken ? await Promise.resolve(getToken()) : null;
  const headers: HeadersInit = { Accept: 'application/json' };
  if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  const response = await fetch(`/api/v1/pdf/fonts/${encodeURIComponent(documentId)}`, {
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch font list: HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    success: boolean;
    data?: { fonts: ExtractedFontMetadata[] };
    error?: string;
  };
  if (!json.success) throw new Error(json.error ?? 'Font list request failed');
  return json.data!;
}

async function defaultFetchFontData(
  documentId: string,
  fontId: string,
  getToken?: () => Promise<string | null> | string | null,
): Promise<{ dataBase64: string; format: 'ttf' | 'otf' | 'cff'; mimeType: string }> {
  const token = getToken ? await Promise.resolve(getToken()) : null;
  const headers: HeadersInit = { Accept: 'application/json' };
  if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  const response = await fetch(
    `/api/v1/pdf/fonts/${encodeURIComponent(documentId)}/${encodeURIComponent(fontId)}`,
    { headers, credentials: 'include' },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch font data: HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    success: boolean;
    data?: { dataBase64: string; format: 'ttf' | 'otf' | 'cff'; mimeType: string };
    error?: string;
  };
  if (!json.success) throw new Error(json.error ?? 'Font data request failed');
  return json.data!;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useEmbeddedFonts(opts: UseEmbeddedFontsOptions): UseEmbeddedFontsResult {
  const {
    documentId,
    enabled = true,
    getAuthToken,
    fetchFontList = (id: string) => defaultFetchFontList(id, getAuthToken),
    fetchFontData = (id: string, fid: string) => defaultFetchFontData(id, fid, getAuthToken),
    cache = defaultFontCache,
  } = opts;

  const [fonts, setFonts] = useState<LoadedFont[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Registered FontFace instances for cleanup on unmount / document change
  const registeredFontFaces = useRef<FontFace[]>([]);
  // Signal object passed to async tasks so they can detect stale runs
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  // ── Load a single font ────────────────────────────────────────────────────

  const loadSingleFont = useCallback(
    async (metadata: ExtractedFontMetadata, signal: { aborted: boolean }): Promise<void> => {
      if (!metadata.isEmbedded) {
        setFonts((prev) =>
          prev.map((f) =>
            f.metadata.fontId === metadata.fontId
              ? { ...f, status: 'failed', error: 'Font is not embedded in the PDF' }
              : f,
          ),
        );
        return;
      }

      setFonts((prev) =>
        prev.map((f) =>
          f.metadata.fontId === metadata.fontId ? { ...f, status: 'loading' } : f,
        ),
      );

      try {
        // Check IndexedDB cache first
        let fontBuffer = await cache.get(documentId, metadata.fontId);

        if (!fontBuffer) {
          const data = await fetchFontData(documentId, metadata.fontId);
          if (signal.aborted) return;
          fontBuffer = base64ToArrayBuffer(data.dataBase64);
          // Cache asynchronously — do not block font registration
          cache.set(documentId, metadata.fontId, fontBuffer).catch((err: unknown) => {
            logger.warn('Failed to cache font in IndexedDB', {
              fontId: metadata.fontId,
              documentId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        if (signal.aborted) return;

        const fontFaceName = buildFontFaceName(documentId, metadata.fontId);
        const mimeType = formatToMime(metadata.format ?? 'ttf');
        const blobUrl = URL.createObjectURL(new Blob([fontBuffer], { type: mimeType }));

        const fontFace = new FontFace(fontFaceName, `url(${blobUrl})`);

        try {
          await fontFace.load();
          if (signal.aborted) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          getFontSet().add(fontFace);
          registeredFontFaces.current.push(fontFace);
          URL.revokeObjectURL(blobUrl);
        } catch (loadErr) {
          URL.revokeObjectURL(blobUrl);
          throw loadErr;
        }

        if (signal.aborted) return;

        setFonts((prev) =>
          prev.map((f) =>
            f.metadata.fontId === metadata.fontId
              ? { ...f, status: 'loaded', error: undefined }
              : f,
          ),
        );
      } catch (err) {
        if (signal.aborted) return;

        const message = err instanceof Error ? err.message : 'Unknown error loading font';

        logger.warn('Failed to load embedded font', {
          fontId: metadata.fontId,
          fontName: metadata.originalName,
          documentId,
          error: message,
        });

        setFonts((prev) =>
          prev.map((f) =>
            f.metadata.fontId === metadata.fontId
              ? { ...f, status: 'failed', error: message }
              : f,
          ),
        );
      }
    },
    [documentId, fetchFontData, cache],
  );

  // ── Main effect ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled || !documentId || !isFontDynamicLoadEnabled()) {
      return;
    }

    const signal = { aborted: false };
    abortRef.current = signal;

    // Cleanup previously registered fonts before starting a new load cycle
    for (const ff of registeredFontFaces.current) {
      try { getFontSet().delete(ff); } catch { /* ignore */ }
    }
    registeredFontFaces.current = [];

    setFonts([]);
    setError(null);
    setIsLoading(true);

    async function run(): Promise<void> {
      try {
        const { fonts: metadataList } = await fetchFontList(documentId);
        if (signal.aborted) return;

        const initialFonts: LoadedFont[] = metadataList.map((meta) => ({
          metadata: meta,
          fontFaceName: buildFontFaceName(documentId, meta.fontId),
          status: 'pending',
        }));
        setFonts(initialFonts);

        const embeddedFonts = metadataList.filter((m) => m.isEmbedded);

        if (embeddedFonts.length === 0) {
          // All fonts are non-embedded — mark them all failed gracefully
          setFonts((prev) =>
            prev.map((f) =>
              f.status === 'pending'
                ? { ...f, status: 'failed', error: 'Font not embedded in PDF' }
                : f,
            ),
          );
          setIsLoading(false);
          return;
        }

        // All fonts loaded in parallel — one failure does not block others
        await Promise.allSettled(
          embeddedFonts.map((meta) => loadSingleFont(meta, signal)),
        );

        if (signal.aborted) return;

        // Any font still in 'pending' is non-embedded — mark failed gracefully
        setFonts((prev) =>
          prev.map((f) =>
            f.status === 'pending'
              ? { ...f, status: 'failed', error: 'Font not embedded in PDF' }
              : f,
          ),
        );
      } catch (err) {
        if (signal.aborted) return;
        const loadError =
          err instanceof Error ? err : new Error('Failed to load font metadata');
        setError(loadError);

        logger.error('useEmbeddedFonts: failed to fetch font metadata', {
          documentId,
          error: loadError.message,
        });
      } finally {
        if (!signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    run();

    return () => {
      signal.aborted = true;
      for (const ff of registeredFontFaces.current) {
        try { getFontSet().delete(ff); } catch { /* ignore */ }
      }
      registeredFontFaces.current = [];
    };
  }, [documentId, enabled, fetchFontList, loadSingleFont]);

  // ── getFontFaceName ───────────────────────────────────────────────────────

  const getFontFaceName = useCallback(
    (originalName: string): string | null => {
      if (!originalName) return null;
      const found = fonts.find(
        (f) => f.metadata.originalName === originalName && f.status === 'loaded',
      );
      return found?.fontFaceName ?? null;
    },
    [fonts],
  );

  // ── retry ─────────────────────────────────────────────────────────────────

  const retry = useCallback(
    async (fontId: string): Promise<void> => {
      const target = fonts.find((f) => f.metadata.fontId === fontId);
      if (!target) return;
      // Clear stale cache so the font is re-downloaded
      await cache.delete(documentId, fontId);
      await loadSingleFont(target.metadata, abortRef.current);
    },
    [fonts, documentId, cache, loadSingleFont],
  );

  return { fonts, isLoading, error, getFontFaceName, retry };
}
