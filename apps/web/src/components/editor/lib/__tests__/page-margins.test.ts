import { describe, it, expect, vi } from "vitest";
import {
  readAllPageMargins,
  applyPageMargins,
  type PageMargins,
} from "../page-margins";

/**
 * Minimal fake `GigaPdfDoc` capturing the engine calls the helpers make. Only
 * the methods exercised here are implemented.
 */
function makeFakeDoc(opts: {
  pageCount?: number;
  marginsByPage?: Record<number, PageMargins | "throw">;
  setOk?: boolean;
  saved?: Uint8Array;
}) {
  const calls = {
    setPageMargins: [] as Array<{ page: number; m: PageMargins }>,
    closed: 0,
  };
  const doc = {
    pageCount: () => opts.pageCount ?? 1,
    pageMargins: (page: number): PageMargins => {
      const m = opts.marginsByPage?.[page];
      if (m === "throw") throw new Error("no margins");
      return m ?? { top: 0, right: 0, bottom: 0, left: 0 };
    },
    setPageMargins: (page: number, m: PageMargins): boolean => {
      calls.setPageMargins.push({ page, m });
      return opts.setOk ?? true;
    },
    save: (): Uint8Array => opts.saved ?? new Uint8Array([1, 2, 3]),
    close: () => {
      calls.closed += 1;
    },
  };
  return { doc, calls };
}

/** Build a fake engine loader returning a one-doc engine. */
function fakeLoader(doc: ReturnType<typeof makeFakeDoc>["doc"]) {
  const open = vi.fn(() => doc);
  // The helpers only call `engine.open(bytes)`.
  return Object.assign(
    async () => ({ open }) as never,
    { open },
  );
}

const BYTES = new Uint8Array([9, 9, 9]);

describe("readAllPageMargins", () => {
  it("reads one entry per page in document order (1-based engine)", async () => {
    const { doc } = makeFakeDoc({
      pageCount: 3,
      marginsByPage: {
        1: { top: 10, right: 20, bottom: 30, left: 40 },
        2: { top: 1, right: 2, bottom: 3, left: 4 },
        3: { top: 5, right: 6, bottom: 7, left: 8 },
      },
    });
    const out = await readAllPageMargins(BYTES, fakeLoader(doc));
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ top: 10, right: 20, bottom: 30, left: 40 });
    expect(out[2]).toEqual({ top: 5, right: 6, bottom: 7, left: 8 });
  });

  it("yields null for a page whose margins cannot be read (no throw)", async () => {
    const { doc } = makeFakeDoc({
      pageCount: 2,
      marginsByPage: { 1: "throw", 2: { top: 0, right: 0, bottom: 0, left: 0 } },
    });
    const out = await readAllPageMargins(BYTES, fakeLoader(doc));
    expect(out[0]).toBeNull();
    expect(out[1]).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("closes the document", async () => {
    const { doc, calls } = makeFakeDoc({ pageCount: 1 });
    await readAllPageMargins(BYTES, fakeLoader(doc));
    expect(calls.closed).toBe(1);
  });
});

describe("applyPageMargins", () => {
  it("converts the 0-based page index to 1-based for the engine", async () => {
    const { doc, calls } = makeFakeDoc({ setOk: true });
    const margins: PageMargins = { top: 12, right: 12, bottom: 12, left: 12 };
    await applyPageMargins(BYTES, 0, margins, fakeLoader(doc));
    expect(calls.setPageMargins).toEqual([{ page: 1, m: margins }]);
  });

  it("returns a fresh ArrayBuffer-backed copy of the saved bytes", async () => {
    const saved = new Uint8Array([4, 5, 6]);
    const { doc } = makeFakeDoc({ setOk: true, saved });
    const result = await applyPageMargins(
      BYTES,
      2,
      { top: 0, right: 0, bottom: 0, left: 0 },
      fakeLoader(doc),
    );
    expect(Array.from(result)).toEqual([4, 5, 6]);
    // A copy, not the same instance, and backed by a plain ArrayBuffer.
    expect(result).not.toBe(saved);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it("throws and closes when the engine rejects the change", async () => {
    const { doc, calls } = makeFakeDoc({ setOk: false });
    await expect(
      applyPageMargins(BYTES, 0, { top: 0, right: 0, bottom: 0, left: 0 }, fakeLoader(doc)),
    ).rejects.toThrow(/setPageMargins failed/);
    expect(calls.closed).toBe(1);
  });
});
