/**
 * formatBytes used to print "Bytes/KB/MB" whatever the UI language, and seven
 * components carried their own copy (one hard-coded in French). Sizes now
 * follow the locale like formatDate.
 */
import { describe, expect, it } from "vitest";

import { formatBytes } from "../utils";

// Intl separates number and unit with a no-break space in some locales.
const normalize = (s: string) => s.replace(/[  ]/g, " ");

describe("formatBytes", () => {
  it("uses French symbols and decimal comma in French", () => {
    expect(normalize(formatBytes(512, "fr"))).toBe("512 o");
    expect(normalize(formatBytes(1536, "fr"))).toBe("1,5 ko");
    expect(normalize(formatBytes(7.3 * 1024 * 1024, "fr"))).toBe("7,3 Mo");
    expect(normalize(formatBytes(1024 ** 3, "fr"))).toBe("1 Go");
  });

  it("uses English symbols in English", () => {
    expect(normalize(formatBytes(1536, "en"))).toBe("1.5 kB");
    expect(normalize(formatBytes(7.3 * 1024 * 1024, "en"))).toBe("7.3 MB");
  });

  it("formats zero without a fraction", () => {
    expect(normalize(formatBytes(0, "fr"))).toBe("0 o");
  });

  it("caps at terabytes for huge sizes", () => {
    expect(normalize(formatBytes(1024 ** 5, "en"))).toBe("1,024 TB");
  });

  it("returns a dash for missing or invalid sizes", () => {
    expect(formatBytes(Number.NaN, "fr")).toBe("—");
    expect(formatBytes(-1, "fr")).toBe("—");
  });
});
