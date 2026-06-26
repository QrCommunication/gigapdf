import { describe, it, expect, vi } from "vitest";
import {
  applyHeaderFooter,
  removeHeaderFooter,
  bakeRunningHeaderFooter,
  readRunningHeaderFooter,
  detectHeaderFooter,
  documentHasSignatures,
  type HeaderFooterSpec,
} from "../page-headers-footers";
import type {
  RunningHeaderFooter,
  SignatureInfo,
} from "@qrcommunication/gigapdf-lib";

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

// ─── Rich running-H/F API (SL2) ──────────────────────────────────────────────

/** A fake doc exposing the rich running-H/F + reader + signatures methods. */
function makeRichFakeDoc(opts: {
  setOk?: boolean;
  rich?: RunningHeaderFooter | null;
  flat?: { header: HeaderFooterSpec | null; footer: HeaderFooterSpec | null };
  signatures?: SignatureInfo[];
  saved?: Uint8Array;
}) {
  const calls = {
    setRunning: [] as Array<{
      def: RunningHeaderFooter;
      opts: { date?: string; images?: Iterable<[number, Uint8Array]> };
    }>,
    closed: 0,
  };
  const doc = {
    setRunningHeaderFooter: (
      def: RunningHeaderFooter,
      o: { date?: string; images?: Iterable<[number, Uint8Array]> },
    ): boolean => {
      calls.setRunning.push({ def, opts: o });
      return opts.setOk ?? true;
    },
    runningHeaderFooter: (): RunningHeaderFooter | null => opts.rich ?? null,
    headerFooter: () => opts.flat ?? { header: null, footer: null },
    signatures: (): SignatureInfo[] => opts.signatures ?? [],
    saveCompressed: (): Uint8Array => opts.saved ?? new Uint8Array([1, 2, 3]),
    close: () => {
      calls.closed += 1;
    },
  };
  return { doc, calls };
}

function richLoader(doc: ReturnType<typeof makeRichFakeDoc>["doc"]) {
  const open = vi.fn(() => doc);
  return Object.assign(async () => ({ open }) as never, { open });
}

const DEF: RunningHeaderFooter = {
  default: {
    header: [{ type: "text", text: "{{title}}", anchor: "center" }],
    footer: [{ type: "text", text: "{{page}}/{{pages}}", anchor: "right" }],
  },
};

describe("bakeRunningHeaderFooter", () => {
  it("calls setRunningHeaderFooter with the def + date/images and returns bytes", async () => {
    const saved = new Uint8Array([5, 6, 7]);
    const { doc, calls } = makeRichFakeDoc({ saved });
    const images = new Map([[1, new Uint8Array([9])]]);
    const out = await bakeRunningHeaderFooter(
      BYTES,
      DEF,
      { date: "2026-06-26", images },
      richLoader(doc),
    );
    expect(calls.setRunning).toHaveLength(1);
    expect(calls.setRunning[0]?.def).toBe(DEF);
    expect(calls.setRunning[0]?.opts.date).toBe("2026-06-26");
    expect(calls.setRunning[0]?.opts.images).toBe(images);
    expect(Array.from(out)).toEqual([5, 6, 7]);
    expect(out.buffer).toBeInstanceOf(ArrayBuffer);
    expect(calls.closed).toBe(1);
  });

  it("omits absent opts and still closes on success", async () => {
    const { doc, calls } = makeRichFakeDoc({});
    await bakeRunningHeaderFooter(BYTES, DEF, {}, richLoader(doc));
    expect(calls.setRunning[0]?.opts.date).toBeUndefined();
    expect(calls.setRunning[0]?.opts.images).toBeUndefined();
    expect(calls.closed).toBe(1);
  });

  it("throws and closes when the engine rejects the bake", async () => {
    const { doc, calls } = makeRichFakeDoc({ setOk: false });
    await expect(
      bakeRunningHeaderFooter(BYTES, DEF, {}, richLoader(doc)),
    ).rejects.toThrow(/setRunningHeaderFooter failed/);
    expect(calls.closed).toBe(1);
  });
});

describe("readRunningHeaderFooter", () => {
  it("returns the rich definition the engine reports", async () => {
    const { doc } = makeRichFakeDoc({ rich: DEF });
    await expect(readRunningHeaderFooter(BYTES, richLoader(doc))).resolves.toBe(
      DEF,
    );
  });

  it("returns null when none is present", async () => {
    const { doc } = makeRichFakeDoc({ rich: null });
    await expect(
      readRunningHeaderFooter(BYTES, richLoader(doc)),
    ).resolves.toBeNull();
  });

  it("returns null (never throws) on an engine failure", async () => {
    const throwing = async () => {
      throw new Error("wasm boom");
    };
    await expect(readRunningHeaderFooter(BYTES, throwing)).resolves.toBeNull();
  });
});

describe("detectHeaderFooter (rich-first, flat fallback)", () => {
  it("prefers the first rich text item of each band", async () => {
    const { doc } = makeRichFakeDoc({
      rich: DEF,
      flat: {
        header: { text: "flat header" },
        footer: { text: "flat footer" },
      },
    });
    await expect(detectHeaderFooter(BYTES, richLoader(doc))).resolves.toEqual({
      header: "{{title}}",
      footer: "{{page}}/{{pages}}",
    });
  });

  it("falls back to flat text when no rich band is present", async () => {
    const { doc } = makeRichFakeDoc({
      rich: null,
      flat: { header: { text: "flat header" }, footer: null },
    });
    await expect(detectHeaderFooter(BYTES, richLoader(doc))).resolves.toEqual({
      header: "flat header",
      footer: null,
    });
  });
});

describe("documentHasSignatures", () => {
  it("is true when the engine reports at least one signature", async () => {
    const { doc } = makeRichFakeDoc({
      signatures: [{} as SignatureInfo],
    });
    await expect(documentHasSignatures(BYTES, richLoader(doc))).resolves.toBe(
      true,
    );
  });

  it("is false for an unsigned document and on failure", async () => {
    const { doc } = makeRichFakeDoc({ signatures: [] });
    await expect(documentHasSignatures(BYTES, richLoader(doc))).resolves.toBe(
      false,
    );
    const throwing = async () => {
      throw new Error("boom");
    };
    await expect(documentHasSignatures(BYTES, throwing)).resolves.toBe(false);
  });
});
