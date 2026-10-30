/**
 * Sentry options shared by the client, server and edge `Sentry.init` calls and
 * by `withSentryConfig` (next.config.ts).
 *
 * Kept free of runtime Sentry imports: next.config.ts loads this file at build
 * time, before any SDK is initialised.
 */
import type { init } from "@sentry/nextjs";

type SentryDataCollection = NonNullable<Parameters<typeof init>[0]["dataCollection"]>;

/**
 * Path of the Sentry tunnel (`withSentryConfig({ tunnelRoute })`). Since v11 the
 * tunnel request goes through `src/proxy.ts`, whose matcher must exclude it —
 * otherwise next-intl rewrites `/monitoring` to `/fr/monitoring` (404).
 * The matcher is a static string Next parses at build time, so it cannot import
 * this constant; src/lib/__tests__/sentry-options.test.ts keeps them in sync.
 */
export const SENTRY_TUNNEL_ROUTE = "/monitoring";

/** Header and query-param name fragments that identify the client or carry a credential. */
const CLIENT_IDENTITY_TERMS = ["forwarded", "-ip", "remote-", "via", "-user"];

const SENSITIVE_HEADER_TERMS = [
  ...CLIENT_IDENTITY_TERMS,
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
];

const SENSITIVE_QUERY_PARAM_TERMS = [
  ...CLIENT_IDENTITY_TERMS,
  "token",
  "key",
  "secret",
  "password",
  "code",
  "signature",
  "email",
];

/**
 * What the SDK may send to Sentry.
 *
 * Sentry v11 replaced `sendDefaultPii` with `dataCollection` and, when the
 * option is left unset, now collects user info and IP, cookies, request and
 * response bodies, database query data, queue arguments and AI inputs/outputs.
 * GigaPDF handles personal documents (GDPR): this restores the v10 behaviour of
 * `sendDefaultPii: false` and adds explicit deny lists on top of the SDK's own
 * sensitive-key filtering (auth, token, secret, session, cookie…).
 *
 * Source: https://github.com/getsentry/sentry-javascript/blob/11.10.0/MIGRATION.md
 * ("If you want to keep the v10 default behavior").
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: SENSITIVE_HEADER_TERMS },
    response: { deny: SENSITIVE_HEADER_TERMS },
  },
  httpBodies: [],
  urlQueryParams: { deny: SENSITIVE_QUERY_PARAM_TERMS },
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
} as const satisfies SentryDataCollection;
