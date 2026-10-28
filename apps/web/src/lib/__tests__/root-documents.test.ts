/**
 * The app has several root layouts ((site), (app), (embed), public), so no
 * single layout wraps an unmatched URL. A root `app/not-found.tsx` was then
 * wrapped in Next's default document: every 404 served two <html>/<body>
 * (seen in prod, 2026-10-28). The global 404 must be `global-not-found.tsx`,
 * enabled by `experimental.globalNotFound`, which returns its own document.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../../..");
const APP_DIR = path.join(WEB_ROOT, "src/app");

function rootLayoutCount(): number {
  return readdirSync(APP_DIR, { withFileTypes: true }).filter((entry) => {
    if (!entry.isDirectory()) return false;
    const dir = path.join(APP_DIR, entry.name);
    return (
      existsSync(path.join(dir, "layout.tsx")) ||
      existsSync(path.join(dir, "[locale]", "layout.tsx"))
    );
  }).length;
}

describe("root documents", () => {
  it("has several root layouts (the reason global-not-found is needed)", () => {
    expect(existsSync(path.join(APP_DIR, "layout.tsx"))).toBe(false);
    expect(rootLayoutCount()).toBeGreaterThan(1);
  });

  it("serves unmatched URLs with global-not-found, not a wrapped root not-found", () => {
    expect(existsSync(path.join(APP_DIR, "global-not-found.tsx"))).toBe(true);
    expect(existsSync(path.join(APP_DIR, "not-found.tsx"))).toBe(false);
    expect(readFileSync(path.join(WEB_ROOT, "next.config.ts"), "utf8")).toMatch(
      /globalNotFound:\s*true/,
    );
  });
});
