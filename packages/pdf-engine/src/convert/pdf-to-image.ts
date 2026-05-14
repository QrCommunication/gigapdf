import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ConvertPdfToImageOptions {
  format?: 'jpg' | 'png';
  /** Resolution in DPI (dots per inch). Default is 150. */
  dpi?: number;
  /** 1-based start page */
  startPage?: number;
  /** 1-based end page */
  endPage?: number;
  /** Timeout in milliseconds. Default 30_000 */
  timeoutMs?: number;
}

export class PopplerUnavailableError extends Error {
  constructor() {
    super('pdftocairo (poppler-utils) binary not found in PATH');
    this.name = 'PopplerUnavailableError';
  }
}

export class PopplerConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PopplerConversionError';
  }
}

/**
 * Convert a PDF into a series of images (one per page) using poppler-utils (pdftocairo).
 *
 * @param pdfBuffer The PDF data
 * @param options Conversion options (format, dpi, page range)
 * @returns Array of image bytes
 */
export async function convertPdfToImages(
  pdfBuffer: Uint8Array,
  options: ConvertPdfToImageOptions = {}
): Promise<Uint8Array[]> {
  const format = options.format || 'jpg';
  const dpi = options.dpi || 150;
  const timeoutMs = options.timeoutMs || 30_000;

  const dir = await mkdtemp(join(tmpdir(), 'gigapdf-poppler-'));
  const inPath = join(dir, 'input.pdf');
  const outPrefix = join(dir, 'output');

  try {
    await writeFile(inPath, pdfBuffer);

    const args: string[] = [];
    if (format === 'jpg') args.push('-jpeg');
    else if (format === 'png') args.push('-png');

    args.push('-r', dpi.toString());

    if (options.startPage !== undefined) {
      args.push('-f', options.startPage.toString());
    }
    if (options.endPage !== undefined) {
      args.push('-l', options.endPage.toString());
    }

    args.push(inPath, outPrefix);

    await runPdftocairo(args, timeoutMs);

    const entries = await readdir(dir);
    // Extensions output by pdftocairo are generally .jpg or .png
    const extension = format === 'jpg' ? '.jpg' : '.png';
    
    const outputFiles = entries
      .filter((e) => e.startsWith('output') && e.endsWith(extension))
      .sort((a, b) => {
        // extract the number from output-1.jpg, output-02.jpg etc
        const matchA = a.match(/\d+/);
        const matchB = b.match(/\d+/);
        const numA = matchA ? parseInt(matchA[0], 10) : 0;
        const numB = matchB ? parseInt(matchB[0], 10) : 0;
        return numA - numB;
      });

    if (outputFiles.length === 0) {
      throw new PopplerConversionError('pdftocairo produced no output files');
    }

    const buffers: Uint8Array[] = [];
    for (const file of outputFiles) {
      const buf = await readFile(join(dir, file));
      buffers.push(new Uint8Array(buf));
    }

    return buffers;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runPdftocairo(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('pdftocairo', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      reject(new PopplerUnavailableError());
      return;
    }

    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new PopplerUnavailableError());
      } else {
        reject(err);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (killed) {
        reject(new PopplerConversionError(`pdftocairo timed out after ${timeoutMs}ms`));
        return;
      }

      if (code !== 0) {
        // In some cases poppler writes to stderr, in others it just exits with 1
        reject(new PopplerConversionError(`pdftocairo exited with code ${code}${stderr ? ': ' + stderr : ''}`));
        return;
      }

      resolve();
    });
  });
}
