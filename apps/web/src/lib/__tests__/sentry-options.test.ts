/**
 * Guards the Sentry options shared by the client, server and edge configs.
 *
 * 1. GDPR: @sentry/nextjs v11 removed `sendDefaultPii`; with `dataCollection`
 *    unset it collects user info/IP, cookies, request and response bodies and
 *    database query data. Dropping a field of SENTRY_DATA_COLLECTION, or the
 *    option itself from one runtime config, would turn that collection back on
 *    without any error.
 * 2. Tunnel: since v11 the tunnel route goes through src/proxy.ts. If the
 *    matcher stops excluding it, next-intl rewrites it to /fr/monitoring (404)
 *    and every browser event is lost.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { describe, expect, it, vi } from "vitest";

import { SENTRY_DATA_COLLECTION, SENTRY_TUNNEL_ROUTE } from "../sentry-options";

// The proxy module builds the next-intl middleware at import time; only its
// static `config` export is under test here.
vi.mock("next-intl/middleware", () => ({ default: () => () => undefined }));

const WEB_ROOT = resolve(__dirname, "../../..");

describe("SENTRY_DATA_COLLECTION", () => {
  it("collects no user identity, cookie, body, database or queue data", () => {
    expect(SENTRY_DATA_COLLECTION.userInfo).toBe(false);
    expect(SENTRY_DATA_COLLECTION.cookies).toBe(false);
    expect(SENTRY_DATA_COLLECTION.httpBodies).toEqual([]);
    expect(SENTRY_DATA_COLLECTION.databaseQueryData).toBe(false);
    expect(SENTRY_DATA_COLLECTION.queues).toBe(false);
  });

  it("records no GraphQL, generative AI or MCP payloads", () => {
    expect(SENTRY_DATA_COLLECTION.graphQL).toEqual({ document: false, variables: false });
    expect(SENTRY_DATA_COLLECTION.genAI).toEqual({ inputs: false, outputs: false });
    expect(SENTRY_DATA_COLLECTION.mcp).toEqual({ inputs: false, outputs: false });
  });

  it.each(["request", "response"] as const)(
    "denies credential and client-address %s headers",
    (direction) => {
      const { deny } = SENTRY_DATA_COLLECTION.httpHeaders[direction];
      expect(deny).toEqual(
        expect.arrayContaining([
          "authorization",
          "proxy-authorization",
          "cookie",
          "set-cookie",
          "x-api-key",
          "forwarded",
          "-ip",
        ]),
      );
    },
  );

  it("denies credential and identity query parameters", () => {
    expect(SENTRY_DATA_COLLECTION.urlQueryParams.deny).toEqual(
      expect.arrayContaining(["token", "key", "secret", "password", "code", "signature", "email"]),
    );
  });

  it.each(["sentry.client.config.ts", "sentry.server.config.ts", "sentry.edge.config.ts"])(
    "%s initialises Sentry with the shared data collection",
    (file) => {
      const source = readFileSync(resolve(WEB_ROOT, file), "utf8");
      expect(source).toContain("dataCollection: SENTRY_DATA_COLLECTION");
      expect(source).not.toContain("sendDefaultPii");
    },
  );
});

describe("SENTRY_TUNNEL_ROUTE", () => {
  async function proxyMatches(pathname: string): Promise<boolean> {
    const { config } = await import("../../proxy");
    return config.matcher.some((source) => {
      const { regexStr } = tryToParsePath(source);
      if (regexStr === undefined) throw new Error(`Unparsable proxy matcher: ${source}`);
      return new RegExp(regexStr).test(pathname);
    });
  }

  it("is the tunnel route configured in next.config.ts", () => {
    const source = readFileSync(resolve(WEB_ROOT, "next.config.ts"), "utf8");
    expect(source).toContain("tunnelRoute: SENTRY_TUNNEL_ROUTE");
  });

  it("is not handled by the proxy", async () => {
    expect(await proxyMatches(SENTRY_TUNNEL_ROUTE)).toBe(false);
  });

  it("leaves public pages handled by the proxy", async () => {
    expect(await proxyMatches("/login")).toBe(true);
    expect(await proxyMatches("/en/pricing")).toBe(true);
  });
});
