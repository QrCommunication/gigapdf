/**
 * Convert a font program extracted from a PDF (Type1 binary, raw CFF, or
 * any format fontkit cannot ingest natively) into a TrueType file that
 * pdf-lib's fontkit-backed `embedFont()` accepts.
 *
 * Backed by `fontforge` in script mode. fontforge ships in every Debian
 * / Ubuntu repo, handles Type1 (PFB / PFA / binary), CFF, OTF, TTF, and
 * even Type3 (lossy). Spawning the subprocess costs ~50-150 ms per
 * conversion, so the result MUST be cached (`FontCachePort`).
 *
 * The function is intentionally synchronous-looking from the caller side:
 * either it returns valid TTF bytes, or it throws. No silent fallback —
 * the caller decides what to do on failure (typically: fall through to
 * the bundled OFL font).
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FONTFORGE_TIMEOUT_MS = 10_000;

export class FontForgeUnavailableError extends Error {
  constructor() {
    super('fontforge binary not found in PATH');
    this.name = 'FontForgeUnavailableError';
  }
}

export class FontForgeConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontForgeConversionError';
  }
}

/**
 * Convert font bytes to TTF. Throws on any failure.
 *
 * @param sourceBytes — raw bytes of the source font (Type1 PFB, raw CFF, ...)
 * @param sourceFormat — used only as a hint to pick a sensible temp file
 *                       extension; fontforge auto-detects regardless.
 */
export async function convertFontToTtf(
  sourceBytes: Uint8Array,
  sourceFormat: 'type1' | 'cff' | 'unknown',
): Promise<Uint8Array> {
  const ext = sourceFormat === 'type1' ? '.pfb' : sourceFormat === 'cff' ? '.cff' : '.bin';
  const dir = await mkdtemp(join(tmpdir(), 'gigapdf-ff-'));
  const inPath = join(dir, `font${ext}`);
  const outPath = join(dir, 'font.ttf');

  try {
    await writeFile(inPath, sourceBytes);

    // -lang=ff: use FontForge's native script language (faster than Python
    // bridge, no PythonUI init noise on stderr).
    // The 4-step script is: open the source, generate a TTF, exit cleanly.
    const script = `Open($1); Generate($2); Quit(0);`;
    await runFontForge(['-lang=ff', '-c', script, inPath, outPath]);

    const out = await readFile(outPath);
    if (out.length < 100) {
      throw new FontForgeConversionError(
        `fontforge produced a suspiciously small TTF (${out.length} bytes)`,
      );
    }
    // sanity: TTF magic = 0x00010000 OR "OTTO" (CFF-flavoured) OR "true"
    const magic = out.subarray(0, 4);
    const isTtfMagic =
      (magic[0] === 0x00 && magic[1] === 0x01 && magic[2] === 0x00 && magic[3] === 0x00) ||
      (magic[0] === 0x4f && magic[1] === 0x54 && magic[2] === 0x54 && magic[3] === 0x4f) ||
      (magic[0] === 0x74 && magic[1] === 0x72 && magic[2] === 0x75 && magic[3] === 0x65);
    if (!isTtfMagic) {
      throw new FontForgeConversionError(
        `fontforge output does not start with a valid TTF/OTF magic (got 0x${Buffer.from(magic).toString('hex')})`,
      );
    }
    return new Uint8Array(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runFontForge(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('fontforge', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      // spawn() throws synchronously only on rare conditions; ENOENT
      // surfaces via the 'error' event below, not here.
      reject(new FontForgeUnavailableError());
      return;
    }

    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, FONTFORGE_TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timer);
      // ENOENT here means the binary is missing — surface the dedicated error
      // so the caller can decide to fall back to bundled fonts.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new FontForgeUnavailableError());
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
        reject(
          new FontForgeConversionError(
            `fontforge timed out after ${FONTFORGE_TIMEOUT_MS}ms`,
          ),
        );
        return;
      }
      if (code !== 0) {
        const tail = stderr.split('\n').filter(Boolean).slice(-3).join(' | ');
        reject(
          new FontForgeConversionError(
            `fontforge exited with code ${code}${tail ? `: ${tail}` : ''}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}
