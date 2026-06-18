#!/usr/bin/env node
// run.mjs — orchestrate the GigaPDF visual-fidelity harness over a sample.
//
// Usage:
//   node tools/visual-diff/run.mjs                 # default sample, geometry + pixel
//   node tools/visual-diff/run.mjs --no-pixel      # geometry only
//   node tools/visual-diff/run.mjs --tol=8         # looser geometry tolerance
//   node tools/visual-diff/run.mjs --max-pages=3   # cap pages per PDF
//   node tools/visual-diff/run.mjs file1.pdf file2.pdf   # explicit files
//
// Output: two tables (geometry, pixel) sorted WORST -> BEST, plus a diagnosis
// list for the problematic PDFs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { silencePdfjsWarnings, basename } from "./lib-adapters.mjs";
import { geometryDiffPdf, DEFAULT_TOL } from "./geometry-diff.mjs";
import { pixelDiffPdf } from "./pixel-diff.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "out");
const DOWNLOADS = "/home/rony/Téléchargements";
const FIXTURES = "/home/rony/Projets/gigapdf-lib/fixtures";

// Curated, varied default sample (~15 PDFs): every lib fixture (covers
// simple/rotated/CJK/forms/images/annotations) + a spread of real-world docs
// (bank statements, multi-page reports, scans, signed PDFs, invoices).
const DEFAULT_SAMPLE = [
  // lib fixtures — known-shape, exercise specific features
  `${FIXTURES}/simple.pdf`,
  `${FIXTURES}/simple-text.pdf`,
  `${FIXTURES}/mixed-fonts.pdf`,
  `${FIXTURES}/embedded-fonts.pdf`,
  `${FIXTURES}/cjk-text.pdf`,
  `${FIXTURES}/rotated-pages.pdf`,
  `${FIXTURES}/multi-page.pdf`,
  `${FIXTURES}/with-images.pdf`,
  `${FIXTURES}/with-annotations.pdf`,
  // real-world documents
  `${DOWNLOADS}/01-executive-summary.pdf`,
  `${DOWNLOADS}/2025-08-08_12-20-42_bunq-rib.pdf`,
  `${DOWNLOADS}/2025-12-08_13-37-39_bunq-statement.pdf`,
  `${DOWNLOADS}/01_Attestation_non_condamnation_filiation_Rony_LICHA.pdf`,
  `${DOWNLOADS}/annotations-Marcel-Licha (1).pdf`,
  `${DOWNLOADS}/94016349600018.pdf`,
];

function parseArgs(argv) {
  const opts = { tol: DEFAULT_TOL, maxPages: 5, pixel: true, files: [] };
  for (const a of argv) {
    if (a === "--no-pixel") opts.pixel = false;
    else if (a.startsWith("--tol=")) opts.tol = Number(a.slice(6));
    else if (a.startsWith("--max-pages=")) opts.maxPages = Number(a.slice(12));
    else if (a.startsWith("--")) {
      /* ignore unknown flags */
    } else opts.files.push(a);
  }
  return opts;
}

function resolveSample(files) {
  const list = files.length ? files : DEFAULT_SAMPLE;
  return list
    .map((f) => (path.isAbsolute(f) ? f : path.resolve(process.cwd(), f)))
    .filter((f) => {
      const exists = fs.existsSync(f);
      if (!exists) console.error(`! skipping (not found): ${f}`);
      return exists;
    });
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function padL(s, n) {
  s = String(s);
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

async function main() {
  silencePdfjsWarnings();
  const opts = parseArgs(process.argv.slice(2));
  const sample = resolveSample(opts.files);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`\nGigaPDF visual-fidelity harness`);
  console.log(
    `sample: ${sample.length} PDFs · geometry tol=${opts.tol}pt · maxPages/pdf=${opts.maxPages} · pixel=${opts.pixel}\n`
  );

  const rows = [];
  for (const f of sample) {
    process.stderr.write(`· ${basename(f)} ... `);
    const geo = await geometryDiffPdf(f, { tol: opts.tol, maxPages: opts.maxPages });
    let pix = null;
    if (opts.pixel) {
      pix = await pixelDiffPdf(f, {
        scale: 1.5,
        maxPages: Math.min(opts.maxPages, 3),
        outDir: OUT_DIR,
        writeFirstPng: true,
      });
    }
    rows.push({ file: f, geo, pix });
    process.stderr.write("done\n");
  }

  printGeometryTable(rows);
  if (opts.pixel) printPixelTable(rows);
  printDiagnostics(rows, opts);

  // Persist raw JSON for downstream tooling / re-analysis.
  fs.writeFileSync(
    path.join(OUT_DIR, "results.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), opts, rows }, null, 2)
  );
  console.log(`\nRaw results: ${path.join(OUT_DIR, "results.json")}`);
  console.log(`Home-engine page-0 PNGs (for manual inspection): ${OUT_DIR}/*.lib.p0.png\n`);
}

// --- geometry table (sorted worst -> best by matchPct) ---------------------
function printGeometryTable(rows) {
  const data = rows
    .map((r) => {
      const g = r.geo;
      return {
        name: basename(r.file),
        ok: g.ok,
        pages: g.ok ? g.pagesTested : "-",
        lib: g.ok ? g.libRuns : "-",
        pdfjs: g.ok ? g.pdfjsItems : "-",
        match: g.ok ? g.matchPct : null,
        seg: g.ok && g.segRatio != null ? g.segRatio : null,
        err: g.ok ? "" : `${g.stage}: ${g.error}`,
      };
    })
    .sort((a, b) => sortByScore(a.match, a.ok, b.match, b.ok));

  console.log(`\n=== GEOMETRY DIFF (text-run position match, worst → best) ===`);
  console.log(
    pad("PDF", 46) +
      padL("pg", 3) +
      padL("libRuns", 9) +
      padL("pdfjs", 7) +
      padL("match%", 8) +
      padL("seg×", 7) +
      "  note"
  );
  console.log("-".repeat(96));
  for (const d of data) {
    const matchStr = d.match == null ? "FAIL" : d.match.toFixed(1);
    const segStr = d.seg == null ? "-" : d.seg.toFixed(2);
    console.log(
      pad(d.name, 46) +
        padL(d.pages, 3) +
        padL(d.lib, 9) +
        padL(d.pdfjs, 7) +
        padL(matchStr, 8) +
        padL(segStr, 7) +
        "  " +
        (d.err || segNote(d.seg, d.match))
    );
  }
}

// --- pixel table (sorted worst -> best by diffPct) -------------------------
function printPixelTable(rows) {
  const data = rows
    .map((r) => {
      const p = r.pix;
      return {
        name: basename(r.file),
        ok: p && p.ok,
        pages: p && p.ok ? p.pagesTested : "-",
        diff: p && p.ok ? p.diffPct : null,
        err: p && p.ok ? "" : `${p?.stage || "pixel"}: ${p?.error || "n/a"}`,
      };
    })
    .sort((a, b) => {
      // worst (highest diff%) first; failures sink to bottom
      if (a.diff == null && b.diff == null) return 0;
      if (a.diff == null) return 1;
      if (b.diff == null) return -1;
      return b.diff - a.diff;
    });

  console.log(`\n=== PIXEL DIFF (% pixels differing vs pdfjs, worst → best) ===`);
  console.log(pad("PDF", 46) + padL("pg", 3) + padL("diff%", 9) + "  note");
  console.log("-".repeat(80));
  for (const d of data) {
    const diffStr = d.diff == null ? "FAIL" : d.diff.toFixed(2);
    console.log(pad(d.name, 46) + padL(d.pages, 3) + padL(diffStr, 9) + "  " + d.err);
  }
}

// --- problematic PDF diagnostics -------------------------------------------
function printDiagnostics(rows, opts) {
  console.log(`\n=== PROBLEMATIC PDFs — diagnosis ===`);
  const issues = [];
  for (const r of rows) {
    const name = basename(r.file);
    const g = r.geo;
    if (!g.ok) {
      issues.push(`✗ ${name}: lib FAILED to open/parse (${g.stage}) — ${g.error}`);
      continue;
    }
    if (g.libRuns === 0 && g.pdfjsItems > 0) {
      issues.push(
        `✗ ${name}: lib extracted 0 text runs but pdfjs found ${g.pdfjsItems} — text-decode failure (font/encoding) or scanned page.`
      );
      continue;
    }
    if (g.libRuns === 0 && g.pdfjsItems === 0) {
      issues.push(
        `· ${name}: no extractable text in either engine (likely scanned/image-only) — judge via pixel diff.`
      );
      continue;
    }
    // page-content duplication — a page-indexing extraction defect
    if (g.duplicatePages && g.duplicatePages.length) {
      const m = g.duplicatePages.map((d) => `p${d.page}≡p${d.sameAs}`).join(", ");
      issues.push(
        `✗ ${name}: lib textElements returns DUPLICATE content across pages (${m}) — page-indexing extraction bug; later pages echo an earlier page's text.`
      );
    }
    if (g.matchPct < 90) {
      // distinguish systematic offset from scattered misplacement; and whether
      // the unmatched runs are off by LINE (large dy) or COLUMN (large dx).
      const offset = detectConstantOffset(g.worst);
      const w0 = g.worst[0];
      const axis =
        w0 && w0.dy != null && w0.dx != null
          ? w0.dy > w0.dx
            ? `wrong line (Δy≈${w0.dy}px)`
            : `wrong column (Δx≈${w0.dx}px)`
          : "";
      const detail = offset
        ? `constant offset ≈ (dx ${offset.dx}, dy ${offset.dy}) px on ${offset.count}/${g.worst.length} worst runs`
        : `worst unmatched run "${w0?.text}" ${axis}`;
      issues.push(`✗ ${name}: only ${g.matchPct.toFixed(1)}% runs positioned — ${detail}.`);
    } else if (g.segRatio != null && (g.segRatio >= 1.6 || g.segRatio <= 0.6)) {
      const dir = g.segRatio >= 1.6 ? "lib over-segments" : "pdfjs over-segments";
      issues.push(
        `~ ${name}: ${g.matchPct.toFixed(1)}% positioned but seg-ratio ${g.segRatio.toFixed(2)} (${dir}) — BENIGN line fragmentation, positions OK.`
      );
    }
    // rotation flag disagreement (independent of position match)
    if (g.rotateMismatches && g.rotateMismatches.length) {
      const m = g.rotateMismatches
        .map((x) => `p${x.page}: lib=${x.lib}° vs pdfjs=${x.pdfjs}°`)
        .join(", ");
      issues.push(
        `✗ ${name}: /Rotate flag mismatch (${m}) — lib pageInfo.rotation disagrees with the PDF's intrinsic page rotation.`
      );
    }
    // pixel-only problems (geometry fine, render off)
    if (r.pix && r.pix.ok && r.pix.diffPct > 12 && g.matchPct >= 90) {
      issues.push(
        `✗ ${name}: geometry good (${g.matchPct.toFixed(1)}%) but pixel diff ${r.pix.diffPct.toFixed(1)}% — rendering divergence (fonts/glyphs/images), not positioning.`
      );
    }
  }
  if (issues.length === 0) {
    console.log("  (none — all sampled PDFs within thresholds)");
  } else {
    for (const i of issues) console.log("  " + i);
  }
}

// heuristic: are the worst runs all shifted by ~the same vector?
function detectConstantOffset(worst) {
  const finite = worst.filter((w) => w.pdfjs && Number.isFinite(w.dist));
  if (finite.length < 2) return null;
  const dxs = finite.map((w) => w.lib.x - w.pdfjs.x);
  const dys = finite.map((w) => w.lib.yTop - w.pdfjs.yTop);
  const span = (arr) => Math.max(...arr) - Math.min(...arr);
  const median = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  if (span(dxs) <= 4 && span(dys) <= 4) {
    return { dx: round(median(dxs)), dy: round(median(dys)), count: finite.length };
  }
  return null;
}

function segNote(seg, match) {
  if (seg == null || match == null) return "";
  if (match >= 90 && seg >= 1.6) return "(benign: lib over-segments)";
  if (match >= 90 && seg <= 0.6) return "(benign: pdfjs over-segments)";
  return "";
}

function sortByScore(matchA, okA, matchB, okB) {
  // failures (null/!ok) first, then ascending matchPct (worst first)
  const sa = !okA || matchA == null ? -1 : matchA;
  const sb = !okB || matchB == null ? -1 : matchB;
  return sa - sb;
}

function round(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : n;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
