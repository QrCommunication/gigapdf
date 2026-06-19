import { describe, expect, it } from "vitest";
import {
  IMPORT_CONCURRENCY,
  MAX_IMPORT_FILE_SIZE_BYTES,
  getFileExtension,
  isPdfFile,
  runWithConcurrency,
  stripExtension,
  summarizeOutcomes,
  validateImportFile,
  type ImportOutcome,
} from "../document-import";

describe("validateImportFile", () => {
  it("accepts any non-empty file within the size cap", () => {
    expect(validateImportFile({ size: 1 })).toEqual({ ok: true });
    expect(validateImportFile({ size: MAX_IMPORT_FILE_SIZE_BYTES })).toEqual({
      ok: true,
    });
  });

  it("rejects an empty file with errorEmpty", () => {
    expect(validateImportFile({ size: 0 })).toEqual({
      ok: false,
      reasonKey: "errorEmpty",
    });
  });

  it("rejects a file above the cap with errorTooLarge", () => {
    expect(validateImportFile({ size: MAX_IMPORT_FILE_SIZE_BYTES + 1 })).toEqual(
      { ok: false, reasonKey: "errorTooLarge" },
    );
  });

  it("honors a custom max size", () => {
    expect(validateImportFile({ size: 11 }, 10)).toEqual({
      ok: false,
      reasonKey: "errorTooLarge",
    });
    expect(validateImportFile({ size: 10 }, 10)).toEqual({ ok: true });
  });

  it("does NOT reject by format — every type passes the size check", () => {
    // A .exe, .zip, .png, .docx — all accepted as long as size is valid.
    for (const size of [1, 1024, 50 * 1024 * 1024]) {
      expect(validateImportFile({ size }).ok).toBe(true);
    }
  });
});

describe("getFileExtension", () => {
  it("returns the lowercase extension without the dot", () => {
    expect(getFileExtension("report.PDF")).toBe("pdf");
    expect(getFileExtension("Archive.Final.DOCX")).toBe("docx");
  });

  it("returns empty string when there is no usable extension", () => {
    expect(getFileExtension("README")).toBe("");
    expect(getFileExtension(".gitignore")).toBe(""); // dot at index 0
    expect(getFileExtension("trailingdot.")).toBe("");
  });
});

describe("isPdfFile", () => {
  it("detects PDFs by extension (case-insensitive)", () => {
    expect(isPdfFile({ name: "a.pdf" })).toBe(true);
    expect(isPdfFile({ name: "A.PDF" })).toBe(true);
  });

  it("detects PDFs by MIME when the extension is missing", () => {
    expect(isPdfFile({ name: "noext", type: "application/pdf" })).toBe(true);
  });

  it("returns false for non-PDF files", () => {
    expect(isPdfFile({ name: "sheet.xlsx" })).toBe(false);
    expect(isPdfFile({ name: "image.png", type: "image/png" })).toBe(false);
  });
});

describe("stripExtension", () => {
  it("removes a single trailing extension", () => {
    expect(stripExtension("invoice.pdf")).toBe("invoice");
    expect(stripExtension("data.tar.gz")).toBe("data.tar");
  });

  it("returns the name unchanged when there is no extension", () => {
    expect(stripExtension("LICENSE")).toBe("LICENSE");
  });
});

describe("runWithConcurrency", () => {
  it("processes every item and preserves input order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (n) => n * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds the requested concurrency", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await runWithConcurrency(items, 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty list", async () => {
    expect(await runWithConcurrency([], IMPORT_CONCURRENCY, async (n) => n)).toEqual(
      [],
    );
  });

  it("caps the pool size to the item count for tiny batches", async () => {
    let active = 0;
    let peak = 0;
    await runWithConcurrency([1], 10, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active -= 1;
      return n;
    });
    expect(peak).toBe(1);
  });
});

describe("summarizeOutcomes", () => {
  it("counts all-success batches with no failures", () => {
    const outcomes: ImportOutcome[] = [
      { ok: true, name: "a.pdf" },
      { ok: true, name: "b.docx" },
    ];
    expect(summarizeOutcomes(outcomes)).toEqual({
      successCount: 2,
      failures: [],
    });
  });

  it("collects named failures alongside the success count", () => {
    const outcomes: ImportOutcome[] = [
      { ok: true, name: "ok.pdf" },
      { ok: false, name: "bad.zip", reason: "File too large" },
      { ok: false, name: "empty.txt", reason: "The file is empty" },
    ];
    expect(summarizeOutcomes(outcomes)).toEqual({
      successCount: 1,
      failures: [
        { name: "bad.zip", reason: "File too large" },
        { name: "empty.txt", reason: "The file is empty" },
      ],
    });
  });

  it("reports zero successes when everything fails", () => {
    const outcomes: ImportOutcome[] = [
      { ok: false, name: "x", reason: "boom" },
    ];
    const summary = summarizeOutcomes(outcomes);
    expect(summary.successCount).toBe(0);
    expect(summary.failures).toHaveLength(1);
  });
});
