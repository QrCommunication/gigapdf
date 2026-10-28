/**
 * The backend URL is read in one place. Routes kept their own copies of the
 * fallback logic, and the copies drifted (validate-key used the browser-facing
 * NEXT_PUBLIC_API_URL, unset on the Ploi host, 2026-10-27).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
const OWNER = path.join("lib", "python-backend-url.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("PYTHON_BACKEND_URL", () => {
  it("is read from the environment only by lib/python-backend-url.ts", () => {
    const readers = sourceFiles(SRC)
      .filter((file) => readFileSync(file, "utf8").includes("process.env.PYTHON_BACKEND_URL"))
      .map((file) => path.relative(SRC, file));

    expect(readers).toEqual([OWNER]);
  });
});
