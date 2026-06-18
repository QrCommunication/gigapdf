/**
 * Searchable-PDF OCR pipeline — adds an INVISIBLE text layer on top of
 * scanned (image-only) pages so the PDF becomes selectable/searchable
 * without altering its visual appearance.
 *
 * Strategy (ocrmypdf-style, all open-source building blocks):
 *   1. Detect pages WITHOUT extractable text via the engine's structured text
 *      (`extractPlainText`). `force: true` processes every page.
 *   2. Rasterise those pages to PNG via the engine (`renderPages`, dpi/72 scale).
 *   3. Run the system OCR binary in TSV mode: one row per detected
 *      item, level 5 rows = words with pixel bounding boxes + confidence.
 *   4. Convert each word bbox from image pixels (top-left origin, y down)
 *      to PDF user space (bottom-left origin, y up), honouring /Rotate.
 *   5. Add each word via the WASM engine `addTextLayer` (text render mode 3 —
 *      invisible) in a SINGLE content append per page; glyphs stay part of the
 *      content stream so text extraction/search/selection finds them.
 *
 * The standard Helvetica font is WinAnsi-encoded: words containing glyphs
 * outside WinAnsi (CJK, Hebrew, math symbols…) are skipped by the engine —
 * acceptable because the glyphs are invisible anyway and the overwhelming
 * majority of fra+eng OCR output is WinAnsi-safe.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEngine } from '../wasm';
import { engineLogger } from '../utils/logger';
import { renderPages } from '../render/engine-render';
import { extractPlainText } from './structured-text';
import { isTesseractAvailable, TesseractNotInstalledError } from './ocr';

const execFileAsync = promisify(execFile);

/** Words below this OCR confidence (0-100) are dropped. */
export const DEFAULT_MIN_WORD_CONFIDENCE = 40;

export interface MakeSearchablePdfOptions {
  /** OCR language string (e.g. "fra+eng"). Defaults to "fra+eng". */
  languages?: string;
  /** Render DPI for the OCR rasterisation. Defaults to 144. */
  dpi?: 144 | 200 | 300;
  /**
   * OCR every page, even those that already contain extractable text.
   * Defaults to false (only image-only pages are processed).
   */
  force?: boolean;
}

export interface MakeSearchablePdfResult {
  bytes: Uint8Array;
  /** Number of pages that went through the OCR pipeline. */
  pagesProcessed: number;
  /** Number of invisible words written into the PDF. */
  wordsAdded: number;
}

/** One word row (level 5) from OCR TSV output. Pixel coordinates. */
export interface OcrTsvWord {
  /** Left edge in image pixels (top-left origin). */
  left: number;
  /** Top edge in image pixels (top-left origin, y down). */
  top: number;
  /** Width in image pixels. */
  width: number;
  /** Height in image pixels. */
  height: number;
  /** OCR confidence 0-100. */
  conf: number;
  /** Recognised word text (trimmed, non-empty). */
  text: string;
}

/**
 * Parse OCR TSV output into word boxes.
 *
 * TSV columns: level page_num block_num par_num line_num word_num
 *              left top width height conf text
 * Level 5 rows are words; every other level (page/block/para/line) carries
 * conf = -1 and no usable text. Pure function — unit-tested with inline
 * fixtures.
 */
export function parseTsvWords(
  tsv: string,
  minConfidence: number = DEFAULT_MIN_WORD_CONFIDENCE,
): OcrTsvWord[] {
  const words: OcrTsvWord[] = [];

  for (const rawLine of tsv.split(/\r?\n/)) {
    const cols = rawLine.split('\t');
    if (cols.length < 12) continue; // header, blank line, malformed row
    if (cols[0] !== '5') continue; // level 5 = word

    const left = Number(cols[6]);
    const top = Number(cols[7]);
    const width = Number(cols[8]);
    const height = Number(cols[9]);
    const conf = Number(cols[10]);
    // text is the last column; defensive join in case the recognised text
    // ever contains a tab (theoretically impossible for word level).
    const text = cols.slice(11).join('\t').trim();

    if (
      !Number.isFinite(left) ||
      !Number.isFinite(top) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      !Number.isFinite(conf)
    ) {
      continue;
    }
    if (conf < minConfidence) continue;
    if (width <= 0 || height <= 0) continue;
    if (text.length === 0) continue;

    words.push({ left, top, width, height, conf, text });
  }

  return words;
}

export interface PdfPlacementContext {
  /** Rendered image width in pixels. */
  imageWidth: number;
  /** Rendered image height in pixels. */
  imageHeight: number;
  /** Page width in PDF points (user space, UNrotated MediaBox). */
  pageWidth: number;
  /** Page height in PDF points (user space, UNrotated MediaBox). */
  pageHeight: number;
  /** Page /Rotate flag. The rendered image shows the page POST-rotation. */
  rotation: 0 | 90 | 180 | 270;
}

export interface PdfWordPlacement {
  /** Baseline start X in PDF user space. */
  x: number;
  /** Baseline start Y in PDF user space. */
  y: number;
  /** Font size in points (≈ 90% of the bbox height). */
  fontSize: number;
  /** Rotation to apply to the drawn text (counterclockwise degrees). */
  rotation: 0 | 90 | 180 | 270;
}

/**
 * Convert an OCR word bbox (image pixels, top-left origin, y down)
 * into a drawText placement (PDF user space, bottom-left origin,
 * y up), accounting for the page /Rotate flag.
 *
 * scale = displayedPageWidthPt / imageWidthPx, where the displayed width is
 * pageHeight for /Rotate 90|270 (the engine rasterises POST-rotation, so the
 * image axes follow the displayed page, not the user-space MediaBox).
 *
 * The baseline is anchored at the BOTTOM of the word bbox — close enough
 * for an invisible layer whose only job is search/selection geometry.
 * Pure function — unit-tested with inline fixtures.
 */
export function tsvWordToPdfPlacement(
  word: Pick<OcrTsvWord, 'left' | 'top' | 'width' | 'height'>,
  ctx: PdfPlacementContext,
): PdfWordPlacement {
  const displayedWidth =
    ctx.rotation === 90 || ctx.rotation === 270 ? ctx.pageHeight : ctx.pageWidth;
  const scale = displayedWidth / ctx.imageWidth;
  const fontSize = word.height * scale * 0.9;
  const bottomPx = word.top + word.height;

  switch (ctx.rotation) {
    case 90:
      // image (px, py) → user (py·s, px·s); baseline runs along +y.
      return { x: bottomPx * scale, y: word.left * scale, fontSize, rotation: 90 };
    case 180:
      // image (px, py) → user (W − px·s, py·s); baseline runs along −x.
      return {
        x: ctx.pageWidth - word.left * scale,
        y: bottomPx * scale,
        fontSize,
        rotation: 180,
      };
    case 270:
      // image (px, py) → user (W − py·s, H − px·s); baseline runs along −y.
      return {
        x: ctx.pageWidth - bottomPx * scale,
        y: ctx.pageHeight - word.left * scale,
        fontSize,
        rotation: 270,
      };
    default:
      // image (px, py) → user (px·s, H − py·s); Y flip bottom-up.
      return {
        x: word.left * scale,
        y: ctx.pageHeight - bottomPx * scale,
        fontSize,
        rotation: 0,
      };
  }
}

/** Normalise a rotation angle to 0|90|180|270. */
function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const wrapped = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return (wrapped === 90 || wrapped === 180 || wrapped === 270 ? wrapped : 0) as
    | 0
    | 90
    | 180
    | 270;
}

/**
 * Add an invisible (opacity 0) text layer to every image-only page of the
 * PDF, making it searchable and selectable. Pages that already contain
 * extractable text are left untouched unless `force: true`.
 *
 * Returns the original bytes untouched (pagesProcessed = 0) when no page
 * needs OCR — in that case OCR availability is NOT required.
 *
 * @throws TesseractNotInstalledError when pages need OCR but the system
 *         OCR binary is missing.
 */
export async function makeSearchablePdf(
  pdfBytes: Uint8Array,
  options: MakeSearchablePdfOptions = {},
): Promise<MakeSearchablePdfResult> {
  const { languages = 'fra+eng', dpi = 144, force = false } = options;

  // 1. Page selection — only pages without extractable text, unless forced.
  const pageTexts = await extractPlainText(pdfBytes);
  const targetPages = (
    force ? pageTexts : pageTexts.filter((p) => p.text.trim().length === 0)
  ).map((p) => p.pageNumber);

  if (targetPages.length === 0) {
    return { bytes: pdfBytes, pagesProcessed: 0, wordsAdded: 0 };
  }

  if (!(await isTesseractAvailable())) {
    throw new TesseractNotInstalledError();
  }

  // 2. Rasterise the target pages via the engine (single document open).
  const scale = dpi / 72;
  const rendered = await renderPages(pdfBytes, {
    pages: targetPages,
    scale,
    format: 'png',
  });

  // 3. OCR TSV per page, through a throwaway tmp dir.
  const tmpDir = await mkdtemp(join(tmpdir(), 'gigapdf-ocr-searchable-'));
  const wordsByPage = new Map<number, OcrTsvWord[]>();
  const imageDims = new Map<number, { width: number; height: number }>();

  try {
    for (const page of rendered) {
      imageDims.set(page.pageNumber, { width: page.width, height: page.height });
      const imgPath = join(tmpDir, `page-${page.pageNumber}.png`);
      const outBase = join(tmpDir, `page-${page.pageNumber}`);
      await writeFile(imgPath, Buffer.from(page.bytes));

      try {
        await execFileAsync('tesseract', [imgPath, outBase, '-l', languages, 'tsv'], {
          timeout: 120_000,
          maxBuffer: 32 * 1024 * 1024,
        });
        const tsv = await readFile(`${outBase}.tsv`, 'utf8');
        wordsByPage.set(page.pageNumber, parseTsvWords(tsv));
      } catch (err) {
        engineLogger.warn('ocr-searchable: tesseract failed on page', {
          pageNumber: page.pageNumber,
          error: err instanceof Error ? err.message : String(err),
        });
        wordsByPage.set(page.pageNumber, []);
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  // 4. Invisible text layer via the WASM engine (render mode 3 — glyphs live in
  //    the content stream for extraction/search but are never painted). One
  //    batched `addTextLayer` call per page (one font, O(n) not O(n²)).
  const giga = await getEngine();
  const doc = giga.open(pdfBytes);

  let pagesProcessed = 0;
  let wordsAdded = 0;

  try {
    for (const pageNumber of targetPages) {
      const dims = imageDims.get(pageNumber);
      if (!dims) continue; // page was filtered out by renderPages (out of range)
      pagesProcessed += 1;

      const words = wordsByPage.get(pageNumber) ?? [];
      if (words.length === 0) continue;

      const info = doc.pageInfo(pageNumber);
      const ctx: PdfPlacementContext = {
        imageWidth: dims.width,
        imageHeight: dims.height,
        pageWidth: info.width,
        pageHeight: info.height,
        rotation: normalizeRotation(info.rotation),
      };

      const runs: { x: number; y: number; size: number; text: string; rotation: number }[] = [];
      for (const word of words) {
        const placement = tsvWordToPdfPlacement(word, ctx);
        if (placement.fontSize < 1) continue;
        runs.push({
          x: placement.x,
          y: placement.y,
          size: placement.fontSize,
          text: word.text,
          rotation: placement.rotation,
        });
      }
      // The engine skips words with non-WinAnsi glyphs (standard Helvetica) and
      // returns the count actually written.
      if (runs.length > 0) {
        wordsAdded += doc.addTextLayer(pageNumber, runs);
      }
    }

    const bytes = doc.saveCompressed();

    engineLogger.info('ocr-searchable: invisible text layer added', {
      pagesProcessed,
      wordsAdded,
      languages,
      dpi,
      inputBytes: pdfBytes.byteLength,
      outputBytes: bytes.byteLength,
    });

    return { bytes, pagesProcessed, wordsAdded };
  } finally {
    doc.close();
  }
}
