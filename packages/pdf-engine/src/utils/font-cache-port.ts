/**
 * Port for an external font cache (typically backed by the apps/web
 * Prisma database, but the engine package stays free of any DB import).
 *
 * The text renderer asks for a converted TTF by SHA-256 of the SOURCE
 * font program (the Type1 or CFF bytes extracted from the PDF). On a
 * miss the renderer runs fontforge, then writes the TTF back through
 * `set()` so the next bake reuses it without spawning a subprocess.
 *
 * Implementations should be safe to call concurrently and idempotent
 * (concurrent `set()` calls with the same hash overwrite with the same
 * bytes).
 */

export type FontCacheSource =
  | 'converted-type1'
  | 'converted-cff'
  | 'embedded-truetype'
  | 'bundled-ofl';

export interface FontCacheMeta {
  /** PostScript family name extracted from the source ("OCRB10PitchBT"). */
  family: string | null;
  /** Optional weight/style hint for diagnostics. */
  postscriptName: string | null;
  /** Source format the bytes were converted from. */
  source: FontCacheSource;
}

export interface FontCachePort {
  /**
   * Look up a cached TTF by its source SHA-256.
   * Returns the TTF bytes, or null if not yet cached.
   */
  get(sha256: string): Promise<Uint8Array | null>;

  /**
   * Persist the TTF bytes for `sha256`. Idempotent.
   */
  set(
    sha256: string,
    ttfBytes: Uint8Array,
    meta: FontCacheMeta,
  ): Promise<void>;
}

import type { PDFDocumentHandle } from '../engine/document-handle';

const handleCache = new WeakMap<PDFDocumentHandle, FontCachePort>();

/**
 * Attach a cache port to an open PDF handle. The text renderer will pick
 * it up automatically. Pass `null` to clear.
 */
export function setFontCacheForHandle(
  handle: PDFDocumentHandle,
  port: FontCachePort | null,
): void {
  if (port === null) {
    handleCache.delete(handle);
  } else {
    handleCache.set(handle, port);
  }
}

export function getFontCacheForHandle(
  handle: PDFDocumentHandle,
): FontCachePort | undefined {
  return handleCache.get(handle);
}
