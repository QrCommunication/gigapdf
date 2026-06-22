/**
 * Tests for useEmbeddedFonts hook
 *
 * Coverage:
 *  - test_fetches_fonts_on_mount
 *  - test_caches_fonts_in_indexeddb
 *  - test_falls_back_gracefully_on_failed_font
 *  - test_cleanup_on_unmount_removes_font_from_document
 *  - test_resolves_pdf_font_name_with_subset_prefix
 *  - test_returns_null_for_non_embedded_fonts
 *  - google_fallback: non-embedded → Google proxy, extraction failure → Google
 *    proxy, IndexedDB cache consulted before network
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEmbeddedFonts } from '../use-embedded-fonts';
import { FontCache } from '../../utils/font-cache';
import { fontFaceSet } from '../../__tests__/vitest-setup';

// ─── Mock @giga-pdf/logger ─────────────────────────────────────────────────

vi.mock('@giga-pdf/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createDefaultLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

const DOCUMENT_ID = 'doc-test-123';

function makeMetadata(overrides: Partial<{
  fontId: string;
  originalName: string;
  isEmbedded: boolean;
  format: 'ttf' | 'otf' | 'cff';
}> = {}) {
  return {
    fontId: overrides.fontId ?? 'font-abc',
    originalName: overrides.originalName ?? 'TestFont',
    postscriptName: null,
    fontFamily: 'TestFont',
    subtype: 'TrueType',
    isEmbedded: overrides.isEmbedded ?? true,
    isSubset: false,
    format: overrides.format ?? 'ttf' as const,
    sizeBytes: 12345,
  };
}

/** A valid minimal TTF ArrayBuffer (just needs to be non-empty for the mock) */
function makeFakeBuffer(): ArrayBuffer {
  return new Uint8Array([0x00, 0x01, 0x00, 0x00]).buffer;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Array.from avoids noUncheckedIndexedAccess issues with indexed iteration
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
}

/** Create a mock FontCache that is always empty (no-op reads) */
function makeEmptyCache(): FontCache {
  return {
    get: vi.fn().mockResolvedValue(null),
    getEntry: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(undefined),
    evictExpired: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  } as unknown as FontCache;
}

/** Create a FontCache that already has the font cached */
function makePopulatedCache(
  buffer: ArrayBuffer,
  meta: { source: 'embedded' | 'google'; weight?: number; style?: 'normal' | 'italic' } | null = null,
): FontCache {
  return {
    get: vi.fn().mockResolvedValue(buffer),
    getEntry: vi.fn().mockResolvedValue({ data: buffer, meta }),
    set: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(undefined),
    evictExpired: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  } as unknown as FontCache;
}

/** Build a successful Google Fonts proxy response */
function makeGoogleHit(overrides: Partial<{ weight: number; style: 'normal' | 'italic' }> = {}) {
  return {
    found: true as const,
    family: 'Roboto',
    weight: overrides.weight ?? 400,
    style: overrides.style ?? ('normal' as const),
    format: 'ttf' as const,
    mimeType: 'font/ttf' as const,
    dataBase64: bufferToBase64(makeFakeBuffer()),
  };
}

// ─── Test Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  // Enable the feature flag for all tests
  vi.stubEnv('NEXT_PUBLIC_FONT_DYNAMIC_LOAD', 'true');
  // Reset the document.fonts mock
  fontFaceSet._fonts.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('useEmbeddedFonts', () => {
  // ── test_fetches_fonts_on_mount ──────────────────────────────────────────

  it('test_fetches_fonts_on_mount: fetches font metadata and loads embedded fonts', async () => {
    const metadata = makeMetadata();
    const buffer = makeFakeBuffer();

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [metadata] });
    const fetchFontData = vi.fn().mockResolvedValue({
      dataBase64: bufferToBase64(buffer),
      format: 'ttf' as const,
      mimeType: 'font/ttf',
    });
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        cache,
      }),
    );

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetchFontList).toHaveBeenCalledWith(DOCUMENT_ID);
    expect(fetchFontData).toHaveBeenCalledWith(DOCUMENT_ID, metadata.fontId);
    expect(result.current.fonts).toHaveLength(1);
    const firstFont = result.current.fonts[0];
    expect(firstFont).toBeDefined();
    expect(firstFont?.status).toBe('loaded');
    expect(result.current.error).toBeNull();
  });

  // ── test_caches_fonts_in_indexeddb ──────────────────────────────────────

  it('test_caches_fonts_in_indexeddb: writes downloaded font to cache and uses cache on second render', async () => {
    const metadata = makeMetadata({ fontId: 'font-cache-test' });
    const buffer = makeFakeBuffer();

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [metadata] });
    const fetchFontData = vi.fn().mockResolvedValue({
      dataBase64: bufferToBase64(buffer),
      format: 'ttf' as const,
      mimeType: 'font/ttf',
    });
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        cache,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Cache.set must have been called with the downloaded buffer
    const setCalls = (cache.set as ReturnType<typeof vi.fn>).mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);
    const [calledDocId, calledFontId, calledBuffer] = setCalls[0] as [string, string, ArrayBuffer];
    expect(calledDocId).toBe(DOCUMENT_ID);
    expect(calledFontId).toBe(metadata.fontId);
    expect(calledBuffer).toBeInstanceOf(ArrayBuffer);

    // Second render with a populated cache — fetchFontData should NOT be called again
    const populatedCache = makePopulatedCache(buffer);
    const fetchFontData2 = vi.fn();

    const { result: result2 } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData: fetchFontData2,
        cache: populatedCache,
      }),
    );

    await waitFor(() => expect(result2.current.isLoading).toBe(false));

    expect(fetchFontData2).not.toHaveBeenCalled();
    const cachedFont = result2.current.fonts[0];
    expect(cachedFont).toBeDefined();
    expect(cachedFont?.status).toBe('loaded');
  });

  // ── test_falls_back_gracefully_on_failed_font ────────────────────────────

  it('test_falls_back_gracefully_on_failed_font: marks font as failed without blocking others', async () => {
    const goodMeta = makeMetadata({ fontId: 'font-good', originalName: 'GoodFont' });
    const badMeta = makeMetadata({ fontId: 'font-bad', originalName: 'BadFont' });

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [goodMeta, badMeta] });

    // Good font succeeds, bad font rejects
    const fetchFontData = vi.fn().mockImplementation((_docId: string, fontId: string) => {
      if (fontId === 'font-bad') {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({
        dataBase64: bufferToBase64(makeFakeBuffer()),
        format: 'ttf' as const,
        mimeType: 'font/ttf',
      });
    });

    // Google Fonts fallback misses too — the bad font ends up failed
    const fetchGoogleFont = vi.fn().mockResolvedValue({ found: false });
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        fetchGoogleFont,
        cache,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const goodFont = result.current.fonts.find((f) => f.metadata.fontId === 'font-good');
    const badFont = result.current.fonts.find((f) => f.metadata.fontId === 'font-bad');

    expect(goodFont?.status).toBe('loaded');
    expect(badFont?.status).toBe('failed');
    expect(badFont?.error).toMatch(/Network error/);
    // Overall error is null (metadata fetch succeeded)
    expect(result.current.error).toBeNull();
  });

  // ── test_cleanup_on_unmount_removes_font_from_document ───────────────────

  it('test_cleanup_on_unmount_removes_font_from_document: removes FontFace instances on unmount', async () => {
    const metadata = makeMetadata();
    const buffer = makeFakeBuffer();

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [metadata] });
    const fetchFontData = vi.fn().mockResolvedValue({
      dataBase64: bufferToBase64(buffer),
      format: 'ttf' as const,
      mimeType: 'font/ttf',
    });
    const cache = makeEmptyCache();

    const { unmount } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        cache,
      }),
    );

    await waitFor(() => expect(fontFaceSet._fonts.size).toBeGreaterThan(0));

    const sizeBeforeUnmount = fontFaceSet._fonts.size;
    expect(sizeBeforeUnmount).toBeGreaterThan(0);

    unmount();

    // After unmount, all registered FontFaces should be removed
    expect(fontFaceSet._fonts.size).toBe(0);
  });

  // ── test_resolves_pdf_font_name_with_subset_prefix ───────────────────────

  it('test_resolves_pdf_font_name_with_subset_prefix: getFontFaceName resolves by exact originalName', async () => {
    const originalName = 'ABCDEF+Calibri';
    const metadata = makeMetadata({ fontId: 'font-subset', originalName });

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [metadata] });
    const fetchFontData = vi.fn().mockResolvedValue({
      dataBase64: bufferToBase64(makeFakeBuffer()),
      format: 'ttf' as const,
      mimeType: 'font/ttf',
    });
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        cache,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const resolved = result.current.getFontFaceName(originalName);
    expect(resolved).toBe(`gigapdf-${DOCUMENT_ID}-font-subset`);
  });

  // ── test_returns_null_for_non_embedded_fonts ─────────────────────────────

  it('test_returns_null_for_non_embedded_fonts: getFontFaceName returns null for non-embedded fonts', async () => {
    const metadata = makeMetadata({ fontId: 'font-system', isEmbedded: false });

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [metadata] });
    const fetchFontData = vi.fn();
    // No Google Fonts substitute either — the font ends up failed
    const fetchGoogleFont = vi.fn().mockResolvedValue({ found: false });
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        fetchGoogleFont,
        cache,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Non-embedded fonts without a Google substitute are marked failed
    const nonEmbeddedFont = result.current.fonts[0];
    expect(nonEmbeddedFont).toBeDefined();
    expect(nonEmbeddedFont?.status).toBe('failed');
    expect(nonEmbeddedFont?.error).toMatch(/no Google Fonts substitute/);
    // The Google fallback was attempted with the original PDF font name
    expect(fetchGoogleFont).toHaveBeenCalledWith(metadata.originalName);
    // fetchFontData was never called
    expect(fetchFontData).not.toHaveBeenCalled();
    // getFontFaceName returns null (not loaded)
    const resolved = result.current.getFontFaceName(metadata.originalName);
    expect(resolved).toBeNull();
  });

  // ── Variant-aware resolution (gras parasite / wrong-metrics fix) ─────────

  it('variant-aware: resolves the subset matching the requested bold/italic, not the first-loaded one', async () => {
    // A PDF embeds four Times New Roman subsets. The backend collapses each
    // subset's `fontFamily` to the bare "Times New Roman" (real behaviour), so a
    // loose match on family would always return the FIRST subset (here the BOLD
    // one) whatever the run's weight — the "gras parasite" + wrong-metrics bug.
    // Passing the run's variant must pick the subset whose weight-bearing name
    // matches that intent.
    const subsets = [
      { fontId: 'f-bold', originalName: 'AAAAAB+TimesNewRomanPS-BoldMT' },
      { fontId: 'f-regular', originalName: 'AAAAAC+TimesNewRomanPSMT' },
      { fontId: 'f-italic', originalName: 'AAAAAP+TimesNewRoman,Italic' },
      { fontId: 'f-bolditalic', originalName: 'AAAAAQ+TimesNewRoman,BoldItalic' },
    ].map((s) => ({
      fontId: s.fontId,
      originalName: s.originalName,
      // Distinct PostScript name carries the weight/style; family is collapsed.
      postscriptName: s.originalName.replace(/^[A-Z]{6}\+/, ''),
      fontFamily: 'Times New Roman',
      subtype: 'CIDFontType0',
      isEmbedded: true,
      isSubset: true,
      format: 'cff' as const,
      sizeBytes: 12345,
    }));

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: subsets });
    const fetchFontData = vi.fn().mockResolvedValue({
      dataBase64: bufferToBase64(makeFakeBuffer()),
      format: 'cff' as const,
      mimeType: 'font/otf',
    });
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({ documentId: DOCUMENT_ID, fetchFontList, fetchFontData, cache }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() =>
      expect(result.current.fonts.every((f) => f.status === 'loaded')).toBe(true),
    );

    const name = (id: string) => `gigapdf-${DOCUMENT_ID}-${id}`;
    // Each weight/style intent resolves to its OWN subset.
    expect(result.current.getFontFaceName('Times New Roman', { bold: false, italic: false })).toBe(
      name('f-regular'),
    );
    expect(result.current.getFontFaceName('Times New Roman', { bold: true, italic: false })).toBe(
      name('f-bold'),
    );
    expect(result.current.getFontFaceName('Times New Roman', { bold: false, italic: true })).toBe(
      name('f-italic'),
    );
    expect(result.current.getFontFaceName('Times New Roman', { bold: true, italic: true })).toBe(
      name('f-bolditalic'),
    );
    // No variant → loose first-subset (unchanged legacy behaviour).
    expect(result.current.getFontFaceName('Times New Roman')).toBe(name('f-bold'));
    // A requested family/variant with no matching subset → null (the caller then
    // falls back to its loose 1-arg call + synthetic weight). "Helvetica Bold" is
    // not among the embedded Times subsets.
    expect(
      result.current.getFontFaceName('Helvetica', { bold: true, italic: false }),
    ).toBeNull();
  });

  // ── Google Fonts fallback ────────────────────────────────────────────────

  it('google_fallback: loads a non-embedded font from the Google Fonts proxy', async () => {
    const metadata = makeMetadata({
      fontId: 'font-google',
      originalName: 'Roboto-Bold',
      isEmbedded: false,
    });

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [metadata] });
    const fetchFontData = vi.fn();
    const fetchGoogleFont = vi.fn().mockResolvedValue(makeGoogleHit({ weight: 700 }));
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        fetchGoogleFont,
        cache,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The proxy was queried with the raw PDF font name, never the extractor
    expect(fetchGoogleFont).toHaveBeenCalledWith(metadata.originalName);
    expect(fetchFontData).not.toHaveBeenCalled();

    const font = result.current.fonts[0];
    expect(font).toBeDefined();
    expect(font?.status).toBe('loaded');
    expect(font?.error).toBeUndefined();
    // Same conventional CSS name as embedded fonts — getFontFaceName resolves it
    expect(result.current.getFontFaceName(metadata.originalName)).toBe(
      `gigapdf-${DOCUMENT_ID}-font-google`,
    );

    // Cached with Google provenance + descriptors for identical re-registration
    const setCalls = (cache.set as ReturnType<typeof vi.fn>).mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);
    expect(setCalls[0]?.[0]).toBe(DOCUMENT_ID);
    expect(setCalls[0]?.[1]).toBe('font-google');
    expect(setCalls[0]?.[4]).toEqual({ source: 'google', weight: 700, style: 'normal' });
  });

  it('google_fallback: tries Google Fonts when embedded font bytes cannot be fetched', async () => {
    const metadata = makeMetadata({ fontId: 'font-not-extractable', originalName: 'OpenSans' });

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [metadata] });
    // Backend cannot extract the bytes (e.g. 404 "not extractable")
    const fetchFontData = vi
      .fn()
      .mockRejectedValue(new Error('Failed to fetch font data: HTTP 404'));
    const fetchGoogleFont = vi.fn().mockResolvedValue(makeGoogleHit());
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        fetchGoogleFont,
        cache,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The extractor was attempted first, then the Google fallback rescued it
    expect(fetchFontData).toHaveBeenCalledWith(DOCUMENT_ID, metadata.fontId);
    expect(fetchGoogleFont).toHaveBeenCalledWith(metadata.originalName);

    const font = result.current.fonts[0];
    expect(font).toBeDefined();
    expect(font?.status).toBe('loaded');
  });

  it('google_fallback: consults the IndexedDB cache before hitting the network', async () => {
    const metadata = makeMetadata({ fontId: 'font-cached-google', isEmbedded: false });
    const buffer = makeFakeBuffer();

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [metadata] });
    const fetchFontData = vi.fn();
    const fetchGoogleFont = vi.fn();
    // Bytes already cached from a previous Google download
    const cache = makePopulatedCache(buffer, { source: 'google', weight: 700, style: 'italic' });

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        fetchGoogleFont,
        cache,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Bytes came from the cache — no network call at all
    expect(fetchGoogleFont).not.toHaveBeenCalled();
    expect(fetchFontData).not.toHaveBeenCalled();

    const font = result.current.fonts[0];
    expect(font).toBeDefined();
    expect(font?.status).toBe('loaded');
  });

  it('google_fallback: marks the font failed on Google proxy network error', async () => {
    const metadata = makeMetadata({ fontId: 'font-google-down', isEmbedded: false });

    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [metadata] });
    const fetchFontData = vi.fn();
    const fetchGoogleFont = vi
      .fn()
      .mockRejectedValue(new Error('Failed to fetch Google font: HTTP 503'));
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        fetchGoogleFont,
        cache,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Network error resolves to failed (CSS fallback) — never an uncaught throw
    const font = result.current.fonts[0];
    expect(font).toBeDefined();
    expect(font?.status).toBe('failed');
    expect(font?.error).toMatch(/Google Fonts fallback failed/);
    expect(result.current.error).toBeNull();
  });

  // ── Additional: disabled when feature flag is off ────────────────────────

  it('returns empty state when feature flag is disabled', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_FONT_DYNAMIC_LOAD', 'false');

    const fetchFontList = vi.fn();
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        cache,
      }),
    );

    // No loading initiated
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fonts).toHaveLength(0);
    expect(fetchFontList).not.toHaveBeenCalled();
  });

  // ── Additional: returns empty state when disabled prop is false ──────────

  it('returns empty state when enabled=false', async () => {
    const fetchFontList = vi.fn();
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        enabled: false,
        fetchFontList,
        cache,
      }),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fonts).toHaveLength(0);
    expect(fetchFontList).not.toHaveBeenCalled();
  });

  // ── Additional: metadata fetch error sets error state ───────────────────

  it('sets error state when font metadata fetch fails', async () => {
    const fetchFontList = vi.fn().mockRejectedValue(new Error('API unreachable'));
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        cache,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/API unreachable/);
    expect(result.current.fonts).toHaveLength(0);
  });

  // ── Additional: retry clears cache and reloads ───────────────────────────

  it('retry: clears cache entry and retries the failed font', async () => {
    const metadata = makeMetadata({ fontId: 'font-retry' });

    // First call fails, second call succeeds
    let callCount = 0;
    const fetchFontList = vi.fn().mockResolvedValue({ fonts: [metadata] });
    const fetchFontData = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('Timeout'));
      return Promise.resolve({
        dataBase64: bufferToBase64(makeFakeBuffer()),
        format: 'ttf' as const,
        mimeType: 'font/ttf',
      });
    });
    // Google fallback misses so the first attempt deterministically fails
    const fetchGoogleFont = vi.fn().mockResolvedValue({ found: false });
    const cache = makeEmptyCache();

    const { result } = renderHook(() =>
      useEmbeddedFonts({
        documentId: DOCUMENT_ID,
        fetchFontList,
        fetchFontData,
        fetchGoogleFont,
        cache,
      }),
    );

    await waitFor(() => {
      const font = result.current.fonts.find((f) => f.metadata.fontId === 'font-retry');
      expect(font).toBeDefined();
      expect(font?.status).toBe('failed');
    });

    await act(async () => {
      await result.current.retry('font-retry');
    });

    await waitFor(() => {
      const font = result.current.fonts.find((f) => f.metadata.fontId === 'font-retry');
      expect(font).toBeDefined();
      expect(font?.status).toBe('loaded');
    });

    expect(cache.delete).toHaveBeenCalledWith(DOCUMENT_ID, 'font-retry');
  });
});
