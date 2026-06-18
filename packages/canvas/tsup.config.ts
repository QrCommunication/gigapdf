import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: false, // Disabled due to Fabric.js v6 type incompatibilities
  sourcemap: true,
  clean: true,
  // The consuming app provides these once (no duplicate copies in the page
  // bundle). `@qrcommunication/gigapdf-lib` is dynamically imported at render
  // time and resolved by the app, which also serves its `gigapdf.wasm`.
  external: ["react", "react-dom", "fabric", "@qrcommunication/gigapdf-lib"],
  treeshake: true,
  splitting: false,
});
