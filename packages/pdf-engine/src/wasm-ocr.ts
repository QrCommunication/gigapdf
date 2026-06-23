import { GigaPdfEngine } from 'gigapdf-lib-ocr';

/**
 * OCR-capable WASM engine, pinned to `@qrcommunication/gigapdf-lib@0.63.0` via
 * the `gigapdf-lib-ocr` alias.
 *
 * Why a SEPARATE accessor from `./wasm`: the client-side OCR surface
 * (`GigaPdfEngine.loadOcrModel` / `loadBundledOcrModels` /
 * `loadAllBundledOcrModels` and `GigaPdfDoc.ocr` / `ocrText`, plus the bundled
 * `.gpocr` models) was REMOVED from the npm package in 0.64.0 — OCR moved
 * host-side (RTen) and is no longer shipped in the bundle. 0.63.0 is the last
 * release that exposes it. The rest of the engine (`./wasm`) tracks the latest
 * release; only the OCR pipelines resolve their engine/doc — and the OCR types
 * (`OcrScript`, `OcrWord`) — from this 0.63.0 alias, keeping OCR working without
 * pinning the whole engine to an old version.
 *
 * The `.wasm` is fully self-contained — no third-party PDF/Office libraries.
 */
let ocrEnginePromise: Promise<GigaPdfEngine> | null = null;

/** The shared OCR-capable WASM engine, instantiated lazily on first use and cached. */
export function getOcrEngine(): Promise<GigaPdfEngine> {
  ocrEnginePromise ??= GigaPdfEngine.loadDefault();
  return ocrEnginePromise;
}
