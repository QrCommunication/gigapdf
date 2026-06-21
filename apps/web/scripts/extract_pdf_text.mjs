#!/usr/bin/env node
/**
 * Extract the plain text of a PDF using the native WASM engine.
 *
 * The Python backend has no PDF parser (zero-binary policy): text extraction
 * lives entirely in `@qrcommunication/gigapdf-lib`. This helper is the bridge
 * used by `scripts/backfill_index.py` to re-index legacy documents.
 *
 *   node extract_pdf_text.mjs <file.pdf>          # text layer only
 *   node extract_pdf_text.mjs <file.pdf> --ocr    # OCR fallback if no text layer
 *
 * With `--ocr`, when the embedded text layer is empty (scanned/image PDF), each
 * page is run through the bundled Latin OCR model (`alpha`, covers FR/EN). OCR
 * is CPU-heavy, so it only kicks in when `toText()` yields nothing.
 *
 * Output: the extracted text on stdout. Exit 0 on success, non-zero on failure.
 * Run with cwd inside apps/web so Node resolves the workspace dependency.
 */
import { readFileSync } from "node:fs";
import { GigaPdfEngine } from "@qrcommunication/gigapdf-lib";

const path = process.argv[2];
const wantOcr = process.argv.includes("--ocr");
if (!path) {
  process.stderr.write("usage: extract_pdf_text.mjs <file.pdf> [--ocr]\n");
  process.exit(2);
}

// A page that is genuinely scanned yields ~no text-layer characters.
const MIN_TEXT_LAYER_CHARS = 8;

try {
  const bytes = new Uint8Array(readFileSync(path));
  const giga = await GigaPdfEngine.loadDefault();
  const doc = giga.open(bytes); // throws if the PDF can't be parsed
  try {
    const layer = doc.toText() ?? "";
    if (layer.trim().length >= MIN_TEXT_LAYER_CHARS || !wantOcr) {
      process.stdout.write(layer);
    } else {
      // Image-only PDF + OCR requested: recognise each page (Latin model).
      const loaded = await giga.loadBundledOcrModel("alpha");
      if (!loaded) {
        process.stderr.write("ocr_model_unavailable: alpha\n");
        process.stdout.write(layer); // emit whatever the text layer had
      } else {
        const pages = doc.pageCount();
        const parts = [];
        for (let p = 0; p < pages; p++) {
          parts.push(doc.ocrText(p, 2)); // scale 2 for small scanned text
        }
        process.stdout.write(parts.join("\n").trim());
      }
    }
  } finally {
    doc.close();
  }
} catch (err) {
  process.stderr.write(`extract_failed: ${err?.message ?? String(err)}\n`);
  process.exit(1);
}
