import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// ---------------------------------------------------------------------------
// Security headers (WID-04 / OWASP-A05)
// ---------------------------------------------------------------------------
// API calls are proxied through Next.js rewrites (/backend-api/* → Python),
// so connect-src only needs 'self' for HTTP calls.
// WebSocket in production goes through wss://giga-pdf.com (same origin reverse
// proxy), but we also allow wss://giga-pdf.com explicitly for clarity.
// cdn.giga-pdf.com hosts the embeddable widget script loaded by third-party
// sites, not by the Next.js app itself — no script-src entry needed here.
// ---------------------------------------------------------------------------

const CONNECT_SRC =
  "connect-src 'self' wss://giga-pdf.com https://giga-pdf.com;";

// Embed routes (/embed/*) are loaded inside third-party iframes.
// frame-ancestors must be permissive (*) there, and X-Frame-Options must be
// omitted (it cannot be set to ALLOWALL in modern browsers — CSP wins).
const CSP_EMBED = [
  "frame-ancestors *",
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.giga-pdf.com",
  CONNECT_SRC,
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

// All other routes: strict policy.
// - script-src 'unsafe-eval' is required by the PDF.js worker (WASM eval).
// - style-src 'unsafe-inline' is required by Tailwind CSS runtime and
//   third-party UI libraries that inject inline styles.
// - frame-ancestors 'none' blocks all embedding (clickjacking protection).
// - form-action includes accounts.google.com for Google OAuth redirects.
const CSP_DEFAULT = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  CONNECT_SRC,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Hide the X-Powered-By: Next.js header to avoid exposing the stack.
  poweredByHeader: false,
  transpilePackages: ["@giga-pdf/ui", "@giga-pdf/types", "@giga-pdf/api"],
  // Exclude Node.js-only packages from client bundle
  serverExternalPackages: [
    "pg",
    "@prisma/adapter-pg",
    "@prisma/client",
    "nodemailer",
    // Keep pdfjs-dist external so Node resolves pdf.worker.mjs correctly
    // (Turbopack bundling breaks import.meta.url → createRequire resolution)
    "pdfjs-dist",
    "@giga-pdf/pdf-engine",
  ],
  // Force dynamic rendering to avoid SSG issues with client components
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Force pdfjs-dist worker file to be included in standalone bundle
  // (needed for server-side PDF parsing in /api/pdf/parse-from-s3)
  outputFileTracingIncludes: {
    "/api/pdf/parse-from-s3": [
      "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "../../node_modules/pdfjs-dist/legacy/build/pdf.mjs",
    ],
    "/api/pdf/parse": [
      "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "../../node_modules/pdfjs-dist/legacy/build/pdf.mjs",
    ],
  },
  // Disable static generation for error pages
  experimental: {
    // Use PPR for better static/dynamic mix
    ppr: false,
    // Align Server Action body size limit with the rest of the stack (100 MB).
    // Python config.py, nginx client_max_body_size, and env MAX_UPLOAD_SIZE_MB
    // are all set to 100 MB.  SESSION_20260423_023327.
    serverActions: {
      bodySizeLimit: "100mb",
    },
    // Optimize bundle size for large component libraries
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label',
      '@radix-ui/react-popover',
      '@radix-ui/react-progress',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slider',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toast',
      '@radix-ui/react-toggle-group',
      '@radix-ui/react-tooltip',
      '@tanstack/react-query',
    ],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  images: {
    // Explicit whitelist — wildcard "**" is a SSRF vector (OWASP-A10).
    // Only allow domains that legitimately serve images for this app.
    // To add a new domain, list it explicitly here rather than widening the
    // pattern.  Reviewed: SESSION_20260423_023327.
    remotePatterns: [
      // Main application domain and all subdomains (avatars, thumbnails…)
      { protocol: "https", hostname: "giga-pdf.com" },
      { protocol: "https", hostname: "**.giga-pdf.com" },
      // Scaleway S3 object storage (PDF thumbnails / previews)
      { protocol: "https", hostname: "s3.fr-par.scw.cloud" },
    ],
  },
  // Security headers applied at the edge before any page renders.
  async headers() {
    return [
      {
        // Embed widget routes — permissive frame-ancestors, no X-Frame-Options.
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP_EMBED },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // All other routes — strict security posture.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP_DEFAULT },
          // X-Frame-Options as defence-in-depth alongside CSP frame-ancestors.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // HSTS: 1 year, include subdomains.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
  // Proxy API calls to avoid mixed content (HTTPS frontend -> HTTP backend)
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [
      {
        // Proxy /backend-api/v1/* to http://localhost:8000/api/v1/*
        source: "/backend-api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

const nextConfigWithIntl = withNextIntl(nextConfig);

export default withSentryConfig(nextConfigWithIntl, {
  // Suppress Sentry CLI logs during build
  silent: !process.env.CI,

  // Upload source maps only when SENTRY_AUTH_TOKEN is set (CI/CD)
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Tunnel Sentry requests through /monitoring to avoid ad-blockers
  tunnelRoute: "/monitoring",

  // Tree-shake Sentry debug statements in production
  disableLogger: true,

  // Automatically annotate React components for readable error stacks
  reactComponentAnnotation: {
    enabled: true,
  },

  // Source maps upload configuration (v9+ API)
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: false,
  },
});
