import { describe, it, expect, vi } from "vitest";
import { unzipSync } from "fflate";
import {
  exportPagesAsImages,
  type ImageExportFormat,
} from "../export-pages-as-images";

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal byte buffer that looks like a PNG to `pngSize()`: it only
 * reads `width`/`height` from the IHDR chunk at fixed big-endian offsets 16/20.
 * The first 8 bytes are the PNG signature (cosmetic here), then the IHDR length
 * + "IHDR" tag, then width (offset 16) and height (offset 20).
 */
function fakePng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  // PNG signature
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  dv.setUint32(8, 13); // IHDR length
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return buf;
}

interface FakeCalls {
  pages: number[];
  scales: number[];
  decoded: number;
  encodedJpeg: number;
  encodedWebp: number;
  jpegQuality: number | undefined;
  closed: number;
}

/**
 * Fake `GigaPdfEngine` + `GigaPdfDoc`. The image codecs live on the engine;
 * page rasterisation lives on the doc — exactly like the real SDK.
 */
function makeFakeEngine(pageCount: number) {
  const calls: FakeCalls = {
    pages: [],
    scales: [],
    decoded: 0,
    encodedJpeg: 0,
    encodedWebp: 0,
    jpegQuality: undefined,
    closed: 0,
  };
  const doc = {
    pageCount: () => pageCount,
    renderPage: (page: number, scale = 1) => {
      calls.pages.push(page);
      calls.scales.push(scale);
      // Distinct dimensions per page so we can tell entries apart.
      return fakePng(10 + page, 20 + page);
    },
    close: () => {
      calls.closed += 1;
    },
  };
  const engine = {
    open: vi.fn((_bytes: Uint8Array) => doc),
    decodePng: (png: Uint8Array) => {
      calls.decoded += 1;
      const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
      const width = dv.getUint32(16);
      const height = dv.getUint32(20);
      return { width, height, rgba: new Uint8Array(width * height * 4) };
    },
    encodeJpeg: (
      _rgba: Uint8Array,
      _w: number,
      _h: number,
      quality?: number,
    ) => {
      calls.encodedJpeg += 1;
      calls.jpegQuality = quality;
      return new Uint8Array([0xff, 0xd8, 0xff]); // JPEG SOI marker
    },
    encodeWebp: (_rgba: Uint8Array, _w: number, _h: number) => {
      calls.encodedWebp += 1;
      return new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
    },
  };
  return { engine, calls };
}

function fakeLoader(engine: ReturnType<typeof makeFakeEngine>["engine"]) {
  return Object.assign(async () => engine as never, { open: engine.open });
}

// ─── tests ──────────────────────────────────────────────────────────────────

const BYTES = new Uint8Array([1, 2, 3, 4]);

describe("exportPagesAsImages", () => {
  it("returns a Blob with the application/zip MIME", async () => {
    const { engine } = makeFakeEngine(2);
    const blob = await exportPagesAsImages(BYTES, "png", {}, fakeLoader(engine));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");
  });

  it("renders every page once and names entries page-NN.<format>, zero-padded", async () => {
    const { engine, calls } = makeFakeEngine(3);
    const blob = await exportPagesAsImages(
      BYTES,
      "png",
      {},
      fakeLoader(engine),
    );
    expect(calls.pages).toEqual([1, 2, 3]); // 1-based, every page once

    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual([
      "page-1.png",
      "page-2.png",
      "page-3.png",
    ]);
  });

  it("pads page numbers to the page-count width (10+ pages)", async () => {
    const { engine } = makeFakeEngine(10);
    const blob = await exportPagesAsImages(
      BYTES,
      "png",
      {},
      fakeLoader(engine),
    );
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const names = Object.keys(zip).sort();
    expect(names[0]).toBe("page-01.png");
    expect(names).toContain("page-10.png");
  });

  it("passes PNG through without decoding/re-encoding", async () => {
    const { engine, calls } = makeFakeEngine(2);
    await exportPagesAsImages(BYTES, "png", {}, fakeLoader(engine));
    expect(calls.decoded).toBe(0);
    expect(calls.encodedJpeg).toBe(0);
    expect(calls.encodedWebp).toBe(0);
  });

  it("decodes the PNG and re-encodes to JPEG with the requested quality", async () => {
    const { engine, calls } = makeFakeEngine(2);
    await exportPagesAsImages(
      BYTES,
      "jpeg",
      { quality: 60 },
      fakeLoader(engine),
    );
    expect(calls.decoded).toBe(2);
    expect(calls.encodedJpeg).toBe(2);
    expect(calls.jpegQuality).toBe(60);
  });

  it("re-encodes to WebP (lossless, no quality arg)", async () => {
    const { engine, calls } = makeFakeEngine(2);
    await exportPagesAsImages(BYTES, "webp", {}, fakeLoader(engine));
    expect(calls.decoded).toBe(2);
    expect(calls.encodedWebp).toBe(2);
  });

  it("translates dpi to an engine render scale (scale = dpi / 72)", async () => {
    const { engine, calls } = makeFakeEngine(1);
    await exportPagesAsImages(BYTES, "png", { dpi: 144 }, fakeLoader(engine));
    expect(calls.scales[0]).toBeCloseTo(2); // 144 / 72
  });

  it("defaults to 150 dpi when no dpi is provided", async () => {
    const { engine, calls } = makeFakeEngine(1);
    await exportPagesAsImages(BYTES, "png", {}, fakeLoader(engine));
    expect(calls.scales[0]).toBeCloseTo(150 / 72);
  });

  it("opens the engine with the provided bytes and closes the doc", async () => {
    const { engine, calls } = makeFakeEngine(1);
    const loader = fakeLoader(engine);
    await exportPagesAsImages(BYTES, "png", {}, loader);
    expect(engine.open).toHaveBeenCalledTimes(1);
    expect(engine.open.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
    expect(calls.closed).toBe(1);
  });

  it("closes the doc even if rasterisation throws", async () => {
    const { engine, calls } = makeFakeEngine(1);
    engine.open = vi.fn(() => ({
      pageCount: () => 1,
      renderPage: () => {
        throw new Error("boom");
      },
      close: () => {
        calls.closed += 1;
      },
    })) as never;
    await expect(
      exportPagesAsImages(BYTES, "png", {}, fakeLoader(engine)),
    ).rejects.toThrow(/boom/);
    expect(calls.closed).toBe(1);
  });

  it("handles every image format value", async () => {
    const formats: ImageExportFormat[] = ["png", "jpeg", "webp"];
    for (const format of formats) {
      const { engine } = makeFakeEngine(1);
      const blob = await exportPagesAsImages(
        BYTES,
        format,
        {},
        fakeLoader(engine),
      );
      expect(blob.type).toBe("application/zip");
      const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
      expect(Object.keys(zip)).toEqual([`page-1.${format}`]);
    }
  });
});
