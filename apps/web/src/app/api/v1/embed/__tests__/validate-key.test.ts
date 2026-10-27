/**
 * Tests for POST /api/v1/embed/validate-key.
 *
 * Regression (prod, 2026-10-27): every key, valid or not, was reported
 * `{ valid: false }` because the route probed `OPTIONS /embed/sessions`
 * (always 405) and `GET /api-keys` (needs a user session). It also accepted
 * secret `giga_pk_*` keys. The route now delegates to FastAPI
 * `POST /api/v1/embed/session-token`, the same check the embed SDK relies on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server-logger", () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "../validate-key/route";

const PUB_KEY = "giga_pub_valid-key-for-tests";
const fetchMock = vi.fn();

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://giga-pdf.com/api/v1/embed/validate-key", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/v1/embed/validate-key", () => {
  it("reports a publishable key accepted by the backend as valid", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const res = await POST(request({ api_key: PUB_KEY }, { origin: "https://client.example" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/embed\/session-token$/);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-API-Key": PUB_KEY, origin: "https://client.example" });
  });

  it("reports a key rejected by the backend as invalid", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));

    const res = await POST(request({ api_key: PUB_KEY }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ valid: false });
  });

  it("refuses secret keys without contacting the backend", async () => {
    const res = await POST(request({ api_key: "giga_pk_secret" }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 400, not 500, to a malformed body", async () => {
    const res = await POST(request("not json"));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const res = await POST(request({ api_key: PUB_KEY }));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ valid: false });
  });
});
