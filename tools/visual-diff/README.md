# visual-diff — GigaPDF rendering-fidelity harness

Objective, reproducible measurement of how faithfully the in-house PDF engine
(`@qrcommunication/gigapdf-lib`) renders/extracts vs the reference renderer
(`pdfjs-dist` 5.7.x). Pure tooling — **APP repo only**, reads sample PDFs as
input, writes nothing outside `tools/visual-diff/out/`.

## What it measures

### 1. geometry-diff (primary, canvas-free, fast)
Per page, the fraction of **text runs** reported by the home engine
(`doc.textElements`) that have a pdfjs text item (`getTextContent`) at the
**same position** (start point within `tol` points on both axes, Chebyshev
distance).

- Measures **position**, not count. pdfjs and the home engine segment lines
  differently (ligatures `fi`, kerned `TJ` fragments, shaping). A count
  mismatch is reported as a **seg-ratio** (`libRuns / pdfjsItems`) and flagged
  **benign** when positions still match — it is *not* counted as an error.
- Both engines are compared in **unrotated page space**: the pdfjs viewport is
  built with `rotation: 0` so its text coordinates match the home engine, which
  emits `textElements` in unrotated space with the `/Rotate` flag carried
  separately in `pageInfo`. (Without this, rotated pages produce false
  mismatches.)
- The `/Rotate` flag itself is cross-checked (`pageInfo.rotation` vs pdfjs
  `page.rotate`) and reported independently.

Y convention (single source of truth, `lib-adapters.mjs`):
`webYtop = pageHeight − run.y − run.height` for the home engine;
`yTop = m[5] − fontSize` for pdfjs (`m = Util.transform(viewport.transform, item.transform)`).

### 2. pixel-diff (bonus, canvas-backed)
`doc.renderPage(p, scale)` (PNG) vs pdfjs rendered to `@napi-rs/canvas` → PNG.
Both PNGs are decoded with `pngjs`, composited onto white (to neutralise alpha
differences), and compared per pixel on the common area. Reports `% pixels
differing`. `pixelmatch` is **not** installed, so a small explicit per-channel
comparator (threshold 32/255) is used instead — no new dependency added.

> Pixel-diff is **enabled** here because `@napi-rs/canvas`, `canvas`, `pngjs`
> and `pdfjs-dist` are all already in `node_modules`. If no canvas backend were
> present the harness would fall back to geometry-only and still write the
> home-engine PNGs for manual inspection.

## Usage

```bash
# default curated sample (~15 PDFs), geometry + pixel
node tools/visual-diff/run.mjs

# geometry only (fastest)
node tools/visual-diff/run.mjs --no-pixel

# tune
node tools/visual-diff/run.mjs --tol=8 --max-pages=3

# explicit files
node tools/visual-diff/run.mjs /path/a.pdf /path/b.pdf
```

Output: a **geometry** table and a **pixel** table, each sorted **worst → best**,
followed by a per-PDF **diagnosis** list. Raw data is written to
`out/results.json`; the home-engine page-0 PNG of each PDF is written to
`out/<name>.lib.p0.png` for manual inspection.

## Files

| File | Role |
|------|------|
| `lib-adapters.mjs` | Loaders (lib / pdfjs / canvas / pngjs), doc opening, coordinate helpers, warning suppression |
| `geometry-diff.mjs` | Per-page position matching → `geometryDiffPdf(path, {tol, maxPages})` |
| `pixel-diff.mjs` | Render-and-compare → `pixelDiffPdf(path, {scale, maxPages, outDir})` |
| `run.mjs` | Orchestrator: curated sample, tables, diagnostics, JSON dump |
| `out/` | Generated PNGs + `results.json` (gitignored-friendly, safe to delete) |

## Interpreting the numbers

| Signal | Meaning |
|--------|---------|
| geometry `match%` ≈ 100 | Text runs land where pdfjs puts them — good positioning |
| geometry `match%` low + constant `(dx,dy)` offset | Systematic coordinate bug |
| geometry `match%` low + scattered | Per-run misplacement |
| `libRuns 0` while `pdfjs > 0` | Text-decode failure (font/encoding) or scanned page |
| `match%` high but `seg×` ≫ 1 or ≪ 1 | Benign line fragmentation, positions fine |
| pixel `diff%` high while geometry good | Rendering divergence (glyphs/images), not positioning |
| `/Rotate flag mismatch` | `pageInfo.rotation` disagrees with the PDF's page rotation |
