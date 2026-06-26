import { describe, it, expect, vi } from "vitest";
import {
  readAllPageMargins,
  applyPageMargins,
  type PageMargins,
} from "../page-margins";

/**
 * Minimal fake `GigaPdfDoc` capturing the engine calls the helpers make. The
 * editor SIDECAR is modelled as a stateful map: `setEditorMargins` writes to it
 * and `editorMargins` reads it back — so a margin "drag" survives a re-open in
 * the persistence round-trip (the real sidecar travels inside the bytes).
 *
 * `setPageMargins` is present ONLY so a test can assert it is NEVER called:
 * Word margins must never recrop the page (`/CropBox`).
 */
function makeFakeDoc(opts: {
  pageCount?: number;
  /** Initial sidecar values (editorMargins source). `"throw"` → read fails. */
  sidecarByPage?: Record<number, PageMargins | null | "throw">;
  /** Estimated CropBox inset (pageMargins source, the legacy fallback). */
  estimateByPage?: Record<number, PageMargins | "throw">;
  setOk?: boolean;
  saved?: Uint8Array;
}) {
  const sidecar = new Map<number, PageMargins>();
  const throwingSidecar = new Set<number>();
  for (const [k, v] of Object.entries(opts.sidecarByPage ?? {})) {
    if (v === "throw") throwingSidecar.add(Number(k));
    else if (v) sidecar.set(Number(k), v);
  }
  const calls = {
    setEditorMargins: [] as Array<{ page: number; m: PageMargins }>,
    setPageMargins: [] as Array<{ page: number; m: PageMargins }>,
    closed: 0,
  };
  const doc = {
    pageCount: () => opts.pageCount ?? 1,
    editorMargins: (page: number): PageMargins | null => {
      if (throwingSidecar.has(page)) throw new Error("sidecar read failed");
      return sidecar.get(page) ?? null;
    },
    pageMargins: (page: number): PageMargins => {
      const m = opts.estimateByPage?.[page];
      if (m === "throw") throw new Error("no margins");
      return m ?? { top: 0, right: 0, bottom: 0, left: 0 };
    },
    setEditorMargins: (page: number, m: PageMargins): boolean => {
      calls.setEditorMargins.push({ page, m });
      const ok = opts.setOk ?? true;
      if (ok) sidecar.set(page, m); // persist for the round-trip
      return ok;
    },
    // Present only to prove it is never invoked (margins must NOT recrop).
    setPageMargins: (page: number, m: PageMargins): boolean => {
      calls.setPageMargins.push({ page, m });
      return true;
    },
    saveCompressed: (): Uint8Array => opts.saved ?? new Uint8Array([1, 2, 3]),
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
  it("prefers the editor sidecar over the estimated CropBox inset", async () => {
    const stored: PageMargins = { top: 10, right: 20, bottom: 30, left: 40 };
    const { doc } = makeFakeDoc({
      pageCount: 1,
      sidecarByPage: { 1: stored },
      // A different estimate the sidecar must win over.
      estimateByPage: { 1: { top: 99, right: 99, bottom: 99, left: 99 } },
    });
    const out = await readAllPageMargins(BYTES, fakeLoader(doc));
    expect(out[0]).toEqual(stored);
  });

  it("falls back to the estimated inset when no sidecar value is stored", async () => {
    const estimate: PageMargins = { top: 5, right: 6, bottom: 7, left: 8 };
    const { doc } = makeFakeDoc({
      pageCount: 1,
      sidecarByPage: { 1: null }, // no sidecar yet (legacy doc)
      estimateByPage: { 1: estimate },
    });
    const out = await readAllPageMargins(BYTES, fakeLoader(doc));
    expect(out[0]).toEqual(estimate);
  });

  it("reads one entry per page in document order (1-based engine)", async () => {
    const { doc } = makeFakeDoc({
      pageCount: 3,
      sidecarByPage: {
        1: { top: 10, right: 20, bottom: 30, left: 40 },
        3: { top: 5, right: 6, bottom: 7, left: 8 },
      },
      estimateByPage: { 2: { top: 1, right: 2, bottom: 3, left: 4 } },
    });
    const out = await readAllPageMargins(BYTES, fakeLoader(doc));
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ top: 10, right: 20, bottom: 30, left: 40 });
    // Page 2 has no sidecar → estimate wins.
    expect(out[1]).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(out[2]).toEqual({ top: 5, right: 6, bottom: 7, left: 8 });
  });

  it("yields null when neither sidecar nor estimate is available (no throw)", async () => {
    const { doc } = makeFakeDoc({
      pageCount: 2,
      sidecarByPage: { 1: "throw", 2: null },
      estimateByPage: { 1: "throw", 2: "throw" },
    });
    const out = await readAllPageMargins(BYTES, fakeLoader(doc));
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
  });

  it("closes the document", async () => {
    const { doc, calls } = makeFakeDoc({ pageCount: 1 });
    await readAllPageMargins(BYTES, fakeLoader(doc));
    expect(calls.closed).toBe(1);
  });
});

describe("applyPageMargins", () => {
  it("records the margins in the editor sidecar (1-based) and never recrops", async () => {
    const { doc, calls } = makeFakeDoc({ setOk: true });
    const margins: PageMargins = { top: 12, right: 12, bottom: 12, left: 12 };
    await applyPageMargins(BYTES, 0, margins, fakeLoader(doc));
    // Sidecar write at 1-based page 1 …
    expect(calls.setEditorMargins).toEqual([{ page: 1, m: margins }]);
    // … and NEVER a CropBox recrop.
    expect(calls.setPageMargins).toEqual([]);
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
    ).rejects.toThrow(/setEditorMargins failed/);
    expect(calls.closed).toBe(1);
  });
});

describe("editor-margins persistence (sidecar round-trip)", () => {
  it("reads back margins written via applyPageMargins", async () => {
    // ONE doc shared across both calls (its sidecar map = the persisted bytes).
    const { doc } = makeFakeDoc({
      pageCount: 2,
      // Page 1 starts with only an estimate (no sidecar yet).
      estimateByPage: { 1: { top: 1, right: 1, bottom: 1, left: 1 } },
    });
    const loader = fakeLoader(doc);

    const dragged: PageMargins = { top: 36, right: 48, bottom: 60, left: 72 };
    await applyPageMargins(BYTES, 0, dragged, loader);

    // Re-seed from the same (persisted) document → the dragged value survives.
    const reseeded = await readAllPageMargins(BYTES, loader);
    expect(reseeded[0]).toEqual(dragged);
  });
});
