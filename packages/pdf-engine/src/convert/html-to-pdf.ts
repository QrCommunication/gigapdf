/**
 * HTML / URL → PDF conversion, powered entirely by the in-house zero-dependency
 * engine (`@qrcommunication/gigapdf-lib`). No headless browser.
 *
 * The engine is a zero-network WASM module, so external resources are fetched by
 * the host in a two-phase protocol:
 *   1. `giga.htmlNeededResources(html)` returns the external fonts + images the
 *      document references (it never touches the network itself).
 *   2. The host fetches each one (Node `fetch`) — every URL passes an SSRF guard
 *      first — and hands the bytes back to `giga.htmlRenderWith(html, fonts,
 *      { resources })`, which lays out block/inline/flex/table content with
 *      pagination and embeds the real fonts/images.
 *
 * Security — SSRF (OWASP A10): the engine surfacing every URL up-front makes the
 * fetch list auditable. `isBlockedFetchUrl` blocks non-http(s) and bare
 * private/reserved IP literals on EVERY host fetch (baseline, both HTML and URL
 * modes), redirects are followed manually so each hop is re-checked, and callers
 * may inject a stricter `shouldBlockRequest` predicate (the route handler injects
 * its DNS-aware guard for URL mode). Google-fonts downloads are host-pinned to
 * `fonts.gstatic.com`, so they need no per-URL guard.
 */

import { PDFEngineError } from '../errors';
import { getEngine } from '../wasm';
import { downloadGoogleFont } from '../utils/google-fonts';
import type { FontCachePort } from '../utils/font-cache-port';
import type {
  HtmlFont,
  HtmlResource,
  HtmlResourceNeed,
  HtmlRenderOptions,
} from '@qrcommunication/gigapdf-lib';

export interface ConvertOptions {
  format?: 'A4' | 'Letter' | 'Legal' | 'Tabloid';
  landscape?: boolean;
  margin?:
    | string
    | {
        top?: string;
        right?: string;
        bottom?: string;
        left?: string;
      };
  /**
   * Kept for API compatibility. The engine always paints CSS backgrounds, which
   * matches the previous default (`printBackground: true`); `false` is a no-op.
   */
  printBackground?: boolean;
  /** Kept for API compatibility. Content scaling is not applied by the engine. */
  scale?: number;
  /** Explicit page width (CSS length, e.g. "210mm"); overrides `format`. */
  width?: string;
  /** Explicit page height (CSS length); overrides `format`. */
  height?: string;
  /**
   * Kept for API compatibility. External resources are fetched explicitly
   * up-front, so there is no network-idle wait to configure.
   */
  waitForNetworkIdle?: boolean;
  /** Per-resource fetch timeout in milliseconds (default 30 000). */
  timeout?: number;
  /** Extra CSS appended to the document before layout (overrides earlier rules). */
  customCSS?: string;
  /** Extra HTTP headers sent with the URL fetch (URL mode). */
  headers?: Record<string, string>;
  /** Optional Google-Fonts download cache (Prisma-backed in apps/web). */
  fontCache?: FontCachePort;
  /** Injectable fetch — mainly for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** Per external image cap — keeps a hostile document from exhausting memory. */
const MAX_RESOURCE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DEFAULT_MARGIN_PT = cssLengthToPoints('20mm', 56.7);

// ── SSRF baseline (defense in depth; the route layer adds DNS-aware checks) ────

const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^224\./,
  /^240\./,
  /^255\.255\.255\.255$/,
] as const;

const PRIVATE_IPV6 = [/^::1$/i, /^fc/i, /^fd/i, /^fe80:/i, /^::ffff:/i, /^64:ff9b:/i] as const;

/**
 * Blocks a URL from being fetched server-side: anything not http(s), or whose
 * hostname is a bare private/reserved IP literal. Hostnames that *resolve* to a
 * private IP are caught by the route's DNS pre-flight; this is the package-level
 * baseline so the engine is safe even when no external guard is injected.
 *
 * Exported so other host-side fetch surfaces driven by URLs the engine extracts
 * from untrusted input (e.g. the OCSP/CRL responder URLs the PAdES-LTV signer
 * reads from a user-supplied certificate's AIA/CRL-DP extensions — see
 * `sign/pdf-sign.ts`) reuse the SAME baseline guard rather than re-deriving the
 * private/reserved IP ranges.
 */
export function isBlockedFetchUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  const host = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host.includes(':')) return PRIVATE_IPV6.some((re) => re.test(host));
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return PRIVATE_IPV4.some((re) => re.test(host));
  return false;
}

// ── CSS length → points ───────────────────────────────────────────────────────

/**
 * Converts a CSS length ("20mm", "1in", "96px", "72pt", bare number = px) to
 * PDF points. Unknown/blank input falls back to `fallbackPt`.
 */
function cssLengthToPoints(value: string | undefined, fallbackPt: number): number {
  if (!value) return fallbackPt;
  const m = /^\s*(-?\d*\.?\d+)\s*(mm|cm|in|pt|pc|px)?\s*$/i.exec(value);
  if (!m) return fallbackPt;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return fallbackPt;
  switch ((m[2] ?? 'px').toLowerCase()) {
    case 'in':
      return n * 72;
    case 'cm':
      return n * 28.3464567;
    case 'mm':
      return n * 2.83464567;
    case 'pc':
      return n * 12;
    case 'pt':
      return n;
    default:
      return n * 0.75; // px → pt at 96dpi
  }
}

function resolveMargins(margin: ConvertOptions['margin']): HtmlRenderOptions['margin'] {
  if (margin === undefined) return DEFAULT_MARGIN_PT;
  if (typeof margin === 'string') return cssLengthToPoints(margin, DEFAULT_MARGIN_PT);
  return {
    top: cssLengthToPoints(margin.top, DEFAULT_MARGIN_PT),
    right: cssLengthToPoints(margin.right, DEFAULT_MARGIN_PT),
    bottom: cssLengthToPoints(margin.bottom, DEFAULT_MARGIN_PT),
    left: cssLengthToPoints(margin.left, DEFAULT_MARGIN_PT),
  };
}

// ── host fetch (manual redirect following + per-hop SSRF guard + size cap) ─────

interface FetchOptions {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  headers?: Record<string, string>;
  shouldBlock?: (url: string) => boolean;
}

/**
 * Fetches a URL to bytes, following redirects manually so the SSRF guard runs on
 * every hop. Returns `null` on any block, network error, non-2xx, empty body,
 * over-size response, or redirect overflow — callers degrade gracefully (an
 * image that cannot be fetched is simply omitted from the render).
 */
async function safeFetchBytes(url: string, opts: FetchOptions): Promise<Uint8Array | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (isBlockedFetchUrl(current) || opts.shouldBlock?.(current)) return null;
    let res: Response;
    try {
      res = await opts.fetchImpl(current, {
        redirect: 'manual',
        headers: opts.headers,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      try {
        current = new URL(loc, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESOURCE_BYTES) return null;
    return bytes;
  }
  return null;
}

// ── phase 1+2 orchestration ───────────────────────────────────────────────────

interface FetchedResources {
  fonts: HtmlFont[];
  resources: HtmlResource[];
}

/**
 * Resolves the engine's resource needs: Google fonts via the host-pinned
 * `downloadGoogleFont` (with the optional DB cache), external images via
 * `safeFetchBytes`. Independent fetches run concurrently; any failure drops that
 * single resource (the engine falls back to a bundled font / omits the image).
 */
async function fetchResources(
  needs: HtmlResourceNeed[],
  options: ConvertOptions,
  shouldBlock?: (url: string) => boolean,
): Promise<FetchedResources> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;

  const fontJobs: Promise<HtmlFont | null>[] = [];
  const imageJobs: Promise<HtmlResource | null>[] = [];

  for (const need of needs) {
    if (need.kind === 'font') {
      fontJobs.push(
        downloadGoogleFont(
          { name: need.family, weight: need.weight, italic: need.italic },
          { cache: options.fontCache, fetchImpl, timeoutMs },
        ).then((r) =>
          r.found
            ? { family: need.family, weight: need.weight, italic: need.italic, ttf: r.bytes }
            : null,
        ),
      );
    } else {
      const url = need.url;
      imageJobs.push(
        safeFetchBytes(url, { fetchImpl, timeoutMs, shouldBlock }).then((bytes) =>
          bytes ? { url, bytes } : null,
        ),
      );
    }
  }

  const [fonts, resources] = await Promise.all([
    Promise.all(fontJobs),
    Promise.all(imageJobs),
  ]);

  return {
    fonts: fonts.filter((f): f is HtmlFont => f !== null),
    resources: resources.filter((r): r is HtmlResource => r !== null),
  };
}

function buildRenderOptions(
  giga: Awaited<ReturnType<typeof getEngine>>,
  options: ConvertOptions,
  resources: HtmlResource[],
): HtmlRenderOptions {
  // Explicit width/height (CSS lengths) win over the named format.
  let pageWidth: number;
  let pageHeight: number;
  if (options.width && options.height) {
    pageWidth = cssLengthToPoints(options.width, 612);
    pageHeight = cssLengthToPoints(options.height, 792);
  } else {
    const size = giga.pageSize(options.format ?? 'A4') ?? { w: 595.28, h: 841.89 };
    pageWidth = size.w;
    pageHeight = size.h;
  }
  if (options.landscape && pageWidth < pageHeight) {
    [pageWidth, pageHeight] = [pageHeight, pageWidth];
  }

  return {
    pageWidth,
    pageHeight,
    margin: resolveMargins(options.margin),
    resources,
  };
}

/**
 * Appends the caller's custom CSS so its rules win on source order, then runs the
 * two-phase render. `shouldBlock` (when provided) guards every external fetch in
 * addition to the built-in baseline.
 */
async function renderHtml(
  html: string,
  options: ConvertOptions,
  shouldBlock?: (url: string) => boolean,
): Promise<Buffer> {
  const giga = await getEngine();

  const document = options.customCSS
    ? `${html}\n<style>${options.customCSS}</style>`
    : html;

  const needs = giga.htmlNeededResources(document);
  const { fonts, resources } = await fetchResources(needs, options, shouldBlock);

  const pdf = giga.htmlRenderWith(document, fonts, buildRenderOptions(giga, options, resources));
  return Buffer.from(pdf);
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Renders an HTML string to a PDF buffer using the in-house engine. External
 * `<img>`/font references are fetched host-side through the SSRF baseline guard.
 */
export async function htmlToPDF(html: string, options: ConvertOptions = {}): Promise<Buffer> {
  return renderHtml(html, options);
}

/**
 * Fetches a URL's HTML and renders it to a PDF buffer. The page and all of its
 * sub-resources go through the SSRF baseline guard; the route handler performs an
 * additional DNS pre-flight on the page URL before calling this.
 */
export async function urlToPDF(url: string, options: ConvertOptions = {}): Promise<Buffer> {
  return fetchAndRender(url, options);
}

export interface UrlToPDFSafeOptions extends ConvertOptions {
  /**
   * Called for every URL about to be fetched (the page, each redirect hop, and
   * every external resource). Return `true` to block it. Used by the route
   * handler to enforce its DNS-aware SSRF policy on top of the baseline guard.
   */
  shouldBlockRequest?: (requestUrl: string) => boolean;
}

/**
 * Like {@link urlToPDF} but threads a caller `shouldBlockRequest` predicate
 * through every host fetch — the page, redirect hops, and sub-resources — for
 * SSRF prevention beyond the built-in baseline.
 */
export async function urlToPDFSafe(url: string, options: UrlToPDFSafeOptions = {}): Promise<Buffer> {
  return fetchAndRender(url, options, options.shouldBlockRequest);
}

async function fetchAndRender(
  url: string,
  options: ConvertOptions,
  shouldBlock?: (url: string) => boolean,
): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PDFEngineError(
      `Invalid URL protocol: ${parsed.protocol}. Only http and https are allowed.`,
      'PDF_CONVERT_INVALID_URL',
    );
  }

  const bytes = await safeFetchBytes(url, {
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeout ?? DEFAULT_TIMEOUT_MS,
    headers: options.headers,
    shouldBlock,
  });
  if (bytes === null) {
    throw new PDFEngineError(`Failed to load URL: ${url}`, 'PDF_CONVERT_URL_FAILED');
  }

  const html = new TextDecoder('utf-8').decode(bytes);
  return renderHtml(html, options, shouldBlock);
}
