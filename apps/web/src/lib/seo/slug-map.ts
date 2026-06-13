/**
 * Bidirectional FR ↔ EN slug mapping for the programmatic SEO pages.
 *
 * The FR dataset (tools-data.ts / solutions-data.ts) and the EN dataset
 * (tools-data.en.ts / solutions-data.en.ts) use locale-specific slugs.
 * This module is the single source of truth for translating a slug from
 * one locale to the other (hreflang alternates, language switcher).
 *
 * Maps are keyed FR → EN; reverse lookups are derived automatically.
 */

export type SeoLocale = "fr" | "en";

/** Tool slugs, FR → EN (20 entries, complete bijection). */
export const toolSlugMap: Record<string, string> = {
  "editer-pdf": "edit-pdf",
  "fusionner-pdf": "merge-pdf",
  "diviser-pdf": "split-pdf",
  "compresser-pdf": "compress-pdf",
  "signer-pdf": "sign-pdf",
  "ocr-pdf": "ocr-pdf",
  "pdf-cherchable": "searchable-pdf",
  "proteger-pdf": "protect-pdf",
  "filigrane-pdf": "watermark-pdf",
  "organiser-pages-pdf": "organize-pdf-pages",
  "annoter-pdf": "annotate-pdf",
  "formulaires-pdf": "pdf-forms",
  "pdf-vers-word": "pdf-to-word",
  "word-vers-pdf": "word-to-pdf",
  "excel-vers-pdf": "excel-to-pdf",
  "powerpoint-vers-pdf": "powerpoint-to-pdf",
  "opendocument-pdf": "opendocument-pdf",
  "pdf-vers-odt": "pdf-to-odt",
  "html-vers-pdf": "html-to-pdf",
  "pdf-a": "pdf-a",
};

/** Solution slugs, FR → EN (10 entries, complete bijection). */
export const solutionSlugMap: Record<string, string> = {
  avocats: "lawyers",
  "experts-comptables": "accountants",
  "ressources-humaines": "human-resources",
  immobilier: "real-estate",
  sante: "healthcare",
  "education-etudiants": "students",
  "enseignants-formateurs": "teachers-trainers",
  freelances: "freelancers",
  associations: "nonprofits",
  "architectes-btp": "architects-construction",
};

function invert(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([fr, en]) => [en, fr]));
}

const toolSlugMapEnToFr: Record<string, string> = invert(toolSlugMap);
const solutionSlugMapEnToFr: Record<string, string> = invert(solutionSlugMap);

function resolveAlternate(
  slug: string,
  toLocale: SeoLocale,
  frToEn: Record<string, string>,
  enToFr: Record<string, string>,
): string | undefined {
  if (toLocale === "en") {
    const fromFr = frToEn[slug];
    if (fromFr !== undefined) return fromFr;
    // Already an EN slug → identity.
    return enToFr[slug] !== undefined ? slug : undefined;
  }
  const fromEn = enToFr[slug];
  if (fromEn !== undefined) return fromEn;
  // Already a FR slug → identity.
  return frToEn[slug] !== undefined ? slug : undefined;
}

/**
 * Returns the tool slug in `toLocale` for a slug given in either locale,
 * or `undefined` if the slug is unknown in both.
 */
export function getAlternateToolSlug(
  slug: string,
  toLocale: SeoLocale,
): string | undefined {
  return resolveAlternate(slug, toLocale, toolSlugMap, toolSlugMapEnToFr);
}

/**
 * Returns the solution slug in `toLocale` for a slug given in either locale,
 * or `undefined` if the slug is unknown in both.
 */
export function getAlternateSolutionSlug(
  slug: string,
  toLocale: SeoLocale,
): string | undefined {
  return resolveAlternate(slug, toLocale, solutionSlugMap, solutionSlugMapEnToFr);
}
