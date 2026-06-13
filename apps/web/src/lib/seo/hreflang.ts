import type { Metadata } from "next";

/**
 * Construit le bloc `alternates` (canonical auto-référent + hreflang
 * fr/en/x-default) d'une page publique BILINGUE servie sous le segment
 * [locale] avec le préfixe `as-needed` (fr = sans préfixe, en = /en/*).
 *
 * À n'utiliser QUE pour les pages réellement traduites (messages fr/en).
 * Les pages fr-only ((seo), cookies, legal-notice) gardent un canonical fr
 * sans `languages`.
 *
 * @param path   Chemin non préfixé, commençant par "/" (ex: "/login").
 * @param locale Locale de la page rendue (détermine le canonical).
 */
export function publicPageAlternates(
  path: string,
  locale: string,
): NonNullable<Metadata["alternates"]> {
  const frPath = path;
  const enPath = path === "/" ? "/en" : `/en${path}`;

  return {
    canonical: locale === "en" ? enPath : frPath,
    languages: {
      fr: frPath,
      en: enPath,
      "x-default": frPath,
    },
  };
}
