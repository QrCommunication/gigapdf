/**
 * Google Fonts resolution + download (server-side).
 *
 * Two responsibilities:
 *  1. `parsePostScriptName()` — pure parser turning a PDF BaseFont /
 *     PostScript name ("ABCDEF+Montserrat-SemiBoldItalic") into Google
 *     Fonts lookup candidates + weight + italic flags.
 *  2. `downloadGoogleFont()` — resolves a family against the Google Fonts
 *     css2 API and downloads the TTF variant, with a write-through
 *     `FontCachePort` (DB) cache and a module-level negative cache for
 *     unknown families.
 *
 * Network safety:
 *  - The css2 request is sent with a bare `User-Agent: Mozilla/5.0` so
 *    Google serves `format('truetype')` sources (modern UAs get woff2,
 *    which fontkit cannot embed).
 *  - The TTF URL is only accepted when it matches
 *    `https://fonts.gstatic.com/...` (host pinned by the parsing regex),
 *    so a tampered CSS body can never redirect the download elsewhere.
 *  - Every request carries an `AbortSignal.timeout()`; any network error
 *    resolves to `{ found: false }` — this module never throws.
 *
 * The engine stays DB-agnostic: persistence goes through the existing
 * `FontCachePort` (Prisma-backed in apps/web).
 */

import { createHash } from 'node:crypto';
import type { FontCachePort } from './font-cache-port';
import { engineLogger } from './logger';

// ─── parsePostScriptName ──────────────────────────────────────────────────────

export interface ParsedPostScriptName {
  /**
   * Family lookup candidates, most likely first. For camelCase names both
   * the spaced ("Open Sans") and the raw ("OpenSans") forms are produced.
   */
  familyCandidates: string[];
  /** CSS weight inferred from the name suffix (default 400). */
  weight: number;
  /** True when the name carries an Italic/Oblique marker. */
  italic: boolean;
}

/**
 * Weight descriptors peeled from the END of the name. Order matters:
 * longest tokens first so "SemiBold" never gets consumed as "Bold" and
 * "ExtraLight" never as "Light".
 */
const WEIGHT_TOKENS: ReadonlyArray<readonly [token: string, weight: number]> = [
  ['UltraLight', 200],
  ['ExtraLight', 200],
  ['UltraBold', 800],
  ['ExtraBold', 800],
  ['Hairline', 100],
  ['SemiBold', 600],
  ['DemiBold', 600],
  ['Regular', 400],
  ['Medium', 500],
  ['Light', 300],
  ['Black', 900],
  ['Heavy', 900],
  ['Bold', 700],
  ['Book', 400],
  ['Thin', 100],
] as const;

/** Style descriptors → italic. */
const STYLE_TOKENS: readonly string[] = ['Italic', 'Oblique'];

/**
 * Foundry/licensing suffixes that carry no family information
 * ("ArialMT", "FrutigerLT", "MinionPro", "HelveticaNeueLTStd"…).
 */
const NOISE_TOKENS: readonly string[] = ['Std', 'Pro', 'Com', 'MT', 'PS', 'LT'];

/**
 * Strips `token` from the end of `value` when it is a genuine suffix:
 * preceded by a separator ("Lato-Black") or by a camelCase boundary
 * ("ArialMT" — lowercase/digit followed by an uppercase token start).
 * The boundary requirement keeps family names like "Highlight" intact
 * (its trailing "light" is lowercase, so it is part of the word).
 *
 * Returns the value with the token and any trailing separators removed,
 * or null when the token does not strip.
 */
function peelTrailingToken(value: string, token: string): string | null {
  if (value.length <= token.length) return null;
  if (!value.toLowerCase().endsWith(token.toLowerCase())) return null;

  const tokenStart = value.length - token.length;
  const previousChar = value.charAt(tokenStart - 1);
  const tokenFirstChar = value.charAt(tokenStart);

  const isSeparated = /[-_,\s]/.test(previousChar);
  const isCamelBoundary =
    /[a-z0-9]/.test(previousChar) && /[A-Z]/.test(tokenFirstChar);
  if (!isSeparated && !isCamelBoundary) return null;

  return value.slice(0, tokenStart).replace(/[-_,\s]+$/, '');
}

/**
 * "OpenSans" → "Open Sans", "PTSans" → "PT Sans", "Exo2" → "Exo 2".
 * Separators ("-", "_", ",") become spaces; runs of spaces collapse.
 */
function camelCaseToSpaces(value: string): string {
  return value
    .replace(/[-_,]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses a PDF BaseFont / PostScript font name into Google Fonts lookup
 * inputs. Pure function — no I/O, no side effects, never throws.
 *
 * Steps:
 *  1. Strip the 6-letter subset prefix ("ABCDEF+") and any leading "/".
 *  2. Repeatedly peel style (Italic/Oblique), weight (Thin…Black) and
 *     foundry-noise (MT, PS, Std, Pro, LT, Com) descriptors from the end.
 *  3. The remainder is the family; candidates are the camelCase→spaced
 *     form first ("Open Sans"), then the raw form ("OpenSans"), deduped.
 *
 * The rightmost weight descriptor wins (it is the most specific in
 * PostScript naming: "Family-WeightStyle").
 */
export function parsePostScriptName(name: string): ParsedPostScriptName {
  let working = name
    .trim()
    .replace(/^\//, '')
    .replace(/^[A-Z]{6}\+/, '');

  let weight: number | null = null;
  let italic = false;

  // Peel descriptors from the end until the name stops shrinking.
  let peeled = true;
  while (peeled && working.length > 0) {
    peeled = false;

    for (const styleToken of STYLE_TOKENS) {
      const next = peelTrailingToken(working, styleToken);
      if (next !== null) {
        italic = true;
        working = next;
        peeled = true;
        break;
      }
    }
    if (peeled) continue;

    for (const [weightToken, weightValue] of WEIGHT_TOKENS) {
      const next = peelTrailingToken(working, weightToken);
      if (next !== null) {
        weight ??= weightValue;
        working = next;
        peeled = true;
        break;
      }
    }
    if (peeled) continue;

    for (const noiseToken of NOISE_TOKENS) {
      const next = peelTrailingToken(working, noiseToken);
      if (next !== null) {
        working = next;
        peeled = true;
        break;
      }
    }
  }

  const rawFamily = working.trim();
  const spacedFamily = camelCaseToSpaces(rawFamily);
  const familyCandidates = [
    ...new Set([spacedFamily, rawFamily].filter((c) => c.length > 0)),
  ];

  return { familyCandidates, weight: weight ?? 400, italic };
}

// ─── downloadGoogleFont ───────────────────────────────────────────────────────

export interface GoogleFontQuery {
  /** PostScript / BaseFont name, or a plain family name ("Roboto"). */
  name: string;
  /** Explicit CSS weight (100–900). Overrides the name-derived weight. */
  weight?: number;
  /** Explicit italic flag. Overrides the name-derived flag. */
  italic?: boolean;
}

export interface DownloadGoogleFontOptions {
  /** Write-through persistent cache (Prisma-backed in apps/web). */
  cache?: FontCachePort;
  /** Injectable fetch for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in milliseconds. Default 8000. */
  timeoutMs?: number;
}

export type GoogleFontResult =
  | { found: false }
  | {
      found: true;
      family: string;
      weight: number;
      style: 'normal' | 'italic';
      format: 'ttf';
      bytes: Uint8Array;
    };

const GOOGLE_FONTS_CSS_ENDPOINT = 'https://fonts.googleapis.com/css2';

/**
 * Bare UA: Google sniffs the User-Agent to decide the served format. A
 * minimal "Mozilla/5.0" (no engine tokens) gets `format('truetype')`,
 * which is exactly what fontkit/pdf-lib can embed.
 */
const SIMPLE_USER_AGENT = 'Mozilla/5.0';

const DEFAULT_TIMEOUT_MS = 8000;

const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Module-level negative cache: lowercase family → expiry epoch (ms).
 * Only genuine "family unknown to Google" outcomes are recorded —
 * transient network errors are never negative-cached.
 */
const negativeFamilyCache = new Map<string, number>();

/** Test helper — resets the module-level negative cache. */
export function clearGoogleFontsNegativeCache(): void {
  negativeFamilyCache.clear();
}

/**
 * Host-pinned TTF source matcher: the URL must live on fonts.gstatic.com,
 * so a hostile CSS body cannot point the download at an arbitrary host.
 */
const TRUETYPE_SRC_PATTERN =
  /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)\s*format\(['"]truetype['"]\)/i;

function extractTrueTypeUrl(css: string): string | null {
  const match = TRUETYPE_SRC_PATTERN.exec(css);
  return match?.[1] ?? null;
}

function buildFamilyParam(family: string): string {
  return encodeURIComponent(family).replace(/%20/g, '+');
}

function buildVariantCssUrl(family: string, weight: number, italic: boolean): string {
  const ital = italic ? 1 : 0;
  return `${GOOGLE_FONTS_CSS_ENDPOINT}?family=${buildFamilyParam(family)}:ital,wght@${ital},${weight}`;
}

function buildRegularCssUrl(family: string): string {
  return `${GOOGLE_FONTS_CSS_ENDPOINT}?family=${buildFamilyParam(family)}`;
}

function normalizeWeight(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(900, Math.max(100, Math.round(value)));
}

/** Cache key contract: sha256 of `google-fonts:{family}:{weight}:{style}`. */
function buildCacheKey(
  family: string,
  weight: number,
  style: 'normal' | 'italic',
): string {
  return createHash('sha256')
    .update(`google-fonts:${family}:${weight}:${style}`)
    .digest('hex');
}

type FetchTextOutcome =
  | { kind: 'ok'; body: string }
  | { kind: 'http'; status: number }
  | { kind: 'error' };

async function fetchText(
  fetchImpl: typeof fetch,
  timeoutMs: number,
  url: string,
): Promise<FetchTextOutcome> {
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': SIMPLE_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!response.ok) return { kind: 'http', status: response.status };
    return { kind: 'ok', body: await response.text() };
  } catch {
    return { kind: 'error' };
  }
}

async function fetchBytes(
  fetchImpl: typeof fetch,
  timeoutMs: number,
  url: string,
): Promise<Uint8Array | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': SIMPLE_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}

type CssAttempt =
  | { kind: 'css'; css: string; servedWeight: number; servedStyle: 'normal' | 'italic' }
  | { kind: 'not-found' }
  | { kind: 'error' };

/**
 * Fetches the css2 stylesheet for the requested variant. On a 400 (axis
 * combination or family rejected) it retries the bare `?family={Family}`
 * URL: success there means the family exists and Google served the
 * regular (400 / normal) variant instead.
 */
async function fetchVariantCss(
  fetchImpl: typeof fetch,
  timeoutMs: number,
  family: string,
  weight: number,
  italic: boolean,
): Promise<CssAttempt> {
  const primary = await fetchText(
    fetchImpl,
    timeoutMs,
    buildVariantCssUrl(family, weight, italic),
  );
  if (primary.kind === 'ok') {
    return {
      kind: 'css',
      css: primary.body,
      servedWeight: weight,
      servedStyle: italic ? 'italic' : 'normal',
    };
  }
  if (primary.kind === 'error') return { kind: 'error' };
  if (primary.status === 404) return { kind: 'not-found' };
  if (primary.status !== 400) return { kind: 'error' };

  const fallback = await fetchText(fetchImpl, timeoutMs, buildRegularCssUrl(family));
  if (fallback.kind === 'ok') {
    return { kind: 'css', css: fallback.body, servedWeight: 400, servedStyle: 'normal' };
  }
  if (fallback.kind === 'http' && (fallback.status === 400 || fallback.status === 404)) {
    // Even the bare family URL is rejected → the family is unknown to Google.
    return { kind: 'not-found' };
  }
  return { kind: 'error' };
}

/**
 * Resolves a font against Google Fonts and downloads its TTF bytes.
 *
 * Resolution order, for each family candidate derived from `query.name`:
 *  1. Negative cache (module-level, TTL 1h) — skip known-unknown families.
 *  2. `FontCachePort.get()` on sha256("google-fonts:{family}:{weight}:{style}").
 *  3. css2 fetch (variant URL, then bare-family fallback on 400) → parse the
 *     `format('truetype')` source → download from fonts.gstatic.com.
 *  4. Write-through `FontCachePort.set()` under the SERVED variant key.
 *
 * Never throws: any network/cache failure degrades to `{ found: false }`
 * (transient errors) or the next candidate.
 */
export async function downloadGoogleFont(
  query: GoogleFontQuery,
  opts?: DownloadGoogleFontOptions,
): Promise<GoogleFontResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cache = opts?.cache;

  const parsed = parsePostScriptName(query.name);
  if (parsed.familyCandidates.length === 0) return { found: false };

  const weight = normalizeWeight(query.weight, parsed.weight);
  const italic = query.italic ?? parsed.italic;
  const style: 'normal' | 'italic' = italic ? 'italic' : 'normal';

  for (const family of parsed.familyCandidates) {
    const negativeKey = family.toLowerCase();
    const expiry = negativeFamilyCache.get(negativeKey);
    if (expiry !== undefined) {
      if (expiry > Date.now()) continue;
      negativeFamilyCache.delete(negativeKey);
    }

    if (cache) {
      try {
        const hit = await cache.get(buildCacheKey(family, weight, style));
        if (hit && hit.byteLength > 0) {
          engineLogger.debug('Google Fonts cache HIT (DB)', {
            name: query.name,
            family,
            weight,
            style,
          });
          return { found: true, family, weight, style, format: 'ttf', bytes: hit };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        engineLogger.warn('Google Fonts cache lookup failed, on continue sans', {
          name: query.name,
          family,
          error: message,
        });
      }
    }

    const attempt = await fetchVariantCss(fetchImpl, timeoutMs, family, weight, italic);
    if (attempt.kind === 'not-found') {
      negativeFamilyCache.set(negativeKey, Date.now() + NEGATIVE_CACHE_TTL_MS);
      continue;
    }
    if (attempt.kind === 'error') {
      // Transient (timeout, DNS, 5xx) — try the next candidate but never
      // negative-cache: the family may exist.
      continue;
    }

    const ttfUrl = extractTrueTypeUrl(attempt.css);
    if (ttfUrl === null) {
      engineLogger.warn('Google Fonts CSS sans source truetype, candidat ignoré', {
        name: query.name,
        family,
      });
      continue;
    }

    const bytes = await fetchBytes(fetchImpl, timeoutMs, ttfUrl);
    if (bytes === null) continue;

    if (cache) {
      try {
        await cache.set(
          buildCacheKey(family, attempt.servedWeight, attempt.servedStyle),
          bytes,
          {
            family,
            postscriptName: query.name,
            source: 'google-fonts',
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        engineLogger.warn('Google Fonts cache write failed (best-effort)', {
          name: query.name,
          family,
          error: message,
        });
      }
    }

    engineLogger.info('Police téléchargée depuis Google Fonts', {
      name: query.name,
      family,
      weight: attempt.servedWeight,
      style: attempt.servedStyle,
      byteLength: bytes.byteLength,
    });

    return {
      found: true,
      family,
      weight: attempt.servedWeight,
      style: attempt.servedStyle,
      format: 'ttf',
      bytes,
    };
  }

  return { found: false };
}
