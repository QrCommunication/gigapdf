/**
 * Build the list of DOCUMENT fonts to surface in the editor's font picker.
 *
 * The picker historically offered only a handful of hard-coded system fonts,
 * so text typed/edited in the document never matched the document's real
 * typography. `useEmbeddedFonts` already loads every embedded PDF font as a
 * scoped `FontFace` (named `gigapdf-{documentId}-{fontId}`); this helper turns
 * that loaded set into ready-to-render picker options.
 *
 * Each option carries BOTH:
 *  - `faceName`     — the registered FontFace name (`gigapdf-{documentId}-{fontId}`),
 *                     so a selection renders 1:1 with the document.
 *  - `originalName` — the raw PDF font name, used by the renderer's
 *                     `getFontFaceName(originalFont, …)` variant-aware resolver
 *                     (`render-elements.ts → resolveTextFont`).
 *
 * Selecting a document font should therefore set BOTH on the text element's
 * style (`fontFamily = faceName`, `originalFont = originalName`): the resolver
 * picks the variant-exact subset when possible, and even the pure CSS fallback
 * path renders correctly because the FontFace IS registered under `faceName`.
 */

import type { LoadedFont } from '../hooks/use-embedded-fonts';

/** A document (embedded) font ready to be offered in the editor font picker. */
export interface DocumentFontOption {
  /**
   * Stable option key. Mirrors the registered FontFace name
   * (`gigapdf-{documentId}-{fontId}`) and is what should be written to
   * `TextStyle.fontFamily` so the run renders with the embedded face.
   */
  faceName: string;
  /** Human-readable family label (the PDF's own family / original font name). */
  label: string;
  /**
   * Raw PDF font name (`originalName`). Write to `TextStyle.originalFont` so the
   * renderer's variant-aware resolver can pick the matching bold/italic subset.
   */
  originalName: string;
}

/**
 * Best human-readable label for a loaded font: prefer the backend-collapsed
 * family ("Times New Roman"), fall back to the raw original name, stripping the
 * `ABCDEF+` subset prefix so the picker shows "Calibri", not "ABCDEF+Calibri".
 */
function fontLabel(font: LoadedFont): string {
  const family = font.metadata.fontFamily?.trim();
  if (family) return family;
  return font.metadata.originalName.replace(/^[A-Z]{6}\+/, '').trim();
}

/**
 * Convert the `useEmbeddedFonts().fonts` list into picker options.
 *
 * - Only `status === 'loaded'` fonts are offered (a font whose face failed to
 *   register cannot be rendered, so listing it would mislead the user).
 * - Options are de-duplicated by visible label (a PDF routinely embeds many
 *   subsets of the SAME family — Times New Roman regular/bold/italic/…; the
 *   picker only needs ONE entry per family, the renderer resolves the exact
 *   subset at render time from the run's weight/style intent).
 * - Sorted alphabetically by label for a stable, predictable menu.
 *
 * Pure: no side effects, deterministic for a given input — safe in render.
 */
export function buildDocumentFontOptions(
  fonts: readonly LoadedFont[],
): DocumentFontOption[] {
  const byLabel = new Map<string, DocumentFontOption>();

  for (const font of fonts) {
    if (font.status !== 'loaded') continue;
    const label = fontLabel(font);
    if (!label) continue;
    // First loaded subset of a family wins the entry (its faceName resolves the
    // family; the renderer refines to the correct variant via originalFont).
    if (byLabel.has(label)) continue;
    byLabel.set(label, {
      faceName: font.fontFaceName,
      label,
      originalName: font.metadata.originalName,
    });
  }

  return Array.from(byLabel.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}
