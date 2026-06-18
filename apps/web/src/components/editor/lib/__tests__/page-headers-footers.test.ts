import { describe, it, expect, vi } from "vitest";
import {
  applyHeaderFooter,
  removeHeaderFooter,
  type HeaderFooterSpec,
} from "../page-headers-footers";

/**
 * Minimal fake `GigaPdfDoc` capturing the header/footer calls the helpers make.
 * Only the methods exercised here are implemented.
 */
function makeFakeDoc(opts: {
  setHeaderOk?: boolean;
  setFooterOk?: boolean;
  removeHeadersOk?: boolean;
  removeFootersOk?: boolean;
  saved?: Uint8Array;
}) {
  const calls = {
    setHeader: [] as HeaderFooterSpec[],
    setFooter: [] as HeaderFooterSpec[],
    removeHeaders: 0,
    removeFooters: 0,
    closed: 0,
  };
  const doc = {
    setHeader: (spec: HeaderFooterSpec): boolean => {
      calls.setHeader.push(spec);
      return opts.setHeaderOk ?? true;
    },
    setFooter: (spec: HeaderFooterSpec): boolean => {
      calls.setFooter.push(spec);
      return opts.setFooterOk ?? true;
    },
    removeHeaders: (): boolean => {
      calls.removeHeaders += 1;
      return opts.removeHeadersOk ?? true;
    },
    removeFooters: (): boolean => {
      calls.removeFooters += 1;
      return opts.removeFootersOk ?? true;
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
  return Object.assign(async () => ({ open }) as never, { open });
}

const BYTES = new Uint8Array([9, 9, 9]);
const SPEC: HeaderFooterSpec = {
  text: "Page {{page}} of {{pages}}",
  align: "center",
  fontSize: 10,
};

describe("applyHeaderFooter", () => {
  it("calls setHeader with the spec for kind 'header'", async () => {
    const { doc, calls } = makeFakeDoc({});
    await applyHeaderFooter(BYTES, "header", SPEC, fakeLoader(doc));
    expect(calls.setHeader).toEqual([SPEC]);
    expect(calls.setFooter).toHaveLength(0);
  });

  it("calls setFooter with the spec for kind 'footer'", async () => {
    const { doc, calls } = makeFakeDoc({});
    await applyHeaderFooter(BYTES, "footer", SPEC, fakeLoader(doc));
    expect(calls.setFooter).toEqual([SPEC]);
    expect(calls.setHeader).toHaveLength(0);
  });

  it("returns a fresh ArrayBuffer-backed copy of the saved bytes", async () => {
    const saved = new Uint8Array([4, 5, 6]);
    const { doc } = makeFakeDoc({ saved });
    const result = await applyHeaderFooter(BYTES, "header", SPEC, fakeLoader(doc));
    expect(Array.from(result)).toEqual([4, 5, 6]);
    // A copy, not the same instance, and backed by a plain ArrayBuffer.
    expect(result).not.toBe(saved);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it("throws and closes when the engine rejects setHeader", async () => {
    const { doc, calls } = makeFakeDoc({ setHeaderOk: false });
    await expect(
      applyHeaderFooter(BYTES, "header", SPEC, fakeLoader(doc)),
    ).rejects.toThrow(/set header failed/);
    expect(calls.closed).toBe(1);
  });

  it("throws and closes when the engine rejects setFooter", async () => {
    const { doc, calls } = makeFakeDoc({ setFooterOk: false });
    await expect(
      applyHeaderFooter(BYTES, "footer", SPEC, fakeLoader(doc)),
    ).rejects.toThrow(/set footer failed/);
    expect(calls.closed).toBe(1);
  });

  it("closes the document on success", async () => {
    const { doc, calls } = makeFakeDoc({});
    await applyHeaderFooter(BYTES, "header", SPEC, fakeLoader(doc));
    expect(calls.closed).toBe(1);
  });
});

describe("removeHeaderFooter", () => {
  it("calls removeHeaders for kind 'header'", async () => {
    const { doc, calls } = makeFakeDoc({});
    await removeHeaderFooter(BYTES, "header", fakeLoader(doc));
    expect(calls.removeHeaders).toBe(1);
    expect(calls.removeFooters).toBe(0);
  });

  it("calls removeFooters for kind 'footer'", async () => {
    const { doc, calls } = makeFakeDoc({});
    await removeHeaderFooter(BYTES, "footer", fakeLoader(doc));
    expect(calls.removeFooters).toBe(1);
    expect(calls.removeHeaders).toBe(0);
  });

  it("returns a fresh ArrayBuffer-backed copy of the saved bytes", async () => {
    const saved = new Uint8Array([7, 8, 9]);
    const { doc } = makeFakeDoc({ saved });
    const result = await removeHeaderFooter(BYTES, "footer", fakeLoader(doc));
    expect(Array.from(result)).toEqual([7, 8, 9]);
    expect(result).not.toBe(saved);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it("throws and closes when the engine rejects removeHeaders", async () => {
    const { doc, calls } = makeFakeDoc({ removeHeadersOk: false });
    await expect(
      removeHeaderFooter(BYTES, "header", fakeLoader(doc)),
    ).rejects.toThrow(/remove headers failed/);
    expect(calls.closed).toBe(1);
  });
});
