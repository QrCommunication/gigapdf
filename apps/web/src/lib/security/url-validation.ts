/**
 * URL validation utilities for SSRF prevention.
 *
 * Blocks requests to private/link-local/loopback IP ranges to prevent
 * Server-Side Request Forgery (SSRF) attacks — OWASP A10:2021.
 *
 * Reference ranges:
 *   RFC 1918  — 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   RFC 3927  — 169.254.0.0/16 (link-local, cloud metadata servers)
 *   RFC 5735  — 127.0.0.0/8 (loopback)
 *   RFC 4193  — fc00::/7 (IPv6 ULA)
 *   RFC 4291  — ::1 (IPv6 loopback), fe80::/10 (IPv6 link-local)
 */

import dns from 'node:dns/promises';
import { serverLogger } from '@/lib/server-logger';

// ---------------------------------------------------------------------------
// Private / reserved IP pattern matchers
// ---------------------------------------------------------------------------

const PRIVATE_IPV4_PATTERNS: ReadonlyArray<RegExp> = [
  /^127\./,                          // 127.0.0.0/8   — loopback
  /^10\./,                           // 10.0.0.0/8    — RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,     // 172.16.0.0/12 — RFC 1918
  /^192\.168\./,                     // 192.168.0.0/16 — RFC 1918
  /^169\.254\./,                     // 169.254.0.0/16 — link-local / metadata servers
  /^0\./,                            // 0.0.0.0/8     — "this" network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // 100.64.0.0/10 — shared address space
  /^192\.0\.2\./,                    // 192.0.2.0/24  — TEST-NET-1
  /^198\.5[12]\./,                   // 198.51.100.0/24 — TEST-NET-2
  /^203\.0\.113\./,                  // 203.0.113.0/24 — TEST-NET-3
  /^224\./,                          // 224.0.0.0/4   — multicast
  /^240\./,                          // 240.0.0.0/4   — reserved
  /^255\.255\.255\.255$/,            // broadcast
];

const PRIVATE_IPV6_PATTERNS: ReadonlyArray<RegExp> = [
  /^::1$/i,                          // ::1 — loopback
  /^fc/i,                            // fc00::/7 — ULA
  /^fd/i,                            // fd00::/8 — ULA (local)
  /^fe80:/i,                         // fe80::/10 — link-local
  /^::ffff:/i,                       // ::ffff:0:0/96 — IPv4-mapped (prevents bypass via IPv4-in-IPv6)
  /^64:ff9b:/i,                      // 64:ff9b::/96 — NAT64
];

/**
 * Returns true if the given IP address belongs to a private/reserved range.
 */
export function isPrivateIp(ip: string): boolean {
  // Strip IPv6 brackets if present
  const cleaned = ip.replace(/^\[/, '').replace(/\]$/, '');

  if (cleaned.includes(':')) {
    return PRIVATE_IPV6_PATTERNS.some((re) => re.test(cleaned));
  }
  return PRIVATE_IPV4_PATTERNS.some((re) => re.test(cleaned));
}

// ---------------------------------------------------------------------------
// Domain allowlist (opt-in via environment variable)
// ---------------------------------------------------------------------------

/**
 * Parses the URL_TO_PDF_DOMAIN_ALLOWLIST env var.
 * Format: comma-separated hostnames, e.g. "example.com,docs.acme.io"
 * Returns null when the variable is not set (= allow all public IPs).
 */
function getAllowlistedDomains(): ReadonlySet<string> | null {
  const raw = process.env['URL_TO_PDF_DOMAIN_ALLOWLIST'];
  if (!raw || raw.trim() === '') return null;

  const domains = raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  return domains.length > 0 ? new Set(domains) : null;
}

// ---------------------------------------------------------------------------
// Validation result type
// ---------------------------------------------------------------------------

export interface UrlValidationResult {
  ok: true;
  resolvedIps: string[];
}

export class SsrfBlockedError extends Error {
  constructor(
    message: string,
    public readonly blockedIp?: string,
  ) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Validates a URL before passing it to Playwright for PDF conversion.
 *
 * Checks performed (in order):
 *  1. URL must be parseable and use http/https protocol only
 *  2. Hostname must not be a bare IP in a private range
 *  3. If URL_TO_PDF_DOMAIN_ALLOWLIST is set, hostname must be listed
 *  4. DNS resolution of the hostname must not resolve to any private IP
 *
 * @throws {SsrfBlockedError} when a SSRF attempt is detected
 * @throws {Error} when the URL is malformed or protocol is invalid
 */
export async function validateUrlForPdfConversion(
  rawUrl: string,
): Promise<UrlValidationResult> {
  // --- Step 1: Parse + protocol check ---
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('url must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must use http or https protocol.');
  }

  const hostname = parsed.hostname.toLowerCase();

  // --- Step 2: Reject bare private IPs without DNS round-trip ---
  // This catches e.g. http://192.168.1.1/ or http://[::1]/ directly.
  if (isPrivateIp(hostname)) {
    serverLogger.warn('[SSRF-BLOCKED] Direct private IP in URL', {
      hostname,
      url: redactUrl(rawUrl),
    });
    throw new SsrfBlockedError(
      `Blocked: direct access to private/reserved IP "${hostname}" is not permitted.`,
      hostname,
    );
  }

  // --- Step 3: Allowlist check (opt-in) ---
  const allowlist = getAllowlistedDomains();
  if (allowlist !== null) {
    // Match the exact hostname OR any parent domain that is in the allowlist.
    // e.g. "docs.example.com" is allowed when allowlist has "example.com".
    const isAllowed = [...allowlist].some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
    );
    if (!isAllowed) {
      serverLogger.warn('[SSRF-BLOCKED] Domain not in allowlist', {
        hostname,
        url: redactUrl(rawUrl),
      });
      throw new SsrfBlockedError(
        `Blocked: domain "${hostname}" is not in the permitted domain allowlist.`,
      );
    }
  }

  // --- Step 4: DNS resolution — check all resolved IPs ---
  let resolvedIps: string[];
  try {
    // resolve4 + resolve6 to catch both address families.
    const [ipv4, ipv6] = await Promise.allSettled([
      dns.resolve4(hostname),
      dns.resolve6(hostname),
    ]);

    const addresses: string[] = [];
    if (ipv4.status === 'fulfilled') addresses.push(...ipv4.value);
    if (ipv6.status === 'fulfilled') addresses.push(...ipv6.value);

    // If neither resolved, try the generic resolver as fallback (handles
    // hostnames that only return CNAME/A records through the OS resolver).
    if (addresses.length === 0) {
      const fallback = await dns.resolve(hostname);
      addresses.push(...fallback);
    }

    resolvedIps = addresses;
  } catch (err) {
    // DNS failure — treat as unresolvable (not SSRF, just bad URL).
    serverLogger.warn('[PDF-CONVERT] DNS resolution failed', {
      hostname,
      url: redactUrl(rawUrl),
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(`Failed to resolve hostname "${hostname}". Please check the URL.`);
  }

  for (const ip of resolvedIps) {
    if (isPrivateIp(ip)) {
      serverLogger.warn('[SSRF-BLOCKED] Hostname resolves to private IP', {
        hostname,
        ip,
        url: redactUrl(rawUrl),
      });
      throw new SsrfBlockedError(
        `Blocked: "${hostname}" resolves to private/reserved IP "${ip}".`,
        ip,
      );
    }
  }

  return { ok: true, resolvedIps };
}

/**
 * Returns a URL string safe for logging (strips query params that may contain tokens).
 */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[unparseable-url]';
  }
}

// ---------------------------------------------------------------------------
// Playwright request interception helper
// ---------------------------------------------------------------------------

/**
 * Returns true when a Playwright request URL should be blocked.
 *
 * Used with page.route() to prevent SSRF via HTTP redirects:
 * the initial URL may resolve to a public IP but a redirect could
 * send Playwright to an internal address.
 */
export function shouldBlockPlaywrightRequest(requestUrl: string): boolean {
  try {
    const parsed = new URL(requestUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;

    const hostname = parsed.hostname.toLowerCase();
    return isPrivateIp(hostname);
  } catch {
    // Malformed URL — block it.
    return true;
  }
}
