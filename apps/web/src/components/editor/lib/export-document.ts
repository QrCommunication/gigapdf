/**
 * export-document.ts
 *
 * Client-side helper for the editor's universal export menu (#84).
 *
 * The current document (the editor's `currentPdfFile` source of truth) is opened
 * through the shared GigaPDF engine ({@link loadPdfEngine} — the same single wasm
 * instance that rasterises page backgrounds and bakes headers/footers, so we
 * never load a second engine) and lowered into the requested target format by
 * the SDK's `toDocx()` / `toXlsx()` / `toPptx()` / `toOdt()` / `toOds()` /
 * `toOdp()` / `toHtml()` / `toRtf()` / `save()` methods.
 *
 * This is a strictly READ-ONLY consumer: it opens a short-lived `GigaPdfDoc` on a
 * copy of the current bytes, serialises it to the target format, and closes the
 * doc. It never mutates `currentPdfFile`, the scene graph, or the operations
 * queue — exactly like {@link file://./page-headers-footers.ts}, minus the
 * re-adoption step.
 *
 * No React, no DOM — trivially unit-testable with an injected engine loader.
 */

import { loadPdfEngine } from "@giga-pdf/canvas";
import {
  EXPORT_FORMATS,
  exportFilename,
  type ExportFormat,
} from "./export-formats";

/** Loader for the shared GigaPDF engine; injectable for tests. */
type EngineLoader = typeof loadPdfEngine;

/** Normalise PDF bytes to a `Uint8Array` the engine can open. */
function toBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

/**
 * Copy bytes into a freshly-allocated `ArrayBuffer`-backed view so the result is
 * a `Uint8Array<ArrayBuffer>` — directly usable as a `BlobPart` (the SDK's
 * `to*()` / `save()` return the looser `Uint8Array<ArrayBufferLike>`).
 */
function freshCopy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/**
 * Opaque unified-model handle (`GigaDocument`) returned by `toModel()` and
 * consumed by the engine's `modelTo*` exporters. Typed as `unknown` here so this
 * module stays decoupled from the SDK's public type surface.
 */
type Model = unknown;

/**
 * Minimal structural view of the SDK document we rely on here. Declared locally
 * so this module stays decoupled from the SDK's public type surface (the methods
 * are stable on `GigaPdfDoc`).
 *
 * `docx`/`xlsx`/… lower directly via dedicated `to*()` methods; the reflowable
 * targets (`markdown`/`csv`/`epub`) go through the unified model — `toModel()`
 * here, then the engine's `modelTo*()` raisers below.
 */
interface ExportableDoc {
  toDocx(): Uint8Array;
  toXlsx(): Uint8Array;
  toPptx(): Uint8Array;
  toOdt(): Uint8Array;
  toOds(): Uint8Array;
  toOdp(): Uint8Array;
  toHtml(): string;
  toRtf(): string;
  save(): Uint8Array;
  saveCompressed(): Uint8Array;
  toModel(): Model;
  close(): void;
}

/** Minimal structural view of the SDK engine's model-raising exporters. */
interface ModelExporter {
  modelToMarkdown(model: Model): string;
  modelToCsv(model: Model): string;
  modelToEpub(model: Model): Uint8Array;
}

/** Run the right SDK method for `format`, returning a `BlobPart`. */
function serialise(
  engine: ModelExporter,
  doc: ExportableDoc,
  format: ExportFormat,
): BlobPart {
  switch (format) {
    case "docx":
      return freshCopy(doc.toDocx());
    case "xlsx":
      return freshCopy(doc.toXlsx());
    case "pptx":
      return freshCopy(doc.toPptx());
    case "odt":
      return freshCopy(doc.toOdt());
    case "ods":
      return freshCopy(doc.toOds());
    case "odp":
      return freshCopy(doc.toOdp());
    case "html":
      return doc.toHtml();
    case "rtf":
      return doc.toRtf();
    case "pdf":
      return freshCopy(doc.saveCompressed());
    case "markdown":
      return engine.modelToMarkdown(doc.toModel());
    case "csv":
      return engine.modelToCsv(doc.toModel());
    case "epub":
      return freshCopy(engine.modelToEpub(doc.toModel()));
    default: {
      // Exhaustiveness guard — a new ExportFormat must be handled above.
      const never: never = format;
      throw new Error(`Unsupported export format: ${String(never)}`);
    }
  }
}

/**
 * Lower `source` (the current PDF bytes) into `format` and return a download-ready
 * `Blob`. Opens a short-lived `GigaPdfDoc` on the shared engine, serialises it,
 * and closes the doc in `finally`. Throws if the engine cannot open the bytes;
 * the caller surfaces that as an error toast.
 */
export async function exportDocumentAs(
  source: ArrayBuffer | Uint8Array,
  format: ExportFormat,
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<Blob> {
  const engine = await loadEngine();
  // open → serialise → close in the same synchronous tick (no await between
  // open and close) so the short-lived doc never overlaps page rendering on the
  // shared wasm instance — mirrors page-headers-footers.ts. The reflowable
  // targets raise the model via the engine's `modelTo*` exporters.
  const doc = engine.open(toBytes(source)) as unknown as ExportableDoc;
  try {
    const part = serialise(engine as unknown as ModelExporter, doc, format);
    return new Blob([part], { type: EXPORT_FORMATS[format].contentType });
  } finally {
    doc.close();
  }
}

export { exportFilename };
