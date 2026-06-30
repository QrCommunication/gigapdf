/**
 * Host-side OCR client — talks to the native OCR microservice over HTTP.
 *
 * Recognition moved host-side: the client-side WASM recognizer that used to ship
 * in `@qrcommunication/gigapdf-lib` (`GigaPdfDoc.ocr`/`ocrText`, the bundled
 * `.gpocr` models, the `OcrScript`/`OcrWord` types) was REMOVED from the
 * package. OCR now runs in a persistent native microservice; this module POSTs a
 * page PNG and parses its NDJSON line stream.
 *
 * Only RECOGNITION lives here. PDF rasterisation, text-layer baking, masking and
 * save stay in TypeScript via the main engine (`./wasm` → `renderPage`,
 * `addTextLayer`, `decodePng`, `addRectangle`, `saveCompressed`).
 *
 * Service contract:
 *   GET  {base}/health → { ok, recCount, languages }
 *   POST {base}/ocr    body = page PNG (image/png), optional header
 *                      `X-Ocr-Model: <name>` to FORCE a recognizer (omit for
 *                      per-line auto selection). Response: NDJSON, one line per
 *                      recognized text line, in IMAGE PIXEL space (top-left
 *                      origin): { text, x, y, w, h, confidence, model }.
 */

import { engineLogger } from './utils/logger';

/** Default base URL of the local OCR microservice (server-only). */
const DEFAULT_OCR_SERVICE_URL = 'http://127.0.0.1:8077';

/** How long an `isOcrAvailable()` health probe stays cached. */
const HEALTH_CACHE_TTL_MS = 30_000;

/**
 * The recognizer/model names the OCR service exposes (its `X-Ocr-Model`
 * vocabulary, also surfaced via `/health.languages`). Kept LOCAL so importers
 * keep a stable symbol now that the engine no longer ships `ALL_OCR_SCRIPTS`.
 */
export const OCR_LANGUAGES = [
  'latin',
  'cyrillic',
  'ar',
  'he',
  'zh',
  'zh_tw',
  'ja',
  'ko',
  'devanagari',
  'ta',
  'te',
  'kn',
  'en',
  'latin_hw',
] as const;

/** A recognizer/model name understood by the OCR service. */
export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

/**
 * One recognized OCR line in IMAGE PIXEL space (top-left origin, y down).
 *
 * The `{ text, x, y, w, h }` fields are intentionally identical in shape to the
 * legacy engine word, so every pixel→PDF geometry helper
 * (`ocrWordToPdfPlacement`, `ocrWordToPdfBox`, `pdfBoxToImageRect`) is reused
 * verbatim.
 */
export interface NativeOcrWord {
  /** Recognized text for the line. */
  text: string;
  /** Left edge of the bbox in image pixels (top-left origin). */
  x: number;
  /** Top edge of the bbox in image pixels (top-left origin, y down). */
  y: number;
  /** Width of the bbox in image pixels. */
  w: number;
  /** Height of the bbox in image pixels. */
  h: number;
  /** Recognizer confidence in [0, 1]. */
  confidence: number;
  /** Name of the recognizer that won this line. */
  model: string;
}

/** Shape of the `/health` payload (subset we rely on). */
interface OcrHealth {
  ok: boolean;
  recCount: number;
  languages: string[];
}

/** Read the OCR service base URL from the (server-only) environment. */
export function getOcrServiceUrl(): string {
  const raw = typeof process !== 'undefined' ? process.env['OCR_SERVICE_URL'] : undefined;
  const trimmed = (raw ?? '').trim();
  const base = trimmed.length > 0 ? trimmed : DEFAULT_OCR_SERVICE_URL;
  // Drop any trailing slashes so `${base}/ocr` is always well-formed.
  return base.replace(/\/+$/, '');
}

/**
 * Recognize the text lines on a page PNG via the OCR microservice.
 *
 * POSTs the raw PNG (`image/png`) to `{OCR_SERVICE_URL}/ocr`. When `opts.model`
 * is given it sets `X-Ocr-Model` to FORCE that recognizer; omit it to let the
 * service auto-select per line. The NDJSON response (one JSON object per line)
 * is parsed into {@link NativeOcrWord}s — image pixel coordinates, top-left
 * origin. Malformed NDJSON lines are skipped (the rest still parse).
 */
export async function getOcrWords(
  png: Uint8Array | Buffer,
  opts: { model?: string } = {},
): Promise<NativeOcrWord[]> {
  const url = `${getOcrServiceUrl()}/ocr`;
  const headers: Record<string, string> = { 'Content-Type': 'image/png' };
  if (opts.model) headers['X-Ocr-Model'] = opts.model;

  const response = await fetch(url, { method: 'POST', headers, body: png });
  if (!response.ok) {
    throw new Error(`OCR service /ocr responded ${response.status} ${response.statusText}`);
  }
  return parseNdjson(await response.text());
}

/** Parse an NDJSON OCR response into typed words, skipping malformed lines. */
function parseNdjson(ndjson: string): NativeOcrWord[] {
  const words: NativeOcrWord[] = [];
  for (const rawLine of ndjson.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // tolerate a partial/garbled line — keep the rest
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj['text'] !== 'string') continue;
    words.push({
      text: obj['text'],
      x: toFiniteNumber(obj['x']),
      y: toFiniteNumber(obj['y']),
      w: toFiniteNumber(obj['w']),
      h: toFiniteNumber(obj['h']),
      confidence: typeof obj['confidence'] === 'number' ? obj['confidence'] : 0,
      model: typeof obj['model'] === 'string' ? obj['model'] : '',
    });
  }
  return words;
}

/** Coerce an unknown to a finite number, defaulting to 0. */
function toFiniteNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Short-lived cache of the last health probe (the recognizer set is stable for
// the lifetime of the service process, so a few seconds of caching is safe and
// keeps the editor's "is OCR available?" check cheap).
let healthCache: { ok: boolean; at: number } | null = null;

/** GET `/health`, returning the parsed payload or `null` on any failure. */
async function fetchHealth(): Promise<OcrHealth | null> {
  try {
    const response = await fetch(`${getOcrServiceUrl()}/health`, { method: 'GET' });
    if (!response.ok) return null;
    const json = (await response.json()) as Record<string, unknown>;
    return {
      ok: json['ok'] === true,
      recCount: typeof json['recCount'] === 'number' ? json['recCount'] : 0,
      languages: Array.isArray(json['languages'])
        ? json['languages'].filter((l): l is string => typeof l === 'string')
        : [],
    };
  } catch (err) {
    engineLogger.warn('ocr-engine: /health probe failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Whether the OCR service is reachable AND has at least one recognizer loaded.
 * Result is cached briefly. Never throws — returns `false` on any error.
 */
export async function isOcrAvailable(): Promise<boolean> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_CACHE_TTL_MS) {
    return healthCache.ok;
  }
  const health = await fetchHealth();
  const ok = health !== null && health.ok && health.recCount > 0;
  healthCache = { ok, at: now };
  return ok;
}

/**
 * List the recognizer/language names the service currently advertises (from
 * `/health.languages`). Never throws — returns `[]` when the service is down.
 */
export async function listOcrLanguages(): Promise<string[]> {
  const health = await fetchHealth();
  return health?.languages ?? [];
}

/**
 * Legacy script token (frontend / tools-page) → OCR-service model name. Service
 * model names are accepted verbatim too (idempotent passthrough).
 */
const LEGACY_TOKEN_TO_MODEL: Record<string, string> = {
  // Latin family.
  alpha: 'latin',
  latin: 'latin',
  cyrillic: 'cyrillic',
  // Arabic / Hebrew.
  arabic: 'ar',
  ar: 'ar',
  hebrew: 'he',
  he: 'he',
  // Indic.
  devanagari: 'devanagari',
  tamil: 'ta',
  ta: 'ta',
  telugu: 'te',
  te: 'te',
  kannada: 'kn',
  kn: 'kn',
  // CJK.
  cjk: 'zh',
  chinese: 'zh',
  chinese_simplified: 'zh',
  zh: 'zh',
  chinese_traditional: 'zh_tw',
  zh_tw: 'zh_tw',
  japanese: 'ja',
  ja: 'ja',
  korean: 'ko',
  ko: 'ko',
  // Latin handwriting — normally driven by the `handwriting` flag, but accept
  // the token defensively.
  latin_hw: 'latin_hw',
  handwriting: 'latin_hw',
};

/**
 * Translate the legacy frontend script tokens (and the tools-page `lang` like
 * `"fra+eng"`) into a single OCR-service model name to FORCE via `X-Ocr-Model`.
 *
 * The model is forced rather than relying on full auto-selection, which can
 * misfire on synthetic/low-content Latin pages. Rules:
 *   - Map each token to a service model (unknown → `latin`).
 *   - If any non-Latin script is requested, the FIRST one wins (handwriting is
 *     Latin-only and is ignored in that case).
 *   - Otherwise, with `handwriting` set, force the Latin handwriting recognizer.
 *   - Otherwise, an explicit Latin/alpha request forces `latin`.
 *   - With no tokens at all, return `undefined` so the caller omits the header
 *     and the service auto-selects per line.
 *
 * Pure — unit-testable with inline tokens.
 */
export function scriptTokensToOcrModel(
  languages?: readonly string[],
  handwriting = false,
): string | undefined {
  const models = (languages ?? []).map(
    (token) => LEGACY_TOKEN_TO_MODEL[token.trim().toLowerCase()] ?? 'latin',
  );
  const nonLatin = models.find((m) => m !== 'latin');
  if (nonLatin) return nonLatin;
  if (handwriting) return 'latin_hw';
  if (models.length > 0) return 'latin';
  return undefined;
}
