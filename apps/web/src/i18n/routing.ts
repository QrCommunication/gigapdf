import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "./config";

/**
 * Routing i18n du périmètre PUBLIC uniquement (landing, (auth), (legal), (seo)).
 * Les routes applicatives (dashboard, editor, embed, api) restent résolues par
 * cookie via src/i18n/request.ts et ne passent JAMAIS par ce routing.
 *
 * - `as-needed` : fr (défaut) sans préfixe → URLs historiques inchangées ;
 *   en = /en/*.
 * - `localeDetection: false` : l'URL est la SEULE source de vérité publique.
 *   Indispensable car /tools et /solutions sont fr-only (404 en /en/*) — une
 *   détection cookie/Accept-Language redirigerait les visiteurs EN vers des
 *   404 (/tools → /en/tools) et ferait fuir les crawlers de / vers /en.
 * - `localeCookie: false` : le cookie `locale` reste écrit exclusivement par
 *   l'action serveur setLocale() (source unique, partagée avec le dashboard).
 * - `alternateLinks: false` : les en-têtes Link automatiques annonceraient
 *   /en/tools et /en/solutions qui répondent 404 ; les hreflang sont gérés
 *   explicitement (sitemap.ts + metadata des pages bilingues).
 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
  localeDetection: false,
  localeCookie: false,
  alternateLinks: false,
});
