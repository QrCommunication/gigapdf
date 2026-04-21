/**
 * Feature flags for GigaPDF web application.
 *
 * All flags are read from environment variables at runtime.
 * Client-side flags MUST use the NEXT_PUBLIC_ prefix.
 * Server-side flags must NOT use NEXT_PUBLIC_.
 *
 * Usage:
 *   import { FONT_DYNAMIC_LOAD_ENABLED } from '@/lib/feature-flags';
 *   if (FONT_DYNAMIC_LOAD_ENABLED) { ... }
 */

/**
 * Enable on-the-fly loading of PDF embedded fonts via the FontFace API.
 *
 * When true:
 *  - useEmbeddedFonts fetches font metadata and registers FontFace instances
 *  - Fonts are cached in IndexedDB (7-day TTL, 50 MB cap)
 *  - The editor canvas uses embedded font names instead of Helvetica fallback
 *
 * When false (default):
 *  - useEmbeddedFonts returns empty immediately (no network calls)
 *  - Editor falls back to standard PDF fonts (existing behavior)
 *
 * Set via: NEXT_PUBLIC_FONT_DYNAMIC_LOAD=true in .env.local
 */
export const FONT_DYNAMIC_LOAD_ENABLED =
  process.env.NEXT_PUBLIC_FONT_DYNAMIC_LOAD === 'true';

/**
 * Enable extraction of embedded fonts when opening a PDF.
 *
 * Server-side flag — not exposed to the client bundle.
 * When false, the /api/pdf/fonts/* endpoints return empty font lists.
 *
 * Set via: FONT_EXTRACTION_ENABLED=true in .env
 */
export const FONT_EXTRACTION_ENABLED =
  process.env.FONT_EXTRACTION_ENABLED === 'true';

/**
 * Maximum garbage collection level for pdf-lib save operations.
 * Values above 0 risk stripping embedded font objects.
 *
 * Server-side flag. NEVER set above 0 until validated in staging.
 * Set via: PDF_SAVE_GARBAGE_LEVEL=0 in .env (default: 0)
 */
export const PDF_SAVE_GARBAGE_LEVEL = (() => {
  const raw = parseInt(process.env.PDF_SAVE_GARBAGE_LEVEL ?? '0', 10);
  // Hard cap at 0 unless explicitly overridden and validated
  return Number.isNaN(raw) ? 0 : Math.min(raw, 4);
})();

/**
 * Autorise pdf-lib à utiliser un niveau garbage > 0 lors du save.
 * Désactivé par défaut — garbage >= 1 risque de supprimer les ressources font.
 *
 * Server-side flag.
 * Set via: PDF_SAVE_ALLOW_GARBAGE=true in .env
 */
export const PDF_SAVE_ALLOW_GARBAGE =
  process.env['PDF_SAVE_ALLOW_GARBAGE'] === 'true';

/**
 * Active l'embed des polices custom (non-Standard) dans le pipeline apply-elements.
 *
 * Quand true :
 *  - apply-elements/route.ts fetch les bytes de la police via /api/pdf/fonts/:documentId/:fontId
 *  - text-renderer.ts embed les bytes dans le PDF via pdf-lib embedFont()
 *  - Nécessite que l'élément text passe element.documentId + element.style.fontId
 *
 * Quand false (défaut) :
 *  - Le renderer utilise les StandardFonts ou fallback Helvetica (comportement existant)
 *
 * Server-side flag (pas de NEXT_PUBLIC_ — non exposé au client).
 * Set via: FONT_EMBED_CUSTOM_ENABLED=true in .env
 */
export const FONT_EMBED_CUSTOM_ENABLED =
  process.env['FONT_EMBED_CUSTOM_ENABLED'] === 'true';

/**
 * Active le pipeline "apply-elements avant save" dans useDocumentSave.
 *
 * Quand true :
 *  - useDocumentSave appelle /api/pdf/apply-elements AVANT api.saveDocument/createDocumentVersion
 *  - Le PDF modifié (avec les éléments appliqués) est uploadé côté Python
 *  - Les modifications sont donc réellement persistées dans le binaire S3
 *
 * Quand false (défaut) :
 *  - useDocumentSave envoie seulement le document_id au backend Python
 *  - Le backend Python re-sert les bytes originaux (les modifications restent dans Redis)
 *
 * Client-side flag (NEXT_PUBLIC_ — nécessaire car useDocumentSave est un hook client).
 * Set via: NEXT_PUBLIC_SAVE_APPLIES_ELEMENTS=true in .env.local
 */
export const SAVE_APPLIES_ELEMENTS_ENABLED =
  typeof process !== 'undefined' &&
  process.env['NEXT_PUBLIC_SAVE_APPLIES_ELEMENTS'] === 'true';
