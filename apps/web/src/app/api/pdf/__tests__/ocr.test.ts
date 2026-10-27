/**
 * Tests for POST /api/pdf/ocr — which writing systems reach the engine.
 *
 * Regression (prod, 2026-10-27): the tools page sends `lang` ("fra+eng") but
 * the searchable/editable modes only read `scripts`, so the engine received no
 * script and the OCR service auto-selected a model per line — the Hebrew one on
 * a French invoice (garbage text, ~80 s per page). `lang` now drives the
 * recognizer whenever `scripts` is absent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

if (!("arrayBuffer" in File.prototype)) {
  Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    writable: true,
    value: function (this: File): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
}

const engine = vi.hoisted(() => ({
  makeSearchablePdf: vi.fn(),
  makeEditableOcrPdf: vi.fn(),
}));

vi.mock("@giga-pdf/pdf-engine", () => ({
  ocrPdf: vi.fn(),
  makeSearchablePdf: engine.makeSearchablePdf,
  makeEditableOcrPdf: engine.makeEditableOcrPdf,
  OcrUnavailableError: class OcrUnavailableError extends Error {},
  isOcrAvailable: vi.fn(),
  PDFCorruptedError: class PDFCorruptedError extends Error {},
}));
vi.mock("@/lib/auth-helpers", () => ({
  requireSession: vi.fn(async () => ({ ok: true, context: { userId: "user-1" } })),
}));
vi.mock("@/lib/server-logger", () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("server-only", () => ({}));

import { POST } from "../ocr/route";

const PDF = new Uint8Array(Array.from("%PDF-1.7\nscan\n%%EOF", (c) => c.charCodeAt(0)));

function ocrRequest(fields: Record<string, string>): Request {
  const fd = new FormData();
  fd.append("file", new File([PDF], "scan.pdf", { type: "application/pdf" }));
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  const req = new Request("http://localhost/api/pdf/ocr", {
    method: "POST",
    body: "dummy",
    headers: { "Content-Type": "text/plain" },
  });
  Object.defineProperty(req, "formData", { value: () => Promise.resolve(fd) });
  return req;
}

const languagesSentToEngine = () =>
  (engine.makeSearchablePdf.mock.calls[0]?.[1] as { languages?: string[] }).languages;

beforeEach(() => {
  engine.makeSearchablePdf.mockReset();
  engine.makeSearchablePdf.mockResolvedValue({ bytes: PDF, pagesProcessed: 1, wordsAdded: 3 });
});

describe("POST /api/pdf/ocr — script selection", () => {
  it("derives the Latin script from the tools-page lang", async () => {
    const res = await POST(ocrRequest({ output: "searchable", lang: "fra+eng" }));

    expect(res.status).toBe(200);
    expect(languagesSentToEngine()).toEqual(["alpha"]);
  });

  it("uses the Latin script when neither scripts nor lang is sent", async () => {
    await POST(ocrRequest({ output: "searchable" }));

    expect(languagesSentToEngine()).toEqual(["alpha"]);
  });

  it("keeps explicit scripts from the OCR dialogs over lang", async () => {
    await POST(ocrRequest({ output: "searchable", lang: "fra", scripts: '["cyrillic"]' }));

    expect(languagesSentToEngine()).toEqual(["cyrillic"]);
  });
});
