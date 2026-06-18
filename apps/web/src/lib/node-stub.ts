// Browser stub for Node-only builtins (`fs/promises`, `url`) that are pulled
// into the client bundle by an UNREACHABLE code path: `GigaPdfEngine.loadDefault()`
// in @qrcommunication/gigapdf-lib statically `import()`s them to read the bundled
// `gigapdf.wasm` from disk. The browser never calls `loadDefault()` — the canvas
// renderer uses `GigaPdfEngine.load(url)` (WebAssembly.instantiate + fetch), which
// is fully browser-compatible. Turbopack still tries to resolve the static import
// specifiers when bundling the lib for the browser, so we alias them here.
//
// Wired in next.config.ts via `turbopack.resolveAlias` with the `browser` condition
// only — the server keeps the real Node modules (the lib is `serverExternalPackages`,
// so `loadDefault()` works at runtime server-side).
export {};
