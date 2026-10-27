import { NextRequest, NextResponse } from "next/server";

import { PYTHON_BACKEND_URL } from "@/lib/python-backend-url";
import { serverLogger } from "@/lib/server-logger";

/**
 * POST /api/v1/embed/validate-key — body `{ "api_key": "giga_pub_…" }`.
 *
 * Tells an embed integrator whether a publishable key is usable from the
 * calling origin: `{ valid: true }` (200) or `{ valid: false }` (401).
 *
 * The check is delegated to FastAPI `POST /api/v1/embed/session-token`, the
 * endpoint the SDK itself calls: it authenticates the key and applies its
 * allowed-domains restriction, so the caller's Origin/Referer are forwarded.
 *
 * Earlier versions probed `OPTIONS /embed/sessions` (always 405) and
 * `GET /api-keys` (needs a user session), so every key — valid or not — was
 * reported invalid. They also accepted secret `giga_pk_*` keys, which must
 * never be handled by browser-side embed code.
 */
const PUBLISHABLE_KEY_PREFIX = "giga_pub_";
const BACKEND_TIMEOUT_MS = 10_000;
const FORWARDED_HEADERS = ["origin", "referer"] as const;

async function readApiKey(req: NextRequest): Promise<string | null> {
  try {
    const body: unknown = await req.json();
    if (typeof body !== "object" || body === null) return null;
    const apiKey = (body as { api_key?: unknown }).api_key;
    return typeof apiKey === "string" ? apiKey : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const apiKey = await readApiKey(req);
  if (!apiKey?.startsWith(PUBLISHABLE_KEY_PREFIX)) {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const headers: Record<string, string> = { "X-API-Key": apiKey };
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }

  try {
    const res = await fetch(`${PYTHON_BACKEND_URL}/api/v1/embed/session-token`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    if (res.ok) return NextResponse.json({ valid: true });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }
    serverLogger.error("api.embed.validate-key.backend", { status: res.status });
    return NextResponse.json({ valid: false }, { status: 502 });
  } catch (error) {
    serverLogger.error("api.embed.validate-key.unreachable", { error });
    return NextResponse.json({ valid: false }, { status: 502 });
  }
}
