import { GigaPdfEngine } from "@qrcommunication/gigapdf-lib";

/**
 * The zero-dependency Rust→WASM PDF engine (`@qrcommunication/gigapdf-lib`),
 * instantiated once and shared across the whole pdf-engine package. The `.wasm`
 * is fully self-contained — no third-party PDF/Office libraries.
 */
let enginePromise: Promise<GigaPdfEngine> | null = null;

/** The shared WASM engine, instantiated lazily on first use and cached. */
export function getEngine(): Promise<GigaPdfEngine> {
  enginePromise ??= GigaPdfEngine.loadDefault();
  return enginePromise;
}
