// pixel-diff: render the same page with both engines and measure the
// fraction of differing pixels.
//
//   home engine : doc.renderPage(page, scale) -> PNG (Uint8Array)
//   reference   : pdfjs -> @napi-rs/canvas -> PNG
//
// Both PNGs are decoded to raw RGBA via pngjs. To stay robust against
// off-by-one dimensions (rounding of viewport sizes) we compare on the
// common (min) width/height and normalise the differing-pixel count by that
// common area. `pixelmatch` is not installed, so we use a small, explicit
// per-pixel comparator with an alpha-aware tolerance.

import {
  openWithGiga,
  openWithPdfjs,
  getPdfjs,
  getCanvasFactory,
  getPng,
  num,
} from "./lib-adapters.mjs";

/** Decode a PNG buffer to { width, height, data: RGBA Uint8Array }. */
async function decodePng(buf) {
  const PNG = await getPng();
  const png = PNG.sync.read(Buffer.from(buf));
  return { width: png.width, height: png.height, data: png.data };
}

/** Render one pdfjs page to a PNG buffer at the given scale. */
async function renderPdfjsPng(pdfjsDoc, pageIndex, scale) {
  const pdfjs = await getPdfjs();
  const { createCanvas, encodePng } = await getCanvasFactory();
  const page = await pdfjsDoc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  // White background: pdfjs renders transparent where the page is unpainted,
  // while the home engine emits an opaque white page. Flatten for a fair diff.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return encodePng(canvas);
}

/**
 * Compare two decoded RGBA images on their common area.
 * A pixel differs when any channel delta exceeds `threshold` (after
 * compositing onto white to neutralise alpha differences).
 */
function diffImages(a, b, threshold = 32) {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  let diff = 0;
  for (let y = 0; y < h; y++) {
    const aRow = y * a.width * 4;
    const bRow = y * b.width * 4;
    for (let x = 0; x < w; x++) {
      const ai = aRow + x * 4;
      const bi = bRow + x * 4;
      const [ar, ag, ab] = onWhite(a.data, ai);
      const [br, bg, bb] = onWhite(b.data, bi);
      if (
        Math.abs(ar - br) > threshold ||
        Math.abs(ag - bg) > threshold ||
        Math.abs(ab - bb) > threshold
      ) {
        diff++;
      }
    }
  }
  const area = w * h;
  return {
    diffPixels: diff,
    comparedArea: area,
    diffPct: area ? (diff / area) * 100 : 0,
    commonW: w,
    commonH: h,
    dimsMatch: a.width === b.width && a.height === b.height,
  };
}

/** Composite an RGBA sample onto a white background -> [r,g,b]. */
function onWhite(data, i) {
  const alpha = data[i + 3] / 255;
  const blend = (c) => Math.round(c * alpha + 255 * (1 - alpha));
  return [blend(data[i]), blend(data[i + 1]), blend(data[i + 2])];
}

/**
 * Pixel-diff a whole PDF (capped pages).
 * @param outDir optional dir to write the home-engine PNG of page 0 for
 *               manual inspection.
 * @returns structured result (never throws).
 */
export async function pixelDiffPdf(
  absPath,
  { scale = 1.5, maxPages = 3, outDir = null, writeFirstPng = false } = {}
) {
  const giga = await openWithGiga(absPath);
  if (!giga.ok) return { ok: false, stage: "giga-open", error: giga.error };
  const pdf = await openWithPdfjs(absPath);
  if (!pdf.ok) return { ok: false, stage: "pdfjs-open", error: pdf.error };

  const gigaPages = safe(() => giga.doc.pageCount(), 0);
  const pages = Math.min(gigaPages, num(pdf.doc.numPages), maxPages);

  const perPage = [];
  for (let i = 0; i < pages; i++) {
    try {
      // Lib page API is 1-based (matches pdfjs getPage(i + 1) below).
      const libPngBuf = giga.doc.renderPage(i + 1, scale);
      if (writeFirstPng && i === 0 && outDir) {
        const fs = await import("node:fs");
        const path = await import("node:path");
        fs.writeFileSync(
          path.join(outDir, `${basenameNoExt(absPath)}.lib.p0.png`),
          Buffer.from(libPngBuf)
        );
      }
      const libImg = await decodePng(libPngBuf);
      const refPngBuf = await renderPdfjsPng(pdf.doc, i, scale);
      const refImg = await decodePng(refPngBuf);
      perPage.push({ page: i, ...diffImages(libImg, refImg) });
    } catch (e) {
      perPage.push({ page: i, error: String(e).slice(0, 140) });
    }
  }

  const valid = perPage.filter((p) => !p.error);
  const totDiff = valid.reduce((s, p) => s + p.diffPixels, 0);
  const totArea = valid.reduce((s, p) => s + p.comparedArea, 0);

  return {
    ok: true,
    pagesTested: pages,
    diffPct: totArea ? (totDiff / totArea) * 100 : 0,
    perPage,
  };
}

function basenameNoExt(p) {
  const b = p.split("/").pop() || p;
  return b.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_.-]/g, "_");
}
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
