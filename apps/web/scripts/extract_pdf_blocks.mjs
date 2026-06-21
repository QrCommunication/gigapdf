#!/usr/bin/env node
/**
 * Extract POSITIONED text blocks from a PDF using the native WASM engine.
 *
 * Outputs JSON `[{ page, bbox:{x,y,w,h}, text }]` on stdout, where bbox is in PDF
 * user-space points (lower-left origin) — the exact shape the semantic index
 * (`store_ocr_blocks`) and the page-preview highlighter
 * (`/api/pdf/document-page-image`) expect. This is the geometry-aware
 * counterpart of `extract_pdf_text.mjs`, used by `scripts/backfill_index.py` so
 * search hits can be highlighted on the rendered page.
 *
 *   node extract_pdf_blocks.mjs <file.pdf>          # text-layer lines
 *   node extract_pdf_blocks.mjs <file.pdf> --ocr    # OCR fallback for scanned pages
 *
 * Run with cwd inside apps/web so Node resolves the workspace dependency.
 */
import { readFileSync } from "node:fs";
import { GigaPdfEngine } from "@qrcommunication/gigapdf-lib";

const path = process.argv[2];
const wantOcr = process.argv.includes("--ocr");
if (!path) {
  process.stderr.write("usage: extract_pdf_blocks.mjs <file.pdf> [--ocr]\n");
  process.exit(2);
}

// Bound the index size (very large scans can yield thousands of words).
const MAX_BLOCKS = 4000;

/** Group OCR words into lines by vertical proximity (better embeddings + fewer rows). */
function wordsToLines(words) {
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const w of sorted) {
    const text = (w.text || "").trim();
    if (!text) continue;
    const last = lines[lines.length - 1];
    // Same line if vertical centres are within half the word height.
    if (last && Math.abs(last.cy - (w.y + w.h / 2)) <= Math.max(w.h, last.h) * 0.5) {
      const right = Math.max(last.x + last.w, w.x + w.w);
      last.x = Math.min(last.x, w.x);
      last.y = Math.min(last.y, w.y);
      last.w = right - last.x;
      last.h = Math.max(last.h, w.h);
      last.text += " " + text;
    } else {
      lines.push({ x: w.x, y: w.y, w: w.w, h: w.h, cy: w.y + w.h / 2, text });
    }
  }
  return lines;
}

try {
  const bytes = new Uint8Array(readFileSync(path));
  const giga = await GigaPdfEngine.loadDefault();
  const doc = giga.open(bytes);
  let ocrLoaded = false;
  const blocks = [];
  try {
    const pages = doc.pageCount();
    for (let p = 0; p < pages && blocks.length < MAX_BLOCKS; p++) {
      let lines = doc.structuredText(p) || []; // TextLine[]: { x, y, w, h, text }
      if (lines.length === 0 && wantOcr) {
        if (!ocrLoaded) {
          await giga.loadBundledOcrModel("alpha"); // Latin (FR/EN)
          ocrLoaded = true;
        }
        lines = wordsToLines(doc.ocr(p, 2)); // OcrWord[] (scale 2 for small text)
      }
      for (const ln of lines) {
        const text = (ln.text || "").trim();
        if (!text) continue;
        blocks.push({ page: p, bbox: { x: ln.x, y: ln.y, w: ln.w, h: ln.h }, text });
        if (blocks.length >= MAX_BLOCKS) break;
      }
    }
  } finally {
    doc.close();
  }
  process.stdout.write(JSON.stringify(blocks));
} catch (err) {
  process.stderr.write(`extract_failed: ${err?.message ?? String(err)}\n`);
  process.exit(1);
}
