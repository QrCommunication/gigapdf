import type { Metadata } from "next";

/**
 * Construit le bloc `alternates` (canonical auto-référent + hreflang
 * fr/en/x-default) d'une page publique BILINGUE servie sous le segment
 * [locale] avec le préfixe `as-needed` (fr = sans préfixe, en = /en/*).
 *
 * À n'utiliser QUE pour les pages réellement traduites dont le chemin est
 * IDENTIQUE dans les deux locales (landing, (auth), (legal), hubs (seo)).
 * Les pages fr-only (cookies, legal-notice) gardent un canonical fr sans
 * `languages` ; les pages (seo) à slug traduit ([slug]) passent par
 * buildSlugAlternates (lib/seo/index.ts) qui croise les slugs via slug-map.
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
