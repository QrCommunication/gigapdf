/**
 * Point d'entrée des données SEO programmatique BILINGUES.
 *
 * Résout le dataset (tools / solutions) selon la locale du segment [locale] :
 * - fr → tools-data.ts / solutions-data.ts (slugs français) ;
 * - en → tools-data.en.ts / solutions-data.en.ts (slugs anglais).
 *
 * Un slug n'existe QUE dans sa locale : `getToolBySlugForLocale("en",
 * "editer-pdf")` retourne undefined (→ 404), sauf pour les slugs identiques
 * dans les deux langues (ocr-pdf, opendocument-pdf, pdf-a) présents dans les
 * deux datasets.
 *
 * Les helpers d'alternates (`getToolAlternatePaths` / `getSolutionAlternatePaths`)
 * sont la source unique des URLs hreflang croisées : generateMetadata des
 * pages [slug] ET sitemap.ts les consomment.
 */

import {
  getSolutionBySlug as getSolutionBySlugFr,
  SOLUTIONS as SOLUTIONS_FR,
  type SolutionData,
} from "./solutions-data";
import {
  getSolutionBySlug as getSolutionBySlugEn,
  SOLUTIONS as SOLUTIONS_EN,
} from "./solutions-data.en";
import {
  getAlternateSolutionSlug,
  getAlternateToolSlug,
  type SeoLocale,
} from "./slug-map";
import {
  getToolBySlug as getToolBySlugFr,
  TOOLS as TOOLS_FR,
  type ToolData,
} from "./tools-data";
import {
  getToolBySlug as getToolBySlugEn,
  TOOLS as TOOLS_EN,
} from "./tools-data.en";

export type { SeoLocale } from "./slug-map";
export {
  getAlternateSolutionSlug,
  getAlternateToolSlug,
  solutionSlugMap,
  toolSlugMap,
} from "./slug-map";
export type { ToolData, ToolFaqItem, ToolHowTo } from "./tools-data";
export type { SolutionData, SolutionWorkflow } from "./solutions-data";

/** Garde de type : seules fr et en portent un dataset SEO. */
export function isSeoLocale(locale: string): locale is SeoLocale {
  return locale === "fr" || locale === "en";
}

/**
 * Préfixe un chemin non localisé selon la locale (`as-needed` : fr sans
 * préfixe, en = /en/*). Utilisé pour les URLs absolues (JSON-LD, hreflang).
 */
export function localizePath(path: string, locale: SeoLocale): string {
  if (locale === "fr") return path;
  return path === "/" ? "/en" : `/en${path}`;
}

/** Dataset des outils dans la locale demandée. */
export function getToolsData(locale: SeoLocale): ToolData[] {
  return locale === "en" ? TOOLS_EN : TOOLS_FR;
}

/** Dataset des solutions métiers dans la locale demandée. */
export function getSolutionsData(locale: SeoLocale): SolutionData[] {
  return locale === "en" ? SOLUTIONS_EN : SOLUTIONS_FR;
}

/**
 * Outil par slug DANS la locale donnée. Un slug de l'autre locale retourne
 * undefined (un slug fr sous /en → 404, et inversement).
 */
export function getToolBySlugForLocale(
  locale: SeoLocale,
  slug: string,
): ToolData | undefined {
  return locale === "en" ? getToolBySlugEn(slug) : getToolBySlugFr(slug);
}

/**
 * Solution par slug DANS la locale donnée. Même sémantique 404 croisée que
 * getToolBySlugForLocale.
 */
export function getSolutionBySlugForLocale(
  locale: SeoLocale,
  slug: string,
): SolutionData | undefined {
  return locale === "en"
    ? getSolutionBySlugEn(slug)
    : getSolutionBySlugFr(slug);
}

/** Paire de chemins hreflang d'une même page dans les deux locales. */
export interface AlternatePaths {
  /** Chemin fr, sans préfixe (ex: /tools/editer-pdf). */
  fr: string;
  /** Chemin en, préfixé /en (ex: /en/tools/edit-pdf). */
  en: string;
}

/**
 * Chemins fr + en d'une page outil, pour un slug donné dans N'IMPORTE quelle
 * locale (slug-map bidirectionnel). undefined si le slug est inconnu partout.
 */
export function getToolAlternatePaths(slug: string): AlternatePaths | undefined {
  const frSlug = getAlternateToolSlug(slug, "fr");
  const enSlug = getAlternateToolSlug(slug, "en");
  if (frSlug === undefined || enSlug === undefined) return undefined;
  return { fr: `/tools/${frSlug}`, en: `/en/tools/${enSlug}` };
}

/**
 * Chemins fr + en d'une page solution, pour un slug donné dans n'importe
 * quelle locale. undefined si le slug est inconnu partout.
 */
export function getSolutionAlternatePaths(
  slug: string,
): AlternatePaths | undefined {
  const frSlug = getAlternateSolutionSlug(slug, "fr");
  const enSlug = getAlternateSolutionSlug(slug, "en");
  if (frSlug === undefined || enSlug === undefined) return undefined;
  return { fr: `/solutions/${frSlug}`, en: `/en/solutions/${enSlug}` };
}

/**
 * Bloc Metadata.alternates d'une page [slug] : canonical auto-référent dans
 * la locale rendue + hreflang croisés fr/en/x-default (x-default = fr,
 * langue canonique du domaine).
 */
export function buildSlugAlternates(paths: AlternatePaths, locale: SeoLocale) {
  return {
    canonical: locale === "en" ? paths.en : paths.fr,
    languages: {
      fr: paths.fr,
      en: paths.en,
      "x-default": paths.fr,
    },
  };
}
