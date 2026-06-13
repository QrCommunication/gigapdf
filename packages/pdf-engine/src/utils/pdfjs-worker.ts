import { createRequire } from 'node:module';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Ensure pdfjs `GlobalWorkerOptions.workerSrc` points to a resolvable file://
 * path before each getDocument().
 *
 * With `disableWorker: true` pdfjs still runs a fake (in-thread) worker that
 * requires a valid workerSrc — an empty string throws
 * "Setting up fake worker failed". `createRequire(process.cwd())` survives
 * Turbopack/webpack bundling (a literal `require.resolve()` gets statically
 * rewritten and breaks). Idempotent and safe to call before every getDocument().
 *
 * Shared by parse/parser.ts and preview/renderer.ts.
 */
export function ensureWorkerSrc(): void {
  const current = pdfjsLib.GlobalWorkerOptions.workerSrc;
  // Already set to an absolute file:// URL — nothing to do.
  if (typeof current === 'string' && current.startsWith('file://')) return;
  try {
    const requireFn = createRequire(`${process.cwd()}/package.json`);
    const absPath = requireFn.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${absPath}`;
  } catch {
    // If resolution fails, leave as-is — pdfjs fakeWorker fallback may work.
  }
}
