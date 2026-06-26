import { describe, it, expect, vi } from "vitest";
import {
  detectHeaderFooterFromModel,
  detectHeaderFooterFromOffice,
  projectOfficeToRunningHeaderFooter,
  projectOfficeBytesToRunningHeaderFooter,
} from "../office-headers-footers";
import type {
  GigaBlock,
  GigaDocument,
  GigaSection,
} from "@qrcommunication/gigapdf-lib";

/** Build a paragraph block whose runs concatenate to `text`. */
function paragraph(text: string): GigaBlock {
  return {
    id: 1,
    frame: null,
    rotation: { t: "d0" },
    kind: {
      t: "paragraph",
      v: { runs: [{ t: "run", v: { text, style: {}, source_index: null } }] },
    },
  } as unknown as GigaBlock;
}

/** Build a section with optional header/footer bands. */
function section(opts: {
  header?: GigaBlock[] | null;
  footer?: GigaBlock[] | null;
}): GigaSection {
  return {
    geometry: { width: 595, height: 842 },
    header: opts.header ?? null,
    footer: opts.footer ?? null,
    pages: [],
  } as unknown as GigaSection;
}

/** Build a model from sections. */
function model(sections: GigaSection[]): GigaDocument {
  return { v: 1, sections } as unknown as GigaDocument;
}

describe("detectHeaderFooterFromModel", () => {
  it("returns null/null for a null model", () => {
    expect(detectHeaderFooterFromModel(null)).toEqual({
      header: null,
      footer: null,
    });
  });

  it("returns null/null when no section carries a band", () => {
    expect(detectHeaderFooterFromModel(model([section({})]))).toEqual({
      header: null,
      footer: null,
    });
  });

  it("flattens header and footer runs of a single section", () => {
    const result = detectHeaderFooterFromModel(
      model([
        section({
          header: [paragraph("Company Confidential")],
          footer: [paragraph("Page footer")],
        }),
      ]),
    );
    expect(result).toEqual({
      header: "Company Confidential",
      footer: "Page footer",
    });
  });

  it("joins multiple blocks in a band with newlines", () => {
    const result = detectHeaderFooterFromModel(
      model([
        section({
          header: [paragraph("Line one"), paragraph("Line two")],
        }),
      ]),
    );
    expect(result.header).toBe("Line one\nLine two");
  });

  it("takes the first non-null band of each kind across sections", () => {
    const result = detectHeaderFooterFromModel(
      model([
        section({ header: [paragraph("First header")] }),
        section({ footer: [paragraph("Second-section footer")] }),
      ]),
    );
    expect(result).toEqual({
      header: "First header",
      footer: "Second-section footer",
    });
  });

  it("treats an empty band (only whitespace runs) as null", () => {
    const result = detectHeaderFooterFromModel(
      model([section({ header: [paragraph("   ")] })]),
    );
    expect(result.header).toBeNull();
  });

  it("ignores non-run inline shapes without throwing", () => {
    const block = {
      id: 2,
      frame: null,
      rotation: { t: "d0" },
      kind: {
        t: "paragraph",
        v: {
          runs: [
            { t: "image" },
            { t: "run", v: { text: "Real text", style: {}, source_index: null } },
            { t: "br" },
          ],
        },
      },
    } as unknown as GigaBlock;
    const result = detectHeaderFooterFromModel(
      model([section({ header: [block] })]),
    );
    expect(result.header).toBe("Real text");
  });

  it("ignores a block whose body has no runs array", () => {
    const tableBlock = {
      id: 3,
      frame: null,
      rotation: { t: "d0" },
      kind: { t: "table", v: { cells: [] } },
    } as unknown as GigaBlock;
    const result = detectHeaderFooterFromModel(
      model([section({ header: [tableBlock] })]),
    );
    expect(result.header).toBeNull();
  });
});

describe("detectHeaderFooterFromOffice", () => {
  const BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

  function fakeEngineLoader(returnedModel: GigaDocument | null) {
    const officeToModel = vi.fn(() => returnedModel);
    return Object.assign(async () => ({ officeToModel }) as never, {
      officeToModel,
    });
  }

  it("converts office bytes to a model and detects bands", async () => {
    const loader = fakeEngineLoader(
      model([section({ header: [paragraph("Detected header")] })]),
    );
    const result = await detectHeaderFooterFromOffice(BYTES, loader);
    expect(result.header).toBe("Detected header");
    expect(loader.officeToModel).toHaveBeenCalledOnce();
  });

  it("returns null/null when officeToModel returns null (unrecognised)", async () => {
    const result = await detectHeaderFooterFromOffice(
      BYTES,
      fakeEngineLoader(null),
    );
    expect(result).toEqual({ header: null, footer: null });
  });

  it("never throws — a thrown engine yields null/null", async () => {
    const throwingLoader = async () => {
      throw new Error("wasm boom");
    };
    const result = await detectHeaderFooterFromOffice(BYTES, throwingLoader);
    expect(result).toEqual({ header: null, footer: null });
  });
});

describe("projectOfficeToRunningHeaderFooter", () => {
  it("returns an empty default zone for a null model", () => {
    const def = projectOfficeToRunningHeaderFooter(null);
    expect(def.default.header).toEqual([]);
    expect(def.default.footer).toEqual([]);
  });

  it("projects each band block into a left-anchored text item", () => {
    const def = projectOfficeToRunningHeaderFooter(
      model([
        section({
          header: [paragraph("Company Confidential"), paragraph("Draft")],
          footer: [paragraph("Page footer")],
        }),
      ]),
    );
    expect(def.default.header).toEqual([
      { type: "text", text: "Company Confidential", anchor: "left", size: 10 },
      { type: "text", text: "Draft", anchor: "left", size: 10 },
    ]);
    expect(def.default.footer).toEqual([
      { type: "text", text: "Page footer", anchor: "left", size: 10 },
    ]);
  });

  it("takes the first non-empty band of each kind across sections", () => {
    const def = projectOfficeToRunningHeaderFooter(
      model([
        section({ header: [paragraph("First header")] }),
        section({ footer: [paragraph("Second-section footer")] }),
      ]),
    );
    expect(def.default.header[0]).toMatchObject({ text: "First header" });
    expect(def.default.footer[0]).toMatchObject({
      text: "Second-section footer",
    });
  });
});

describe("projectOfficeBytesToRunningHeaderFooter", () => {
  function fakeEngineLoader(returnedModel: GigaDocument | null) {
    const officeToModel = vi.fn(() => returnedModel);
    return Object.assign(async () => ({ officeToModel }) as never, {
      officeToModel,
    });
  }

  it("converts office bytes and projects the bands", async () => {
    const loader = fakeEngineLoader(
      model([section({ footer: [paragraph("Confidential")] })]),
    );
    const def = await projectOfficeBytesToRunningHeaderFooter(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      loader,
    );
    expect(def.default.footer[0]).toMatchObject({ text: "Confidential" });
  });

  it("returns an empty definition on engine failure (never throws)", async () => {
    const throwing = async () => {
      throw new Error("boom");
    };
    const def = await projectOfficeBytesToRunningHeaderFooter(
      new Uint8Array([1]),
      throwing,
    );
    expect(def.default.header).toEqual([]);
    expect(def.default.footer).toEqual([]);
  });
});
