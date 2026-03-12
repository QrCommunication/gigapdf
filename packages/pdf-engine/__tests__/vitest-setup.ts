/**
 * Vitest global setup — configures pdfjs-dist for Node.js test environment.
 *
 * pdfjs-dist v4 requires workerSrc to be a loadable URL (not a bare file path).
 * We convert the absolute path to a file:// URL so pdfjs can load the worker.
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const _require = createRequire(import.meta.url);
const pdfjsDistDir = resolve(_require.resolve('pdfjs-dist/package.json'), '..');
const workerPath = resolve(pdfjsDistDir, 'legacy/build/pdf.worker.mjs');

pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
