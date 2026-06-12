import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  parsePostScriptName,
  downloadGoogleFont,
  clearGoogleFontsNegativeCache,
} from '../../src/utils/google-fonts';
import type {
  FontCachePort,
  FontCacheMeta,
} from '../../src/utils/font-cache-port';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256Of(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

interface MemoryCache {
  port: FontCachePort;
  store: Map<string, Uint8Array>;
  sets: Array<{ sha256: string; bytes: Uint8Array; meta: FontCacheMeta }>;
}

function createMemoryCache(initial?: Record<string, Uint8Array>): MemoryCache {
  const store = new Map<string, Uint8Array>(Object.entries(initial ?? {}));
  const sets: MemoryCache['sets'] = [];
  const port: FontCachePort = {
    get: async (sha256) => store.get(sha256) ?? null,
    set: async (sha256, bytes, meta) => {
      store.set(sha256, bytes);
      sets.push({ sha256, bytes, meta });
    },
  };
  return { port, store, sets };
}

const TTF_BYTES = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]);

function cssBodyFor(family: string): string {
  return [
    '/* latin */',
    '@font-face {',
    `  font-family: '${family}';`,
    '  font-style: normal;',
    '  font-weight: 700;',
    '  src: url(https://fonts.gstatic.com/s/test/v1/font-file.ttf) format(\'truetype\');',
    '}',
  ].join('\n');
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  clearGoogleFontsNegativeCache();
});

// ─── parsePostScriptName ──────────────────────────────────────────────────────

describe('parsePostScriptName', () => {
  it('parses a subset-prefixed compound weight + italic name', () => {
    expect(parsePostScriptName('ABCDEF+Montserrat-SemiBoldItalic')).toEqual({
      familyCandidates: ['Montserrat'],
      weight: 600,
      italic: true,
    });
  });

  it('parses "OpenSans-Bold" and produces spaced + raw family candidates', () => {
    expect(parsePostScriptName('OpenSans-Bold')).toEqual({
      familyCandidates: ['Open Sans', 'OpenSans'],
      weight: 700,
      italic: false,
    });
  });

  it('strips the "MT" foundry suffix from "ArialMT"', () => {
    expect(parsePostScriptName('ArialMT')).toEqual({
      familyCandidates: ['Arial'],
      weight: 400,
      italic: false,
    });
  });

  it('returns a plain family name unchanged with default weight', () => {
    expect(parsePostScriptName('Roboto')).toEqual({
      familyCandidates: ['Roboto'],
      weight: 400,
      italic: false,
    });
  });

  it('parses "Lato-BlackItalic" to weight 900 italic', () => {
    expect(parsePostScriptName('Lato-BlackItalic')).toEqual({
      familyCandidates: ['Lato'],
      weight: 900,
      italic: true,
    });
  });

  it('detects light variants and extra-light before light', () => {
    expect(parsePostScriptName('Lato-Light').weight).toBe(300);
    expect(parsePostScriptName('Inter-ExtraLight').weight).toBe(200);
    expect(parsePostScriptName('Inter-Thin').weight).toBe(100);
    expect(parsePostScriptName('Inter-ExtraBold').weight).toBe(800);
    expect(parsePostScriptName('Inter-Medium').weight).toBe(500);
  });

  it('treats "-Regular" and "Book" as weight 400 and strips them', () => {
    expect(parsePostScriptName('Montserrat-Regular')).toEqual({
      familyCandidates: ['Montserrat'],
      weight: 400,
      italic: false,
    });
    expect(parsePostScriptName('Gotham-Book')).toEqual({
      familyCandidates: ['Gotham'],
      weight: 400,
      italic: false,
    });
  });

  it('detects Oblique as italic', () => {
    expect(parsePostScriptName('Helvetica-Oblique').italic).toBe(true);
  });

  it('keeps lowercase-embedded token words intact (no false suffix strip)', () => {
    // "Highlight" ends with "light" but it is part of the word, not a suffix.
    expect(parsePostScriptName('Highlight').familyCandidates).toEqual(['Highlight']);
  });

  it('strips a leading slash from raw PDF names', () => {
    expect(parsePostScriptName('/HelveticaNeue-Bold').weight).toBe(700);
  });

  it('returns no candidates for an empty name', () => {
    expect(parsePostScriptName('')).toEqual({
      familyCandidates: [],
      weight: 400,
      italic: false,
    });
  });
});

// ─── downloadGoogleFont ───────────────────────────────────────────────────────

describe('downloadGoogleFont', () => {
  it('downloads the TTF for a known family and writes it through the cache', async () => {
    const cache = createMemoryCache();
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValueOnce(
      new Response(cssBodyFor('Open Sans'), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(new Response(TTF_BYTES, { status: 200 }));

    const result = await downloadGoogleFont(
      { name: 'OpenSans-Bold' },
      { cache: cache.port, fetchImpl: fetchMock as typeof fetch },
    );

    expect(result).toEqual({
      found: true,
      family: 'Open Sans',
      weight: 700,
      style: 'normal',
      format: 'ttf',
      bytes: TTF_BYTES,
    });

    // First request: css2 variant URL with the bare Mozilla UA.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [cssUrl, cssInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(cssUrl)).toBe(
      'https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,700',
    );
    expect(cssInit?.headers).toMatchObject({ 'User-Agent': 'Mozilla/5.0' });

    // Second request: the gstatic TTF source extracted from the CSS.
    const [ttfUrl] = fetchMock.mock.calls[1] ?? [];
    expect(String(ttfUrl)).toBe('https://fonts.gstatic.com/s/test/v1/font-file.ttf');

    // Write-through cache under sha256("google-fonts:{family}:{weight}:{style}").
    expect(cache.sets).toHaveLength(1);
    const written = cache.sets[0];
    expect(written?.sha256).toBe(sha256Of('google-fonts:Open Sans:700:normal'));
    expect(written?.bytes).toEqual(TTF_BYTES);
    expect(written?.meta).toEqual({
      family: 'Open Sans',
      postscriptName: 'OpenSans-Bold',
      source: 'google-fonts',
    });
  });

  it('returns the cached bytes without any network call on a cache hit', async () => {
    const key = sha256Of('google-fonts:Open Sans:700:normal');
    const cache = createMemoryCache({ [key]: TTF_BYTES });
    const fetchMock = vi.fn<FetchLike>();

    const result = await downloadGoogleFont(
      { name: 'OpenSans-Bold' },
      { cache: cache.port, fetchImpl: fetchMock as typeof fetch },
    );

    expect(result).toEqual({
      found: true,
      family: 'Open Sans',
      weight: 700,
      style: 'normal',
      format: 'ttf',
      bytes: TTF_BYTES,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the bare-family URL on 400 and serves regular 400/normal', async () => {
    const fetchMock = vi.fn<FetchLike>();
    fetchMock.mockResolvedValueOnce(new Response('bad axis', { status: 400 }));
    fetchMock.mockResolvedValueOnce(
      new Response(cssBodyFor('Roboto'), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(new Response(TTF_BYTES, { status: 200 }));

    const result = await downloadGoogleFont(
      { name: 'Roboto', weight: 350 },
      { fetchImpl: fetchMock as typeof fetch },
    );

    expect(result).toEqual({
      found: true,
      family: 'Roboto',
      weight: 400,
      style: 'normal',
      format: 'ttf',
      bytes: TTF_BYTES,
    });
    const [fallbackUrl] = fetchMock.mock.calls[1] ?? [];
    expect(String(fallbackUrl)).toBe('https://fonts.googleapis.com/css2?family=Roboto');
  });

  it('returns found:false for an unknown family and negative-caches it', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response('unknown family', { status: 400 }),
    );

    const first = await downloadGoogleFont(
      { name: 'OpenSans-Bold' },
      { fetchImpl: fetchMock as typeof fetch },
    );
    expect(first).toEqual({ found: false });
    // 2 candidates ("Open Sans", "OpenSans") × (variant URL + bare fallback).
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Second lookup: both families are negative-cached → zero network calls.
    const second = await downloadGoogleFont(
      { name: 'OpenSans-Bold' },
      { fetchImpl: fetchMock as typeof fetch },
    );
    expect(second).toEqual({ found: false });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns found:false when the request times out (never throws)', async () => {
    const hangingFetch: FetchLike = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const fail = (): void => {
          reject(
            signal.reason instanceof Error ? signal.reason : new Error('aborted'),
          );
        };
        if (signal.aborted) {
          fail();
          return;
        }
        signal.addEventListener('abort', fail, { once: true });
      });

    const result = await downloadGoogleFont(
      { name: 'Roboto' },
      { fetchImpl: hangingFetch as typeof fetch, timeoutMs: 30 },
    );

    expect(result).toEqual({ found: false });
  });

  it('does not negative-cache transient errors (retries on the next call)', async () => {
    const failingFetch = vi.fn<FetchLike>(async () => {
      throw new Error('ECONNRESET');
    });
    const first = await downloadGoogleFont(
      { name: 'Roboto' },
      { fetchImpl: failingFetch as typeof fetch },
    );
    expect(first).toEqual({ found: false });
    expect(failingFetch).toHaveBeenCalledTimes(1);

    // Network recovered: the family must be retried, not negative-cached.
    const recoveredFetch = vi.fn<FetchLike>();
    recoveredFetch.mockResolvedValueOnce(
      new Response(cssBodyFor('Roboto'), { status: 200 }),
    );
    recoveredFetch.mockResolvedValueOnce(new Response(TTF_BYTES, { status: 200 }));

    const second = await downloadGoogleFont(
      { name: 'Roboto' },
      { fetchImpl: recoveredFetch as typeof fetch },
    );
    expect(second.found).toBe(true);
  });

  it('ignores CSS bodies without a fonts.gstatic.com truetype source', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(
        "@font-face { src: url(https://evil.example.com/x.ttf) format('truetype'); }",
        { status: 200 },
      ),
    );

    const result = await downloadGoogleFont(
      { name: 'Roboto' },
      { fetchImpl: fetchMock as typeof fetch },
    );

    expect(result).toEqual({ found: false });
    // Only the CSS fetch happened — the non-gstatic URL was never downloaded.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
