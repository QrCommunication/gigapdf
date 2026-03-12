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
  ],
  noExternal: [
    'pdf-lib',      // Pure JS, safe to bundle
    'node-forge',   // Pure JS, safe to bundle
  ],
});
