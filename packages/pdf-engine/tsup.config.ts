import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/engine/index.ts',
    'src/parse/index.ts',
    'src/render/index.ts',
    'src/merge-split/index.ts',
    'src/forms/index.ts',
    'src/encrypt/index.ts',
    'src/preview/index.ts',
    'src/convert/index.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  external: [
    'canvas',       // Native addon, must not be bundled
    'sharp',        // Native addon, must not be bundled
    'playwright',   // Binary, must not be bundled
    // node-forge is CJS with top-level `require('crypto')` calls. Inlining
    // it into the ESM build turns those into esbuild `__require()` shims
    // that throw under Node ESM and under Turbopack ("dynamic usage of
    // require is not supported"). Kept external: Node and Next both handle
    // the plain CJS package from node_modules natively.
    'node-forge',
    // @signpdf (CJS) requires pdf-lib and node-forge at runtime. They must
    // resolve to the SAME module instances as the engine's own imports —
    // pdf-lib objects cross the boundary (PDFArray.withContext on our
    // PDFDocument context) and cross-instance `instanceof PDFObject`
    // checks corrupt the signature dict. With pdf-lib external below,
    // every consumer resolves the single node_modules copy.
    '@signpdf/signpdf',
    '@signpdf/signer-p12',
    '@signpdf/placeholder-pdf-lib',
    '@signpdf/utils',
    // pdf-lib must NOT be inlined: the engine's bundled copy would coexist
    // with the copy @signpdf requires from node_modules (dual instance).
    // pdf-lib@1.17 has no `exports` field and `main: cjs/index.js`, so
    // Node resolves one shared CJS copy for both import styles.
    'pdf-lib',
  ],
});
