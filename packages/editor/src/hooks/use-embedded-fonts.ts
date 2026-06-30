/**
 * useEmbeddedFonts — load PDF embedded fonts via FontFace API with IndexedDB cache.
 *
 * Usage:
 *   const { fonts, isLoading, getFontFaceName } = useEmbeddedFonts({ documentId });
 *
 * Behaviour:
 *  1. Fetches font metadata list from /api/pdf/fonts/:documentId
 *  2. For each font: checks IndexedDB cache → downloads embedded bytes if absent
 *  3. Falls back to the /api/fonts/google proxy when a font is not embedded
 *     in the PDF (or its bytes cannot be extracted) before marking it failed
 *  4. Registers each font via document.fonts.add(new FontFace(...))
 *  5. On unmount: removes registered FontFace instances (prevents leaks)
 *  6. Loads all fonts in parallel (Promise.allSettled)
 *  7. Respects the NEXT_PUBLIC_FONT_DYNAMIC_LOAD feature flag
 *
 * React 19.2: the React Compiler handles memoization automatically.
 * Manual useMemo/useCallback are kept only where they capture stale closure refs.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { logger } from '@giga-pdf/logger';
import { defaultFontCache, type FontCache } from '../utils/font-cache';

// ─── Font set accessor ────────────────────────────────────────────────────────
// TypeScript 6 lib.dom.d.ts exposes FontFaceSet.add/delete natively
// (FontFaceSet extends Set<FontFace>), so no augmentation is required.
function getFontSet(): FontFaceSet {
  return document.fonts;
}

// ─── Feature Flag ─────────────────────────────────────────────────────────────

// Embedded font loading is the only way to render text with the original
// PDF typography. When OFF, every text element falls back to "Helvetica"
// regardless of what the source PDF actually used. We therefore default
// the flag to ON and require an explicit opt-out via `NEXT_PUBLIC_FONT_DYNAMIC_LOAD=false`.
function isFontDynamicLoadEnabled(): boolean {
  if (typeof process === 'undefined') return true;
  return process.env['NEXT_PUBLIC_FONT_DYNAMIC_LOAD'] !== 'false';
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
  /**
   * Injectable function to fetch a Google Fonts substitute for a font that
   * is not embedded in the PDF (or whose bytes cannot be extracted).
   * Defaults to fetch against /api/fonts/google.
   * Override in tests to avoid network calls.
   */
  fetchGoogleFont?: (originalName: string) => Promise<GoogleFontResult>;
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
   * registered with the FontFace API (embedded bytes or Google substitute).
   * Returns null when the font failed to load (neither embedded bytes nor
   * a Google Fonts substitute were available).
   *
   * `wantVariant` is the weight/style INTENT of the run being rendered. A PDF
   * routinely embeds many subsets of the SAME family (Times New Roman regular,
   * bold, italic, bold-italic — Ameli/admin forms have 20-40), and the scene
   * graph collapses each run's family to a bare name ("Times New Roman"). Passed
   * a variant, the resolver first looks for the subset whose own (weight-bearing)
   * name matches that bold/italic intent, so a regular run no longer resolves to
   * the first-loaded BOLD subset (the "gras parasite" / wrong-metrics bug). When
   * omitted, or when no variant-exact subset exists, it falls back to the loose
   * family match (previous behaviour — no regression for single-variant fonts).
   *
   * `text` (3rd arg, optional) is the run's text. When a PDF embeds several
   * DISJOINT subsets of the same family+variant (CERFA forms carry ~15
   * `TimesNewRoman,Bold` subsets, each mapping only the glyphs it painted), the
   * resolver returns the variant-exact subset that FULLY covers the run; if none
   * does, it returns null so the renderer applies a synthetic UNIFORM weight
   * (uniformly bold) instead of a patchy real-bold/fallback mix. Omitting `text`
   * keeps the prior "first matching subset" behaviour (single-variant PDFs).
   */
  getFontFaceName: (
    originalName: string,
    wantVariant?: { bold?: boolean; italic?: boolean },
    text?: string,
  ) => string | null;
  /** Retry a failed font load by fontId. Clears the cache entry first. */
  retry: (fontId: string) => Promise<void>;
}

/**
 * Detect the weight/style a font NAME advertises (subset PostScript / base name),
 * e.g. "AAAAAB+TimesNewRomanPS-BoldMT" → bold, "…,Italic" → italic,
 * "…-BoldItalicMT" → both. Medium weights ("SemiBold"/"DemiBold") are treated as
 * NOT bold (they are not the bold variant). Pure, used to pick the subset that
 * matches a run's render-time weight/style intent.
 */
function fontNameVariant(name: string): { bold: boolean; italic: boolean } {
  const isBold =
    /(?:^|[^a-z])(?:bold|heavy|black|extrabold)(?![a-z])/i.test(name) ||
    /[,\-](?:bold|heavy|black|extrabold)/i.test(name) ||
    /ps-?bold/i.test(name);
  const isSemi = /semi-?bold|demi-?bold/i.test(name);
  const isItalic = /italic|oblique/i.test(name);
  return { bold: isBold && !isSemi, italic: isItalic };
}

/**
 * RAW exact subset-name match: does a loaded font's `candidate` name denote the
 * very SAME embedded subset as the run's `/BaseFont` `target`? Compares the FULL
 * names (subset prefix INCLUDED, leading "/" stripped, case-insensitive). A raw
 * hit means `candidate` IS the exact subset that painted the run → identical
 * glyph metrics AND full coverage, so it is preferred over the family+coverage
 * heuristic. Deliberately does NOT strip the `ABCDEF+` subset prefix: two
 * DISJOINT subsets of the same `/BaseFont` ("ABCDEF+X" vs "GHIJKL+X") would then
 * collide and the wrong one would render tofu — that ambiguous case is left to
 * the coverage heuristic. Empty names never match.
 */
function isExactSubsetName(candidate: string, target: string): boolean {
  const a = candidate.replace(/^\//, '').trim().toLowerCase();
  const b = target.replace(/^\//, '').trim().toLowerCase();
  return a.length > 0 && a === b;
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

// ─── Glyph coverage (cmap) parser ──────────────────────────────────────────────
// A PDF routinely embeds many DISJOINT subsets of the SAME family+variant
// (e.g. a CERFA carries ~15 `TimesNewRoman,Bold` subsets, each mapping only the
// glyphs of the runs it painted). The scene graph collapses every such run to a
// bare "Times New Roman" + bold:true. Picking the FIRST loaded bold subset
// (load order is non-deterministic) renders only the codepoints THAT subset
// happens to carry — the rest of a title falls to the browser's non-bold
// fallback, so the title looks unevenly bold. To choose the subset that ACTUALLY
// covers a run, we parse each loaded font's `cmap` and keep the set of Unicode
// codepoints it maps. This is a pure, allocation-light sfnt reader (TrueType AND
// OpenType/CFF share the same table directory + `cmap` structure). On ANY
// malformed/short input it returns an empty set — a font with unknown coverage
// is simply never preferred by coverage (it can still be the loose fallback),
// so this can only REFINE selection, never break a previously working path.

/**
 * Parse the Unicode codepoints a font's `cmap` maps. Supports subtable formats
 * 0, 4, 6 and 12 (the ones real PDF embedded fonts use). Prefers a Unicode
 * subtable: platform 3 / encoding 1 (BMP) or 10 (full), or platform 0 (any).
 * Returns an empty Set on any parse error (safe: "unknown coverage").
 */
export function parseCmapCodepoints(buffer: ArrayBuffer): Set<number> {
  const out = new Set<number>();
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 12) return out;

    // sfnt table directory: u32 tag, u16 numTables at offset 4.
    const numTables = view.getUint16(4);
    let cmapOffset = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (rec + 16 > view.byteLength) break;
      // tag is 4 ASCII bytes: 'c' 'm' 'a' 'p' = 0x636d6170
      if (view.getUint32(rec) === 0x636d6170) {
        cmapOffset = view.getUint32(rec + 8); // offset field of the table record
        break;
      }
    }
    if (cmapOffset < 0 || cmapOffset + 4 > view.byteLength) return out;

    // cmap header: u16 version, u16 numSubtables, then numSubtables encoding
    // records (u16 platformID, u16 encodingID, u32 subtableOffset).
    const numSub = view.getUint16(cmapOffset + 2);
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < numSub; i++) {
      const rec = cmapOffset + 4 + i * 8;
      if (rec + 8 > view.byteLength) break;
      const platform = view.getUint16(rec);
      const encoding = view.getUint16(rec + 2);
      const sub = cmapOffset + view.getUint32(rec + 4);
      // Score Unicode-capable subtables; higher = preferred.
      let score = -1;
      if (platform === 3 && encoding === 10) score = 4; // Windows UCS-4
      else if (platform === 3 && encoding === 1) score = 3; // Windows BMP
      else if (platform === 0) score = 2; // Unicode
      else if (platform === 3 && encoding === 0) score = 1; // Windows Symbol
      if (score > bestScore && sub > 0 && sub < view.byteLength) {
        bestScore = score;
        best = sub;
      }
    }
    if (best < 0) return out;

    readCmapSubtable(view, best, out);
  } catch {
    /* malformed font → empty coverage (safe) */
  }
  return out;
}

/** Decode a single cmap subtable (format 0/4/6/12) into `out`. */
function readCmapSubtable(view: DataView, sub: number, out: Set<number>): void {
  if (sub + 2 > view.byteLength) return;
  const format = view.getUint16(sub);

  if (format === 0) {
    // Byte encoding table: 256 single-byte glyph indices.
    if (sub + 6 + 256 > view.byteLength) return;
    for (let c = 0; c < 256; c++) {
      if (view.getUint8(sub + 6 + c) !== 0) out.add(c);
    }
    return;
  }

  if (format === 4) {
    // Segment mapping to delta values.
    if (sub + 14 > view.byteLength) return;
    const segCountX2 = view.getUint16(sub + 6);
    const segCount = segCountX2 >> 1;
    const endBase = sub + 14;
    const startBase = endBase + segCountX2 + 2; // +2 reservedPad
    const deltaBase = startBase + segCountX2;
    const rangeBase = deltaBase + segCountX2;
    if (rangeBase + segCountX2 > view.byteLength) return;
    for (let s = 0; s < segCount; s++) {
      const end = view.getUint16(endBase + s * 2);
      const start = view.getUint16(startBase + s * 2);
      const delta = view.getUint16(deltaBase + s * 2);
      const rangeOffset = view.getUint16(rangeBase + s * 2);
      if (start > end) continue;
      // 0xFFFF is the required terminator segment, never a real glyph.
      const hardEnd = end === 0xffff ? 0xfffe : end;
      for (let c = start; c <= hardEnd; c++) {
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (c + delta) & 0xffff;
        } else {
          // glyphIdArray index per the spec's idRangeOffset arithmetic.
          const idx =
            rangeBase + s * 2 + rangeOffset + (c - start) * 2;
          if (idx + 2 > view.byteLength) continue;
          const g = view.getUint16(idx);
          glyph = g === 0 ? 0 : (g + delta) & 0xffff;
        }
        if (glyph !== 0) out.add(c);
      }
    }
    return;
  }

  if (format === 6) {
    // Trimmed table mapping: contiguous range.
    if (sub + 10 > view.byteLength) return;
    const first = view.getUint16(sub + 6);
    const count = view.getUint16(sub + 8);
    if (sub + 10 + count * 2 > view.byteLength) return;
    for (let i = 0; i < count; i++) {
      if (view.getUint16(sub + 10 + i * 2) !== 0) out.add(first + i);
    }
    return;
  }

  if (format === 12) {
    // Segmented coverage (UCS-4): u16 format, u16 reserved, u32 length,
    // u32 language, u32 nGroups, then nGroups × (u32 start, u32 end, u32 glyph).
    if (sub + 16 > view.byteLength) return;
    const nGroups = view.getUint32(sub + 12);
    let g = sub + 16;
    // Cap groups defensively against a corrupt count.
    const maxGroups = Math.min(nGroups, Math.floor((view.byteLength - g) / 12));
    for (let i = 0; i < maxGroups; i++, g += 12) {
      const start = view.getUint32(g);
      const end = view.getUint32(g + 4);
      if (start > end || end - start > 0x10ffff) continue;
      for (let c = start; c <= end; c++) out.add(c);
    }
  }
}

/**
 * Unique codepoints of a run's text (skips whitespace — every font "covers"
 * spaces/newlines, so they must not inflate or distort coverage comparison).
 * Pure helper, exported for testing.
 */
export function textCodepoints(text: string): number[] {
  const set = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    // Skip ASCII/Unicode whitespace.
    if (cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0xa0) continue;
    set.add(cp);
  }
  return [...set];
}

function formatToMime(format: 'ttf' | 'otf' | 'cff'): string {
  if (format === 'otf' || format === 'cff') return 'font/otf';
  return 'font/ttf';
}

// The Python backend serialises Pydantic models with snake_case keys
// (`original_name`, `font_id`, `is_embedded`, …) while the editor consumes
// camelCase (matching the rest of the TS API). Normalise once at the
// network boundary so the rest of the hook can stay strongly-typed.
type FontMetadataWire = {
  font_id?: string; fontId?: string;
  original_name?: string; originalName?: string;
  postscript_name?: string | null; postscriptName?: string | null;
  font_family?: string | null; fontFamily?: string | null;
  subtype?: string;
  is_embedded?: boolean; isEmbedded?: boolean;
  is_subset?: boolean; isSubset?: boolean;
  format?: 'ttf' | 'otf' | 'cff' | null;
  size_bytes?: number | null; sizeBytes?: number | null;
};

function normaliseMetadata(raw: FontMetadataWire): ExtractedFontMetadata {
  return {
    fontId: raw.fontId ?? raw.font_id ?? '',
    originalName: raw.originalName ?? raw.original_name ?? '',
    postscriptName: raw.postscriptName ?? raw.postscript_name ?? null,
    fontFamily: raw.fontFamily ?? raw.font_family ?? null,
    subtype: raw.subtype ?? 'unknown',
    isEmbedded: raw.isEmbedded ?? raw.is_embedded ?? false,
    isSubset: raw.isSubset ?? raw.is_subset ?? false,
    format: raw.format ?? null,
    sizeBytes: raw.sizeBytes ?? raw.size_bytes ?? null,
  };
}

async function defaultFetchFontList(
  documentId: string,
  getToken?: () => Promise<string | null> | string | null,
): Promise<{ fonts: ExtractedFontMetadata[] }> {
  const token = getToken ? await Promise.resolve(getToken()) : null;
  const headers: HeadersInit = { Accept: 'application/json' };
  if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  const response = await fetch(`/api/pdf/fonts/${encodeURIComponent(documentId)}`, {
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch font list: HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    success: boolean;
    data?: { fonts: FontMetadataWire[] };
    error?: string;
  };
  if (!json.success) throw new Error(json.error ?? 'Font list request failed');
  const wireFonts = json.data?.fonts ?? [];
  return { fonts: wireFonts.map(normaliseMetadata) };
}

type FontDataWire = {
  data_base64?: string; dataBase64?: string;
  format: 'ttf' | 'otf' | 'cff';
  mime_type?: string; mimeType?: string;
};

async function defaultFetchFontData(
  documentId: string,
  fontId: string,
  getToken?: () => Promise<string | null> | string | null,
): Promise<{ dataBase64: string; format: 'ttf' | 'otf' | 'cff'; mimeType: string }> {
  const token = getToken ? await Promise.resolve(getToken()) : null;
  const headers: HeadersInit = { Accept: 'application/json' };
  if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  const response = await fetch(
    `/api/pdf/fonts/${encodeURIComponent(documentId)}/${encodeURIComponent(fontId)}`,
    { headers, credentials: 'include' },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch font data: HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    success: boolean;
    data?: FontDataWire;
    error?: string;
  };
  if (!json.success || !json.data) throw new Error(json.error ?? 'Font data request failed');
  return {
    dataBase64: json.data.dataBase64 ?? json.data.data_base64 ?? '',
    format: json.data.format,
    mimeType: json.data.mimeType ?? json.data.mime_type ?? 'application/octet-stream',
  };
}

// ─── Google Fonts proxy fallback ──────────────────────────────────────────────
// When a font is not embedded in the PDF (or its bytes cannot be extracted),
// the same-origin proxy route /api/fonts/google resolves the original PDF
// font name to the closest Google Fonts variant instead of giving up.

/** Successful Google Fonts proxy match for a PDF font name. */
export interface GoogleFontMatch {
  found: true;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  format: 'ttf';
  mimeType: 'font/ttf';
  dataBase64: string;
}

/** Response contract of GET /api/fonts/google?name=… */
export type GoogleFontResult = GoogleFontMatch | { found: false };

async function defaultFetchGoogleFont(
  originalName: string,
  getToken?: () => Promise<string | null> | string | null,
): Promise<GoogleFontResult> {
  const token = getToken ? await Promise.resolve(getToken()) : null;
  const headers: HeadersInit = { Accept: 'application/json' };
  if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  const response = await fetch(`/api/fonts/google?name=${encodeURIComponent(originalName)}`, {
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Google font: HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    success: boolean;
    data?: GoogleFontResult;
    error?: string;
  };
  if (!json.success || !json.data) throw new Error(json.error ?? 'Google font request failed');
  return json.data;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useEmbeddedFonts(opts: UseEmbeddedFontsOptions): UseEmbeddedFontsResult {
  const {
    documentId,
    enabled = true,
    getAuthToken,
    cache = defaultFontCache,
  } = opts;

  const [fonts, setFonts] = useState<LoadedFont[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Registered FontFace instances for cleanup on unmount / document change
  const registeredFontFaces = useRef<FontFace[]>([]);
  // Glyph coverage per loaded font (fontId → Unicode codepoints its cmap maps).
  // Read synchronously by getFontFaceName to pick, among same-family+variant
  // subsets, the one that actually covers a run's text (CERFA disjoint subsets).
  const coverageRef = useRef<Map<string, Set<number>>>(new Map());
  // Signal object passed to async tasks so they can detect stale runs
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  // Tracks documentIds that already failed — prevents retry storm on 503/429.
  // Without this, every setError() retriggered the useEffect because
  // `fetchFontList` was recomputed on each render (unstable reference).
  const failedDocumentsRef = useRef<Set<string>>(new Set());
  // Synchronous guard against concurrent effect invocations: React 19's
  // Strict Mode + parent re-renders can fire useEffect multiple times in the
  // same tick before any awaited fetch resolves. Marking the documentId as
  // "in-flight" before the await ensures duplicate invocations bail out
  // immediately instead of stacking up parallel HTTP requests.
  const inFlightDocumentsRef = useRef<Set<string>>(new Set());

  // Stable fetcher refs: callers may pass override fetchers, but we capture
  // them once so React effects don't loop on identity changes.
  const fetchListRef = useRef<typeof opts.fetchFontList>(opts.fetchFontList);
  const fetchDataRef = useRef<typeof opts.fetchFontData>(opts.fetchFontData);
  const fetchGoogleRef = useRef<typeof opts.fetchGoogleFont>(opts.fetchGoogleFont);
  fetchListRef.current = opts.fetchFontList;
  fetchDataRef.current = opts.fetchFontData;
  fetchGoogleRef.current = opts.fetchGoogleFont;
  const getAuthTokenRef = useRef(getAuthToken);
  getAuthTokenRef.current = getAuthToken;

  const fetchFontList = useCallback(
    (id: string) =>
      fetchListRef.current
        ? fetchListRef.current(id)
        : defaultFetchFontList(id, getAuthTokenRef.current),
    [],
  );
  const fetchFontData = useCallback(
    (id: string, fid: string) =>
      fetchDataRef.current
        ? fetchDataRef.current(id, fid)
        : defaultFetchFontData(id, fid, getAuthTokenRef.current),
    [],
  );
  const fetchGoogleFont = useCallback(
    (originalName: string) =>
      fetchGoogleRef.current
        ? fetchGoogleRef.current(originalName)
        : defaultFetchGoogleFont(originalName, getAuthTokenRef.current),
    [],
  );

  // ── Load a single font ────────────────────────────────────────────────────

  const loadSingleFont = useCallback(
    async (metadata: ExtractedFontMetadata, signal: { aborted: boolean }): Promise<void> => {
      setFonts((prev) =>
        prev.map((f) =>
          f.metadata.fontId === metadata.fontId ? { ...f, status: 'loading' } : f,
        ),
      );

      try {
        // Bytes + FontFace descriptors resolved from one of three sources:
        // IndexedDB cache, the backend extractor (embedded bytes), or the
        // Google Fonts proxy fallback.
        let fontBuffer: ArrayBuffer | null = null;
        let mimeType = formatToMime(metadata.format ?? 'ttf');
        let descriptors: FontFaceDescriptors | undefined;
        // Root cause kept so a Google miss after an extraction failure still
        // surfaces the original error in the font's failed state.
        let embeddedError: string | null = null;

        // Check IndexedDB cache first — embedded and Google-sourced bytes
        // share the same {documentId}:{fontId} key space.
        const cached = await cache.getEntry(documentId, metadata.fontId);
        if (signal.aborted) return;
        if (cached) {
          fontBuffer = cached.data;
          if (cached.meta?.source === 'google') {
            mimeType = 'font/ttf';
            descriptors = {
              weight: String(cached.meta.weight ?? 400),
              style: cached.meta.style ?? 'normal',
            };
          }
        }

        // Embedded bytes from the backend extractor.
        if (!fontBuffer && metadata.isEmbedded) {
          try {
            const data = await fetchFontData(documentId, metadata.fontId);
            if (signal.aborted) return;
            fontBuffer = base64ToArrayBuffer(data.dataBase64);
            // Cache asynchronously — do not block font registration
            cache
              .set(documentId, metadata.fontId, fontBuffer, undefined, { source: 'embedded' })
              .catch((err: unknown) => {
                logger.warn('Failed to cache font in IndexedDB', {
                  fontId: metadata.fontId,
                  documentId,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
          } catch (extractErr) {
            if (signal.aborted) return;
            // 404 "not extractable" & co — fall through to the Google Fonts
            // fallback below instead of failing immediately.
            embeddedError =
              extractErr instanceof Error ? extractErr.message : String(extractErr);
            logger.warn('Embedded font bytes unavailable, trying Google Fonts fallback', {
              fontId: metadata.fontId,
              fontName: metadata.originalName,
              documentId,
              error: embeddedError,
            });
          }
        }

        // Google Fonts proxy fallback — font is not embedded in the PDF, or
        // its embedded bytes could not be fetched. A miss or a network error
        // resolves to 'failed' (CSS fallback), never an uncaught throw.
        if (!fontBuffer) {
          let google: GoogleFontResult | null = null;
          let googleError: string | null = null;
          try {
            google = await fetchGoogleFont(metadata.originalName);
          } catch (fallbackErr) {
            googleError =
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          }
          if (signal.aborted) return;

          if (!google || !google.found) {
            const fallbackDetail = googleError
              ? `Google Fonts fallback failed: ${googleError}`
              : 'no Google Fonts substitute found';
            throw new Error(
              embeddedError
                ? `${embeddedError} (${fallbackDetail})`
                : `Font is not embedded in the PDF (${fallbackDetail})`,
            );
          }

          fontBuffer = base64ToArrayBuffer(google.dataBase64);
          mimeType = google.mimeType;
          descriptors = { weight: String(google.weight), style: google.style };
          // Cache asynchronously — same entry shape as embedded fonts, tagged
          // with provenance + descriptors so cache hits re-register identically.
          cache
            .set(documentId, metadata.fontId, fontBuffer, undefined, {
              source: 'google',
              weight: google.weight,
              style: google.style,
            })
            .catch((err: unknown) => {
              logger.warn('Failed to cache font in IndexedDB', {
                fontId: metadata.fontId,
                documentId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }

        if (signal.aborted) return;

        // Record the glyph coverage of this subset BEFORE registering it, so
        // getFontFaceName can prefer (among same-family+variant subsets) the one
        // that actually covers a given run. Google substitutes are full fonts;
        // their coverage is recorded too and naturally wins on completeness.
        coverageRef.current.set(metadata.fontId, parseCmapCodepoints(fontBuffer));

        // Same conventional CSS name for embedded and Google-substituted fonts,
        // so getFontFaceName resolves both without special-casing.
        const fontFaceName = buildFontFaceName(documentId, metadata.fontId);
        const blobUrl = URL.createObjectURL(new Blob([fontBuffer], { type: mimeType }));

        const fontFace = new FontFace(fontFaceName, `url(${blobUrl})`, descriptors);

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

        logger.warn('Failed to load font', {
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
    [documentId, fetchFontData, fetchGoogleFont, cache],
  );

  // ── Main effect ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled || !documentId || !isFontDynamicLoadEnabled()) {
      return;
    }

    // Hard-stop retry storms: if this document already failed once, do not
    // re-attempt on this mount. Refresh the page or call retry() to retry.
    if (failedDocumentsRef.current.has(documentId)) {
      return;
    }
    // Synchronous guard against concurrent invocations: only the first effect
    // for a given documentId actually fetches. Subsequent invocations exit
    // immediately so we never have multiple parallel requests in flight.
    if (inFlightDocumentsRef.current.has(documentId)) {
      return;
    }
    inFlightDocumentsRef.current.add(documentId);

    const signal = { aborted: false };
    abortRef.current = signal;

    // Cleanup previously registered fonts before starting a new load cycle
    for (const ff of registeredFontFaces.current) {
      try { getFontSet().delete(ff); } catch { /* ignore */ }
    }
    registeredFontFaces.current = [];
    coverageRef.current = new Map();

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

        // Fonts load with BOUNDED concurrency — never all-at-once. A PDF can
        // embed dozens of subset fonts (Ameli/admin forms routinely have 20-30
        // TimesNewRoman subsets); firing them all in parallel bursts the
        // per-user rate limit (HTTP 429) and can exhaust the browser socket
        // pool (ERR_INSUFFICIENT_RESOURCES). A small worker pool smooths the
        // burst while still loading every font. Per-font failures stay isolated
        // (parity with the previous Promise.allSettled): each worker swallows
        // rejections so one bad font never aborts the batch. The IndexedDB
        // cache makes subsequent renders near-instant regardless.
        const FONT_LOAD_CONCURRENCY = 4;
        const fontCursor = { value: 0 };
        const runFontWorker = async (): Promise<void> => {
          for (;;) {
            if (signal.aborted) return;
            const meta = metadataList[fontCursor.value++];
            if (!meta) return;
            try {
              await loadSingleFont(meta, signal);
            } catch {
              // loadSingleFont already logs + marks the font 'failed'. A single
              // failure must not abort the remaining fonts.
            }
          }
        };
        await Promise.all(
          Array.from(
            { length: Math.min(FONT_LOAD_CONCURRENCY, metadataList.length) },
            () => runFontWorker(),
          ),
        );

        if (signal.aborted) return;

        // Safety net: every font reaches a terminal status inside
        // loadSingleFont — sweep any straggler so the UI never hangs on 'pending'
        setFonts((prev) =>
          prev.some((f) => f.status === 'pending')
            ? prev.map((f) =>
                f.status === 'pending'
                  ? { ...f, status: 'failed', error: 'Font load did not complete' }
                  : f,
              )
            : prev,
        );
      } catch (err) {
        if (signal.aborted) return;
        const loadError =
          err instanceof Error ? err : new Error('Failed to load font metadata');
        // Mark this document as failed so the effect cannot loop on hard
        // errors (503 backend disabled, 429 rate-limited, network down).
        // Without this guard, setError → re-render → effect re-fires → fetch
        // → fail → setError → ... browsers eventually throw
        // ERR_INSUFFICIENT_RESOURCES after thousands of requests.
        failedDocumentsRef.current.add(documentId);
        setError(loadError);

        logger.warn('useEmbeddedFonts: font metadata unavailable, falling back to standard fonts', {
          documentId,
          error: loadError.message,
        });
      } finally {
        if (!signal.aborted) {
          setIsLoading(false);
        }
        // Always release the in-flight slot, success or failure.
        inFlightDocumentsRef.current.delete(documentId);
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

  // pdfjs strips the 6-letter subset prefix and "-Regular"/"-Bold"/MT/PS
  // suffixes inconsistently between the parser used to build the scene graph
  // and the backend Python parser used to extract font metadata. A strict
  // equality check therefore misses ~every match for subsetted PDF fonts
  // ("HXBDOG+OCRB10PitchBT-Regular" vs "OCRB10PitchBT-Regular" vs "OCRB10PitchBT").
  // Normalise both sides the same way and accept a two-direction substring
  // match so the embedded font is actually picked up at render time.
  function normaliseFontName(raw: string): string {
    return raw
      .replace(/^\//, '')
      .replace(/^[A-Z]{6}\+/, '')
      .replace(/(-?Regular|-?Roman|-?Book|MT|PS)$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  const getFontFaceName = useCallback(
    (
      originalName: string,
      wantVariant?: { bold?: boolean; italic?: boolean },
      text?: string,
    ): string | null => {
      if (!originalName) return null;
      const target = normaliseFontName(originalName);
      if (!target) return null;

      const loaded = fonts.filter((f) => f.status === 'loaded');

      // EXACT EMBEDDED SUBSET (font-fidelity fast path). `originalName` here is the
      // run's real `/BaseFont` (subset prefix kept, e.g. "ABCDEF+TimesNewRomanPSMT",
      // wired from the engine via TextStyle.originalFont). When a loaded FontFace
      // advertises that exact name, it IS the subset that painted the run → exact
      // metrics + full coverage. Resolve it BEFORE the family + cmap-coverage
      // heuristic (which only refines among AMBIGUOUS same-family subsets). Applies
      // to BOTH the variant-aware and the loose call, so resolveTextFont marks the
      // result `usingEmbeddedFont` (no synthetic weight/style, no width fit).
      const exactSubset = loaded.find((f) => {
        const names = [f.metadata.originalName, f.metadata.postscriptName];
        return names.some(
          (n) => typeof n === 'string' && isExactSubsetName(n, originalName),
        );
      });
      if (exactSubset) return exactSubset.fontFaceName;

      // Family name (loose) match against a candidate's normalised name.
      const familyHit = (candidate: string): boolean => {
        const norm = normaliseFontName(candidate);
        if (!norm) return false;
        return norm === target || norm.includes(target) || target.includes(norm);
      };

      // VARIANT-EXACT mode: when the caller passes the run's weight/style intent,
      // resolve ONLY the subset whose OWN name advertises that same bold/italic.
      // The renderer falls back to the loose 1-arg call for the closest subset
      // AND re-applies a synthetic weight/style when this returns null, so a
      // missing/incomplete variant is approximated instead of mis-rendered.
      //
      // Crucially the family is matched on the WEIGHT-BEARING names (originalName /
      // postscriptName) only — NOT the backend-collapsed `fontFamily`
      // ("Times New Roman"), which is identical for every subset and short-circuits
      // to the first-loaded one. That collapse is exactly why a regular run used to
      // resolve to the first BOLD subset (the "gras parasite" + wrong-metrics bug).
      if (wantVariant) {
        const wantBold = wantVariant.bold === true;
        const wantItalic = wantVariant.italic === true;
        // ALL same-family subsets whose own name advertises this exact variant.
        const candidates = loaded.filter((f) => {
          const weightNames = [f.metadata.originalName, f.metadata.postscriptName].filter(
            (s): s is string => Boolean(s),
          );
          for (const name of weightNames) {
            if (!familyHit(name)) continue;
            const v = fontNameVariant(name);
            if (v.bold === wantBold && v.italic === wantItalic) return true;
          }
          return false;
        });
        if (candidates.length === 0) return null;

        // GLYPH-COVERAGE refinement. A PDF embeds many DISJOINT subsets of the
        // same family+variant (a CERFA carries ~15 `TimesNewRoman,Bold` subsets,
        // each mapping only the glyphs of the runs it painted). Returning the
        // first-loaded one renders only ITS glyphs in the variant — the rest of a
        // run falls to the non-bold browser fallback, so a title looks unevenly
        // bold. When the caller passes the run's text:
        //   • prefer a candidate that FULLY covers it (real bold, perfect);
        //   • if NONE covers it fully, return null so the renderer uses the loose
        //     subset + a SYNTHETIC, UNIFORM weight/style (uniformly bold like the
        //     reference) instead of a patchy real-bold/fallback mix.
        // Without text (or with no recorded coverage), keep the prior behaviour:
        // first matching subset — so single-variant PDFs are unchanged.
        const needed = text ? textCodepoints(text) : [];
        if (needed.length === 0) {
          return candidates[0]!.fontFaceName;
        }
        const fullyCovers = candidates.find((f) => {
          const cov = coverageRef.current.get(f.metadata.fontId);
          if (!cov || cov.size === 0) return false;
          return needed.every((cp) => cov.has(cp));
        });
        // No single same-variant subset covers the whole run → defer to the
        // loose + synthetic-uniform path (renderer's 1-arg fallback). This is the
        // disjoint-subset case; returning a partial subset would leave glyphs
        // un-bolded.
        return fullyCovers ? fullyCovers.fontFaceName : null;
      }

      // LOOSE family match (original behaviour) — used for the 1-arg call (no
      // variant requested) and as the renderer's fallback when no variant-exact
      // subset exists. Matches on every candidate name including the collapsed
      // `fontFamily`, returning the first loaded subset of the family.
      const found = loaded.find((f) => {
        const candidates = [
          f.metadata.originalName,
          f.metadata.postscriptName,
          f.metadata.fontFamily,
        ].filter((s): s is string => Boolean(s));
        return candidates.some((c) => familyHit(c));
      });
      return found?.fontFaceName ?? null;
    },
    [fonts],
  );

  // ── retry ─────────────────────────────────────────────────────────────────

  const retry = useCallback(
    async (fontId: string): Promise<void> => {
      // Manual retry implies the user wants to try again — clear the failure
      // guard so a future mount/document change can re-attempt the metadata fetch.
      failedDocumentsRef.current.delete(documentId);
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
