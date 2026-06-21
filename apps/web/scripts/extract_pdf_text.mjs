#!/usr/bin/env node
/**
 * Extract the plain-text layer of a PDF using the native WASM engine.
 *
 * The Python backend has no PDF parser (zero-binary policy): text extraction
 * lives entirely in `@qrcommunication/gigapdf-lib`. This tiny helper is the
 * bridge used by `scripts/backfill_index.py` to re-index legacy documents that
 * were uploaded before client-side extraction existed.
 *
 * Usage:  node extract_pdf_text.mjs <path-to.pdf>
 * Output: the extracted text on stdout (empty if the PDF has no text layer).
 *         Exit 0 on success, non-zero (message on stderr) on failure.
 *
 * Run with cwd inside apps/web so Node resolves the workspace dependency.
 */
import { readFileSync } from "node:fs";
import { GigaPdfEngine } from "@qrcommunication/gigapdf-lib";

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: extract_pdf_text.mjs <file.pdf>\n");
  process.exit(2);
}

try {
  const bytes = new Uint8Array(readFileSync(path));
  const giga = await GigaPdfEngine.loadDefault();
  const doc = giga.open(bytes); // throws if the PDF can't be parsed
  try {
    process.stdout.write(doc.toText() ?? "");
  } finally {
    doc.close();
  }
} catch (err) {
  process.stderr.write(`extract_failed: ${err?.message ?? String(err)}\n`);
  process.exit(1);
}
