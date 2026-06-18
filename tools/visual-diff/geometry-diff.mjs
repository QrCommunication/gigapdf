// geometry-diff: objective, canvas-free fidelity measure.
//
// For each page we ask: does every text run reported by the GigaPDF home
// engine (textElements) have a pdfjs text item sitting at the same place?
//
// We deliberately measure POSITION, not count. pdfjs and the home engine
// segment lines differently (ligatures, kerned TJ fragments, RTL shaping),
// so a raw count mismatch is NOT an error. A run is "matched" when at least
// one pdfjs item starts within `tol` points of it on both axes.
//
// Reported per page / per PDF:
//   - libRuns, pdfjsItems  (raw counts, to flag over/under-segmentation)
//   - matchPct             (% of lib runs that have a pdfjs neighbour)
//   - worst                (the lib runs with the largest nearest-neighbour
//                            distance — the actual misplacements)

import {
  openWithGiga,
  openWithPdfjs,
  gigaRunToWeb,
  pdfjsItemToWeb,
  getPdfjs,
  num,
} from "./lib-adapters.mjs";

export const DEFAULT_TOL = 6; // points

/**
 * Build the list of web-space pdfjs items for one page.
 *
 * IMPORTANT: we force `rotation: 0` on the viewport so text coordinates are
 * emitted in UNROTATED page space. The GigaPDF engine also reports textElements
 * in unrotated page space (its pageInfo carries the /Rotate flag separately),
 * so this keeps both engines on the same coordinate basis even for rotated
 * pages. Verified on the rotated-pages fixture: with rotation:0, pdfjs and the
 * home engine agree exactly on x / yTop for all runs.
 */
async function pdfjsPageItems(pdfjsDoc, pageIndex) {
  const pdfjs = await getPdfjs();
  const page = await pdfjsDoc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1, rotation: 0 });
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!("str" in it)) continue;
    if (!it.str || !it.str.trim()) continue; // skip whitespace-only spans
    items.push(pdfjsItemToWeb(pdfjs, it, viewport));
  }
  return { items, pdfjsRotate: num(page.rotate) };
}

/**
 * Match a lib run against the pdfjs items by POSITION, two ways:
 *
 *  (a) start-point coincidence: |dx| and |dy| both within tol.
 *  (b) containment: the run's start falls INSIDE a pdfjs item's box
 *      (x within [itemX - tol, itemX + itemW + tol] and |dy| within tol).
 *
 * (b) is essential for the benign over-segmentation case: when the lib splits
 * one rendered line into several runs (ligatures / kerned TJ fragments), the
 * continuation runs start mid-line and have no pdfjs item *starting* there,
 * yet they sit exactly on the correct line at the correct horizontal offset.
 * Penalising them would conflate segmentation differences with real
 * misplacement — which is exactly what the mission warns against.
 *
 * Returns the best candidate { dx, dy, dist, contained, item } or null.
 * `dist` is the start-point Chebyshev distance (used for "worst" reporting);
 * `matched` is decided by the caller from (a) OR (b).
 */
function matchItem(run, items, tol) {
  let matched = false; // existence: ANY item satisfies start-match OR containment
  let nearest = null; // closest item by start-distance, for "worst" reporting
  for (const it of items) {
    const dx = Math.abs(run.x - it.x);
    const dy = Math.abs(run.yTop - it.yTop);
    const dist = Math.max(dx, dy);
    const startMatch = dx <= tol && dy <= tol;
    const contained =
      dy <= tol && run.x >= it.x - tol && run.x <= it.x + (Number.isFinite(it.w) ? it.w : 0) + tol;
    if (startMatch || contained) matched = true;
    if (!nearest || dist < nearest.dist) {
      nearest = { dx, dy, dist, startMatch, contained, item: it };
    }
  }
  if (!nearest) return { matched: false, dx: null, dy: null, dist: Infinity, item: null };
  return { ...nearest, matched };
}

/**
 * Compare one page.
 */
async function comparePage(gigaDoc, pdfjsDoc, pageIndex, tol) {
  // The lib's page API is 1-based (pageInfo/textElements/renderPage), same as
  // pdfjs's getPage(pageIndex + 1). Passing the 0-based pageIndex made page 0
  // and page 1 both resolve to the first page (0 saturates to 1), which faked a
  // "page-indexing bug" + wrong-page comparisons on multi-page docs.
  const info = gigaDoc.pageInfo(pageIndex + 1);
  const pageHeight = num(info.height);
  const libRotate = num(info.rotation);
  const libRunsRaw = gigaDoc.textElements(pageIndex + 1) || [];
  const libRuns = libRunsRaw
    .map((r) => gigaRunToWeb(r, pageHeight))
    .filter((r) => r.text && r.text.trim());

  const { items, pdfjsRotate } = await pdfjsPageItems(pdfjsDoc, pageIndex);

  let matched = 0;
  const distances = [];
  for (const run of libRuns) {
    const near = matchItem(run, items, tol);
    const isMatch = near.matched;
    if (isMatch) matched++;
    distances.push({
      text: run.text.slice(0, 48),
      lib: { x: round(run.x), yTop: round(run.yTop) },
      pdfjs: near ? { x: round(near.item.x), yTop: round(near.item.yTop) } : null,
      dx: near ? round(near.dx) : null,
      dy: near ? round(near.dy) : null,
      dist: near ? round(near.dist) : Infinity,
      matched: isMatch,
    });
  }

  // "Worst" = unmatched runs first, then by start distance descending.
  distances.sort((a, b) => {
    if (a.matched !== b.matched) return a.matched ? 1 : -1;
    return b.dist - a.dist;
  });

  // Lightweight fingerprint of the lib's text for this page, used to detect
  // cross-page content duplication (a page-indexing defect where
  // textElements(i) returns another page's content).
  const libFingerprint = libRunsRaw
    .slice(0, 8)
    .map((r) => String(r.text ?? "").trim())
    .join("¦");

  return {
    pageIndex,
    libRuns: libRuns.length,
    pdfjsItems: items.length,
    matched,
    matchPct: libRuns.length ? (matched / libRuns.length) * 100 : 100,
    libFingerprint,
    libRotate,
    pdfjsRotate,
    rotateMismatch: libRotate !== pdfjsRotate,
    worst: distances.slice(0, 3),
  };
}

/**
 * Compare a whole PDF (capped number of pages for speed on large docs).
 * @returns a structured result object (never throws).
 */
export async function geometryDiffPdf(absPath, { tol = DEFAULT_TOL, maxPages = 5 } = {}) {
  const giga = await openWithGiga(absPath);
  if (!giga.ok) {
    return { ok: false, stage: "giga-open", error: giga.error };
  }
  const pdf = await openWithPdfjs(absPath);
  if (!pdf.ok) {
    return { ok: false, stage: "pdfjs-open", error: pdf.error };
  }

  const gigaPages = safe(() => giga.doc.pageCount(), 0);
  const pdfjsPages = num(pdf.doc.numPages);
  const pagesToTest = Math.min(gigaPages, pdfjsPages, maxPages);

  const pages = [];
  for (let i = 0; i < pagesToTest; i++) {
    try {
      pages.push(await comparePage(giga.doc, pdf.doc, i, tol));
    } catch (e) {
      pages.push({ pageIndex: i, error: String(e).slice(0, 120) });
    }
  }

  const valid = pages.filter((p) => !p.error);
  const totLib = valid.reduce((s, p) => s + p.libRuns, 0);
  const totPdfjs = valid.reduce((s, p) => s + p.pdfjsItems, 0);
  const totMatched = valid.reduce((s, p) => s + p.matched, 0);
  const matchPct = totLib ? (totMatched / totLib) * 100 : 100;
  const rotateMismatches = valid
    .filter((p) => p.rotateMismatch)
    .map((p) => ({ page: p.pageIndex, lib: p.libRotate, pdfjs: p.pdfjsRotate }));

  // Detect pages whose lib text fingerprint is identical to an earlier page
  // (multi-page only) — a strong signal of a page-indexing extraction bug.
  const seen = new Map();
  const duplicatePages = [];
  for (const p of valid) {
    if (!p.libFingerprint) continue;
    if (seen.has(p.libFingerprint)) {
      duplicatePages.push({ page: p.pageIndex, sameAs: seen.get(p.libFingerprint) });
    } else {
      seen.set(p.libFingerprint, p.pageIndex);
    }
  }

  // Collect the globally-worst entries across pages: genuinely unmatched runs
  // first (these are the real misplacements), ordered by start distance.
  const allWorst = valid
    .flatMap((p) => p.worst.map((w) => ({ page: p.pageIndex, ...w })))
    .filter((w) => w.matched === false && Number.isFinite(w.dist))
    .sort((a, b) => b.dist - a.dist)
    .slice(0, 5);

  return {
    ok: true,
    gigaPages,
    pdfjsPages,
    pagesTested: pagesToTest,
    libRuns: totLib,
    pdfjsItems: totPdfjs,
    matched: totMatched,
    matchPct,
    segRatio: totPdfjs ? totLib / totPdfjs : null, // >1 => lib over-segments
    rotateMismatches,
    duplicatePages,
    perPage: valid.map((p) => ({
      page: p.pageIndex,
      libRuns: p.libRuns,
      pdfjsItems: p.pdfjsItems,
      matchPct: round(p.matchPct),
      libRotate: p.libRotate,
      pdfjsRotate: p.pdfjsRotate,
    })),
    worst: allWorst,
  };
}

function round(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : n;
}
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
