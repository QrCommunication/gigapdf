/**
 * Effective security headers per path, computed with Next's own route matcher
 * and its "last matching rule wins" semantics.
 *
 * Regression (prod, 2026-10-28): the strict rule used "/:path*", which also
 * matched /embed/*. Being last, it replaced the embed CSP with
 * `frame-ancestors 'none'` and added X-Frame-Options: DENY, so no third-party
 * site could frame the widget.
 */
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";

import { SECURITY_HEADER_RULES } from "../security-headers";

function effectiveHeaders(pathname: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const rule of SECURITY_HEADER_RULES) {
    const match = getPathMatch(rule.source, { removeUnnamedParams: true, strict: true });
    if (match(pathname) === false) continue;
    for (const { key, value } of rule.headers) headers.set(key.toLowerCase(), value);
  }
  return headers;
}

describe("security headers", () => {
  it.each(["/embed", "/embed/editor", "/embed/viewer/abc"])(
    "lets third-party sites frame %s",
    (pathname) => {
      const headers = effectiveHeaders(pathname);

      expect(headers.get("content-security-policy")).toContain("frame-ancestors *");
      expect(headers.has("x-frame-options")).toBe(false);
    },
  );

  it.each(["/", "/fr", "/fr/tools/merge", "/editor/123", "/embedded", "/api/pdf/merge"])(
    "forbids framing %s",
    (pathname) => {
      const headers = effectiveHeaders(pathname);

      expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(headers.get("x-frame-options")).toBe("DENY");
    },
  );

  it("sends nosniff, HSTS and Permissions-Policy everywhere", () => {
    for (const pathname of ["/", "/embed/editor"]) {
      const headers = effectiveHeaders(pathname);
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("strict-transport-security")).toContain("max-age=31536000");
      expect(headers.get("permissions-policy")).toContain("camera=()");
    }
  });
});
