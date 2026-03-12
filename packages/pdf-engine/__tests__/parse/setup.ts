/**
 * Shared pdfjs-dist re-export for parse tests.
 * workerSrc is configured globally by vitest-setup.ts (uses file:// URL).
 * This module simply re-exports pdfjsLib for test convenience.
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export { pdfjsLib };
