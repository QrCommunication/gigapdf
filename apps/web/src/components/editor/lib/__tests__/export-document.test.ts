import { describe, it, expect, vi } from "vitest";
import {
  EXPORT_FORMATS,
  exportFilename,
  isExportFormat,
  exportFormatDescriptor,
  type ExportFormat,
} from "../export-formats";
import { exportDocumentAs } from "../export-document";

// ─── export-formats (pure) ──────────────────────────────────────────────────

describe("export-formats", () => {
  it("describes every supported format with extension/contentType/kind", () => {
    const formats: ExportFormat[] = [
      "docx",
      "xlsx",
      "pptx",
      "odt",
      "ods",
      "odp",
      "html",
      "rtf",
      "pdf",
    ];
    for (const f of formats) {
      const d = exportFormatDescriptor(f);
      expect(d.extension).toBe(f);
      expect(typeof d.contentType).toBe("string");
      expect(d.contentType.length).toBeGreaterThan(0);
      expect(["binary", "text"]).toContain(d.kind);
    }
  });

  it("maps OOXML + OpenDocument MIME types correctly", () => {
    expect(EXPORT_FORMATS.docx.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(EXPORT_FORMATS.xlsx.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(EXPORT_FORMATS.pptx.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(EXPORT_FORMATS.odt.contentType).toBe(
      "application/vnd.oasis.opendocument.text",
    );
    expect(EXPORT_FORMATS.ods.contentType).toBe(
      "application/vnd.oasis.opendocument.spreadsheet",
    );
    expect(EXPORT_FORMATS.odp.contentType).toBe(
      "application/vnd.oasis.opendocument.presentation",
    );
    expect(EXPORT_FORMATS.pdf.contentType).toBe("application/pdf");
  });

  it("classifies html and rtf as text, the rest as binary", () => {
    expect(EXPORT_FORMATS.html.kind).toBe("text");
    expect(EXPORT_FORMATS.rtf.kind).toBe("text");
    expect(EXPORT_FORMATS.docx.kind).toBe("binary");
    expect(EXPORT_FORMATS.pdf.kind).toBe("binary");
  });

  it("isExportFormat accepts known formats and rejects others", () => {
    expect(isExportFormat("docx")).toBe(true);
    expect(isExportFormat("odp")).toBe(true);
    expect(isExportFormat("png")).toBe(false);
    expect(isExportFormat("")).toBe(false);
    expect(isExportFormat("constructor")).toBe(false);
  });

  describe("exportFilename", () => {
    it("strips an existing extension and appends the target extension", () => {
      expect(exportFilename("invoice.pdf", "docx")).toBe("invoice.docx");
      expect(exportFilename("report.final.pdf", "odt")).toBe(
        "report.final.odt",
      );
    });

    it("uses the base name verbatim when it has no extension", () => {
      expect(exportFilename("contract", "rtf")).toBe("contract.rtf");
    });

    it("falls back to 'document' for empty/nullish names", () => {
      expect(exportFilename("", "html")).toBe("document.html");
      expect(exportFilename(null, "pdf")).toBe("document.pdf");
      expect(exportFilename(undefined, "xlsx")).toBe("document.xlsx");
      expect(exportFilename("   ", "ods")).toBe("document.ods");
    });
  });
});

// ─── export-document (injected engine loader) ───────────────────────────────

/**
 * Minimal fake `GigaPdfDoc` capturing which `to*()` / `save()` method the helper
 * calls. Only the methods exercised here are implemented.
 */
function makeFakeDoc() {
  const calls = {
    method: "" as string,
    closed: 0,
  };
  const record = (name: string, ret: Uint8Array | string) => () => {
    calls.method = name;
    return ret as never;
  };
  const doc = {
    toDocx: record("toDocx", new Uint8Array([1])),
    toXlsx: record("toXlsx", new Uint8Array([2])),
    toPptx: record("toPptx", new Uint8Array([3])),
    toOdt: record("toOdt", new Uint8Array([4])),
    toOds: record("toOds", new Uint8Array([5])),
    toOdp: record("toOdp", new Uint8Array([6])),
    toHtml: record("toHtml", "<html></html>"),
    toRtf: record("toRtf", "{\\rtf1}"),
    save: record("save", new Uint8Array([9])),
    // The reflowable targets (markdown/csv/epub) lower via the model: the helper
    // calls toModel() on the doc, then the engine's modelTo*() raisers.
    toModel: () => {
      calls.method = "toModel";
      return { kind: "model" };
    },
    close: () => {
      calls.closed += 1;
    },
  };
  return { doc, calls };
}

function fakeLoader(doc: ReturnType<typeof makeFakeDoc>["doc"]) {
  const open = vi.fn((_bytes: Uint8Array) => doc);
  // The engine exposes the model-raising exporters used by markdown/csv/epub.
  const engine = {
    open,
    modelToMarkdown: (_m: unknown) => "# md",
    modelToCsv: (_m: unknown) => "a,b",
    modelToEpub: (_m: unknown) => new Uint8Array([7]),
  };
  return Object.assign(async () => engine as never, { open });
}

const BYTES = new Uint8Array([9, 9, 9]);

describe("exportDocumentAs", () => {
  const cases: Array<{ format: ExportFormat; method: string }> = [
    { format: "docx", method: "toDocx" },
    { format: "xlsx", method: "toXlsx" },
    { format: "pptx", method: "toPptx" },
    { format: "odt", method: "toOdt" },
    { format: "ods", method: "toOds" },
    { format: "odp", method: "toOdp" },
    { format: "html", method: "toHtml" },
    { format: "rtf", method: "toRtf" },
    { format: "pdf", method: "save" },
    // Reflowable targets go through the model: doc.toModel() is the last method
    // recorded on the doc; the engine's modelTo*() raiser produces the bytes.
    { format: "markdown", method: "toModel" },
    { format: "csv", method: "toModel" },
    { format: "epub", method: "toModel" },
  ];

  for (const { format, method } of cases) {
    it(`dispatches ${format} to doc.${method}() and returns a Blob with the right MIME`, async () => {
      const { doc, calls } = makeFakeDoc();
      const blob = await exportDocumentAs(BYTES, format, fakeLoader(doc));
      expect(calls.method).toBe(method);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe(EXPORT_FORMATS[format].contentType);
      expect(calls.closed).toBe(1);
    });
  }

  it("closes the doc even if serialisation throws", async () => {
    const { doc, calls } = makeFakeDoc();
    doc.toDocx = () => {
      throw new Error("boom");
    };
    await expect(exportDocumentAs(BYTES, "docx", fakeLoader(doc))).rejects.toThrow(
      /boom/,
    );
    expect(calls.closed).toBe(1);
  });

  it("opens the engine with the provided bytes", async () => {
    const { doc } = makeFakeDoc();
    const loader = fakeLoader(doc);
    await exportDocumentAs(BYTES, "pdf", loader);
    expect(loader.open).toHaveBeenCalledTimes(1);
    expect(loader.open.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
  });
});
