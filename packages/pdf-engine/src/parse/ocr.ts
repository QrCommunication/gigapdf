/**
 * OCR pipeline using the system `tesseract` binary.
 *
 * MuPDF has no OCR. Tesseract is the de-facto open-source OCR engine,
 * available as a system package (`apt install tesseract-ocr tesseract-
 * ocr-fra tesseract-ocr-eng`). It accepts an image (PNG/JPEG/TIFF) and
 * writes plain text or hOCR / TSV / ALTO XML.
 *
 * Strategy:
 *   1. Render each PDF page to a high-DPI bitmap via MuPDF (`renderPages`
 *      with scale=2 = ~144 DPI; tesseract recommends 300 DPI but 144 is
 *      a good tradeoff between quality and processing time).
 *   2. Pipe the bitmap into `tesseract stdin stdout -l fra+eng` per page.
 *   3. Aggregate per-page text and optional bounding boxes (TSV mode).
 *
 * The binary is invoked via execFile (no shell, no injection risk).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineLogger } from '../utils/logger';
import { renderPages } from '../render/mupdf-render';

const execFileAsync = promisify(execFile);

export class TesseractNotInstalledError extends Error {
  constructor() {
    super(
      'tesseract is not installed on this server. Run: ' +
        'apt-get install tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng',
    );
    this.name = 'TesseractNotInstalledError';
  }
}

export interface OcrOptions {
  /** Pages to OCR (1-based). Defaults to all pages. */
  pages?: number[];
  /** Tesseract language string (e.g. "fra+eng"). Defaults to "fra+eng". */
  lang?: string;
  /** Render DPI: 144 (fast) or 300 (high quality). Defaults to 144. */
  dpi?: 144 | 200 | 300;
  /** Output format: "text" (plain) or "hocr" (with bboxes). */
  format?: 'text' | 'hocr';
}

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  /** Only present when format === 'hocr'. Contains XHTML with embedded coords. */
  hocr?: string;
}

export interface OcrResult {
  pages: OcrPageResult[];
  /** Aggregated text for convenience (pages joined by double newline). */
  fullText: string;
}

/**
 * Check if `tesseract` is in PATH. Cached on first call.
 */
let tesseractAvailable: boolean | null = null;
export async function isTesseractAvailable(): Promise<boolean> {
  if (tesseractAvailable !== null) return tesseractAvailable;
  try {
    const { stdout } = await execFileAsync('tesseract', ['--version'], {
      timeout: 5000,
    });
    tesseractAvailable = stdout.toLowerCase().includes('tesseract');
  } catch {
    tesseractAvailable = false;
  }
  return tesseractAvailable;
}

export async function ocrPdf(
  pdfBytes: Uint8Array,
  options: OcrOptions = {},
): Promise<OcrResult> {
  if (!(await isTesseractAvailable())) {
    throw new TesseractNotInstalledError();
  }

  const {
    pages,
    lang = 'fra+eng',
    dpi = 144,
    format = 'text',
  } = options;

  // 144 DPI = scale 2; 200 = scale ~2.8; 300 = scale ~4.2 (relative to 72 DPI).
  const scale = dpi / 72;

  // 1. Rasterise pages via MuPDF (one batch, single document open).
  const rendered = await renderPages(pdfBytes, {
    pages,
    scale,
    format: 'png',
  });

  // 2. Per-page OCR via tesseract. Use a tmp dir so tesseract can write
  // its output sidecar files; we delete the dir at the end.
  const tmpDir = await mkdtemp(join(tmpdir(), 'gigapdf-ocr-'));
  const results: OcrPageResult[] = [];

  try {
    for (const page of rendered) {
      const imgPath = join(tmpDir, `page-${page.pageNumber}.png`);
      const outBase = join(tmpDir, `page-${page.pageNumber}`);
      await writeFile(imgPath, Buffer.from(page.bytes));

      const args = [imgPath, outBase, '-l', lang];
      if (format === 'hocr') args.push('hocr');

      try {
        await execFileAsync('tesseract', args, {
          timeout: 60_000,
          maxBuffer: 32 * 1024 * 1024,
        });
      } catch (err) {
        engineLogger.warn('ocr: tesseract failed on page', {
          pageNumber: page.pageNumber,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({ pageNumber: page.pageNumber, text: '' });
        continue;
      }

      // Tesseract writes <outBase>.txt or <outBase>.hocr depending on format.
      const ext = format === 'hocr' ? '.hocr' : '.txt';
      const outputPath = outBase + ext;

      const { readFile } = await import('node:fs/promises');
      let outputContent = '';
      try {
        outputContent = await readFile(outputPath, 'utf8');
      } catch (readErr) {
        engineLogger.warn('ocr: could not read tesseract output', {
          path: outputPath,
          error: readErr instanceof Error ? readErr.message : String(readErr),
        });
      }

      results.push(
        format === 'hocr'
          ? {
              pageNumber: page.pageNumber,
              text: stripHocrTags(outputContent),
              hocr: outputContent,
            }
          : { pageNumber: page.pageNumber, text: outputContent.trim() },
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    pages: results,
    fullText: results.map((r) => r.text).join('\n\n').trim(),
  };
}

function stripHocrTags(hocr: string): string {
  // Cheap text extraction from hOCR: drop tags, keep inner text.
  return hocr
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
