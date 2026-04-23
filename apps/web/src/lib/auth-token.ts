"use client";

import { authClient } from "./auth-client";

/**
 * In-memory JWT cache. NOT persisted to sessionStorage/localStorage
 * (security: prevent XSS token theft per ~/.claude/rules/security.md).
 *
 * The Better Auth `jwtClient` plugin exposes `authClient.token()` which
 * returns a short-lived JWT that the Python FastAPI backend validates
 * via JWKS at /api/auth/jwks.
 *
 * Token is refetched on-demand if:
 * - Cache is empty (first call)
 * - Cached token is within 30s of expiry
 * - A 401 response triggers a manual invalidate
 */
type TokenCache = {
  token: string;
  expiresAt: number;
};

let cache: TokenCache | null = null;

const REFETCH_BEFORE_EXPIRY_MS = 30_000;

function decodeExpiresAt(token: string): number {
  try {
    const [, payloadB64] = token.split(".");
    if (!payloadB64) return 0;
    const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export async function getAuthToken(): Promise<string | null> {
  const now = Date.now();

  if (cache && cache.expiresAt - REFETCH_BEFORE_EXPIRY_MS > now) {
    return cache.token;
  }

  try {
    const client = authClient as unknown as {
      token?: () => Promise<{ data?: { token?: string } | null; error?: unknown }>;
      getToken?: () => Promise<string | null>;
    };
    let token: string | null = null;

    if (typeof client.token === "function") {
      const result = await client.token();
      token = result?.data?.token ?? null;
    } else if (typeof client.getToken === "function") {
      token = await client.getToken();
    } else {
      const response = await fetch("/api/auth/token", {
        method: "GET",
        credentials: "include",
      });
      if (response.ok) {
        const data = (await response.json()) as { token?: string };
        token = data.token ?? null;
      }
    }

    if (!token) {
      cache = null;
      return null;
    }

    const expiresAt = decodeExpiresAt(token);
    cache = { token, expiresAt: expiresAt || now + 15 * 60 * 1000 };
    return token;
  } catch {
    cache = null;
    return null;
  }
}

export function invalidateAuthToken(): void {
  cache = null;
}
