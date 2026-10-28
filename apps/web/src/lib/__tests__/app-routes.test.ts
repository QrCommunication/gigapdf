import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "../app-routes";

const APP_DIR = resolve(__dirname, "../../app");

function subdirectories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * First URL segments actually served outside the localized (site) tree: the
 * (app) group, the (embed) group (embeddable editor, own root layout) and the
 * public viewer.
 */
function routeSegmentsOnDisk(): string[] {
  const appGroup = join(APP_DIR, "(app)");
  const dashboardPages = subdirectories(join(appGroup, "(dashboard)"));
  const appPages = subdirectories(appGroup).filter((name) => name !== "(dashboard)");
  const embedPages = subdirectories(join(APP_DIR, "(embed)"));
  return [...dashboardPages, ...appPages, ...embedPages, "public"].sort();
}

describe("APP_ROUTES", () => {
  it("lists every (app) and (embed) page so the proxy never rewrites it into a 404", () => {
    const missing = routeSegmentsOnDisk().filter((segment) => !APP_ROUTES.has(segment));

    expect(missing).toEqual([]);
  });

  it("lists no segment without a page behind it", () => {
    const onDisk = new Set(routeSegmentsOnDisk());
    const stale = [...APP_ROUTES].filter((segment) => !onDisk.has(segment));

    expect(stale).toEqual([]);
  });
});
