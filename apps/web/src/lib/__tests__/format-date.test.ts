import { describe, expect, it } from "vitest";

import { formatDate } from "../utils";

// Midday UTC so the calendar day is the same in every test-runner time zone.
const OCT_27 = "2026-10-27T12:00:00Z";

describe("formatDate", () => {
  it("formats in the UI language instead of a hard-coded English", () => {
    expect(formatDate(OCT_27, "fr")).toBe("27 octobre 2026");
  });

  it("keeps the English long format for English users", () => {
    expect(formatDate(new Date(OCT_27), "en")).toBe("October 27, 2026");
  });
});
