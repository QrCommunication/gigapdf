/**
 * Security headers (WID-04 / OWASP-A05), served by Next for every route.
 *
 * Next is the only source of these headers: the nginx site template on the
 * Ploi host used to add its own X-Frame-Options/X-XSS-Protection/nosniff,
 * which duplicated (and contradicted) the ones below. deploy/ploi/
 * install-nginx-routing.sh removes them on every deploy.
 *
 * Rule order matters: when two rules match a path and set the same key, Next
 * keeps the LAST one. The strict rule therefore excludes /embed explicitly;
 * matching "/:path*" there used to override the embed CSP with
 * `frame-ancestors 'none'` and add X-Frame-Options: DENY, so the widget could
 * not be framed by any third-party site.
 */

// API calls are proxied through Next.js rewrites (/backend-api/* → Python),
// so connect-src only needs 'self' for HTTP calls. WebSocket in production
// goes through wss://giga-pdf.com (same-origin reverse proxy), allowed
// explicitly for clarity. cdn.giga-pdf.com hosts the embeddable widget script
// loaded by third-party sites, not by the app itself.
const CONNECT_SRC = "connect-src 'self' wss://giga-pdf.com https://giga-pdf.com;";

// Embed routes (/embed/*) are loaded inside third-party iframes:
// frame-ancestors must be permissive and X-Frame-Options omitted (it cannot
// express "any origin"; CSP frame-ancestors supersedes it anyway).
const CSP_EMBED = [
  "frame-ancestors *",
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.giga-pdf.com",
  CONNECT_SRC,
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  // blob: required for embedded PDF fonts loaded via FontFace.
  "font-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

// All other routes: strict policy.
// - script-src 'unsafe-eval' is required by the PDF.js worker (WASM eval).
// - style-src 'unsafe-inline' is required by Tailwind CSS runtime and
//   third-party UI libraries that inject inline styles.
// - font-src includes blob: so the editor can register the PDF's embedded
//   TTF/OTF programs as FontFace instances. Without it the browser blocks
//   `new FontFace(name, blobUrl)` and every text run silently falls back
//   to the system Helvetica/Arial.
// - frame-ancestors 'none' blocks all embedding (clickjacking protection).
// - form-action includes accounts.google.com for Google OAuth redirects.
const CSP_DEFAULT = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: blob:",
  CONNECT_SRC,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

// HSTS: 1 year, include subdomains.
const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), interest-cohort=()";

export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

export const SECURITY_HEADER_RULES: HeaderRule[] = [
  {
    // Embed widget routes: framable by any site, no X-Frame-Options.
    // Same transport and feature policies as the rest of the site.
    source: "/embed/:path*",
    headers: [
      { key: "Content-Security-Policy", value: CSP_EMBED },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: STRICT_TRANSPORT_SECURITY },
      { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    ],
  },
  {
    // Every other route (the lookahead keeps /embed and /embed/* out, while
    // /embedded-like paths stay strict).
    source: "/:path((?!embed(?:/|$)).*)",
    headers: [
      { key: "Content-Security-Policy", value: CSP_DEFAULT },
      // Defence in depth for browsers without CSP frame-ancestors.
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: STRICT_TRANSPORT_SECURITY },
      { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    ],
  },
];
