import { defineConfig } from "tsup";

export default defineConfig([
  // ── Primary library bundle ────────────────────────────────────────────────
  // pdfjs-dist stays external so the consuming app provides it once (no
  // duplicate copies in the page bundle).
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: false, // Disabled due to Fabric.js v6 type incompatibilities
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom", "fabric", "pdfjs-dist"],
    treeshake: true,
    splitting: false,
  },

  // ── PDF render worker bundle ──────────────────────────────────────────────
  //
  // PERF-01: The worker runs in an isolated DedicatedWorkerGlobalScope and
  // cannot share modules with the page. pdfjs-dist MUST be bundled inside
  // the worker output — it cannot be an external for this entry.
  //
  // `new Worker(new URL('./pdf-render-worker.ts', import.meta.url), { type: 'module' })`
  // in pdf-renderer.ts is understood by Vite (consuming app) which will
  // further process this URL to point to the hashed worker asset. The tsup
  // build here just produces `dist/pdf-render-worker.mjs` as the source file
  // that Vite picks up when bundling the package.
  {
    entry: { "pdf-render-worker": "src/renderers/pdf-render-worker.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: false, // main build already cleaned dist/
    // pdfjs-dist must be bundled in the worker — NOT external
    noExternal: ["pdfjs-dist"],
    external: [], // no externals for the worker
    treeshake: true,
    splitting: false,
    // Output to the same dist/ directory so the relative URL in pdf-renderer.ts
    // resolves correctly: './pdf-render-worker.ts' → dist/pdf-render-worker.mjs
    outDir: "dist",
  },
]);
