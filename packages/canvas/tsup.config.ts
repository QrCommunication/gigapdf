import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: false, // Disabled due to Fabric.js v6 type incompatibilities
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "fabric", "pdfjs-dist"],
  treeshake: true,
  splitting: false,
});
